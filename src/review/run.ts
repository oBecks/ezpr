import * as core from '@actions/core';
import { getSticky } from '../github/comments';
import { listChangedFiles, loadPr, type Octokit } from '../github/pr';
import { parseSticky } from '../github/sticky';
import { buildBrains } from '../providers/registry';
import { makePublisher, publishFailure } from '../render/publish';
import { renderSetupComment } from '../render/summary';
import { reviewPr } from './pipeline';
import { selectFiles } from './select';
import type { Repo } from './types';

export async function reviewPullRequest(
  octokit: Octokit,
  repo: Repo,
  number: number,
): Promise<void> {
  const pr = await loadPr(octokit, repo, number);
  const gh = { octokit, repo, pr };
  const publish = makePublisher(gh);

  const brains = buildBrains(process.env);
  if (brains.length === 0) {
    core.warning('No API keys found (e.g. GEMINI_API_KEY).');
    return publish(renderSetupComment());
  }
  core.info(`Fallback chain: ${brains.map((b) => b.id).join(' -> ')}`);

  const all = await listChangedFiles(octokit, repo, number);
  const existing = pr.isFork ? undefined : await getSticky(octokit, repo, number);
  const previous = existing?.body ? parseSticky(existing.body) : undefined;
  const selection = await selectFiles(gh, all, previous?.sha);
  if (!selection) return;

  try {
    await reviewPr({ gh, brains, all, selection, previous, existing, publish });
  } catch (err) {
    await publishFailure(publish, err);
  }
}
