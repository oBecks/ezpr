import * as core from '@actions/core';
import * as github from '@actions/github';
import { collectContext, type Context } from './context/collect';
import { upsertSummary } from './github/comments';
import { fileReader, listChangedFiles, loadPr } from './github/pr';
import { buildPrompt, SYSTEM_PROMPT } from './prompt/builder';
import { ChainError, runChain } from './providers/chain';
import { buildBrains } from './providers/registry';
import { renderErrorComment, renderReview, renderSetupComment } from './render/summary';

async function run(): Promise<void> {
  const pull = github.context.payload.pull_request;
  if (!pull) {
    core.info('Not a pull_request event; nothing to review.');
    return;
  }

  const octokit = github.getOctokit(core.getInput('github-token', { required: true }));
  const repo = github.context.repo;
  const pr = await loadPr(octokit, repo, pull.number);

  // Fork PRs get a read-only token, so results go to the job summary (ADR-0004).
  const publish = async (body: string): Promise<void> => {
    if (pr.isFork) {
      await core.summary.addRaw(body).write();
      core.info('Fork PR: wrote review to the job summary instead of commenting.');
    } else {
      await upsertSummary(octokit, repo, pr.number, body);
    }
  };

  const brains = buildBrains(process.env);
  if (brains.length === 0) {
    core.warning('No API keys found (e.g. GEMINI_API_KEY).');
    await publish(renderSetupComment());
    return;
  }
  core.info(`Fallback chain: ${brains.map((b) => b.id).join(' -> ')}`);

  const raw = await listChangedFiles(octokit, repo, pr.number);
  const read = fileReader(octokit, pr);
  const cache = new Map<string, Promise<string | null>>();
  const cachedRead = (path: string) => {
    let hit = cache.get(path);
    if (!hit) {
      hit = read(path);
      cache.set(path, hit);
    }
    return hit;
  };

  try {
    const { result, brain, failures } = await runChain(brains, async (b) => {
      // Each Brain gets Context trimmed to its own budget.
      const ctx: Context = await collectContext(raw, cachedRead, b.maxInputTokens);
      if (ctx.files.length === 0) return null;
      const prompt = buildPrompt({ title: pr.title, body: pr.body }, ctx);
      return { review: await b.review(SYSTEM_PROMPT, prompt), ctx };
    });
    for (const f of failures) {
      const log = f.kind === 'auth' ? core.warning : core.info;
      log(`${f.brain} failed (${f.kind}): ${f.error}`);
    }
    if (!result) {
      core.info('No reviewable files in this PR.');
      return;
    }
    await publish(renderReview(result.review, brain.id, result.ctx, failures));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.error(message);
    await publish(renderErrorComment(message, err instanceof ChainError ? err.failures : []));
  }
}

run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
