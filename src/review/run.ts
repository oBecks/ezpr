import * as core from '@actions/core';
import { getSticky } from '../github/comments';
import { CONFIG_PATH, mergeSettings, parseConfigFile, parseInputs } from '../context/settings';
import { listChangedFiles, loadPr, readerAt, type Octokit } from '../github/pr';
import { parseSticky } from '../github/sticky';
import { buildBrains, orderBrains } from '../providers/registry';
import { makePublisher, publishFailure } from '../render/publish';
import { renderSetupComment } from '../render/summary';
import { reviewPr } from './pipeline';
import { selectFiles } from './select';
import type { Repo } from './types';

/** `.ezpr.yml` from the base branch (ADR-0009) merged with the action inputs. */
export async function loadSettings(octokit: Octokit, repo: Repo, baseSha: string) {
  const file = parseConfigFile(await readerAt(octokit, repo, baseSha)(CONFIG_PATH));
  const input = parseInputs({
    ignore: core.getInput('ignore'),
    strictness: core.getInput('strictness'),
    brains: core.getInput('brains'),
  });
  return mergeSettings(file, input);
}

export interface ReviewOptions {
  /** The run came from a Command, so the token can write even on a fork PR (ADR-0010). */
  fromCommand?: boolean;
  /** Review the whole PR even if the head commit was already reviewed (`@ezpr review`). */
  force?: boolean;
}

export async function reviewPullRequest(
  octokit: Octokit,
  repo: Repo,
  number: number,
  options: ReviewOptions = {},
): Promise<void> {
  const pr = await loadPr(octokit, repo, number);
  const canComment = options.fromCommand === true || !pr.isFork;
  const gh = { octokit, repo, pr, canComment };
  const publish = makePublisher(gh);

  const available = buildBrains(process.env);
  if (available.length === 0) {
    core.warning('No API keys found (e.g. GEMINI_API_KEY).');
    return publish(renderSetupComment());
  }

  const existing = canComment ? await getSticky(octokit, repo, number) : undefined;
  const previous = existing?.body ? parseSticky(existing.body) : undefined;
  const settings = await loadSettings(octokit, repo, pr.baseSha);
  for (const problem of settings.problems) core.warning(`Config: ${problem}`);

  const { brains, missing } = orderBrains(available, settings.brains);
  for (const id of missing) core.info(`${id} is listed in brains but has no API key; skipped.`);
  if (brains.length === 0) {
    const msg = `None of the providers listed in \`brains\` (${settings.brains?.join(', ')}) has an API key.`;
    return publishFailure(publish, new Error(msg), Boolean(previous?.sha));
  }
  core.info(`Fallback chain: ${brains.map((b) => b.id).join(' -> ')}`);

  const all = await listChangedFiles(octokit, repo, number);
  const selection = await selectFiles(gh, all, options.force ? undefined : previous?.sha);
  if (!selection) return;

  try {
    await reviewPr({
      gh,
      brains,
      all,
      selection,
      previous,
      existing,
      publish,
      settings,
      useCheckout: !options.fromCommand,
    });
  } catch (err) {
    await publishFailure(publish, err, Boolean(previous?.sha));
  }
}
