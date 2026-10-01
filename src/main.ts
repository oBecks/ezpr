import * as core from '@actions/core';
import * as github from '@actions/github';
import { collectContext, type Context } from './context/collect';
import {
  getSticky,
  listCommentedLines,
  postInline,
  upsertSummary,
  writeSticky,
} from './github/comments';
import { fileReader, listChangedFiles, listChangesSince, loadPr } from './github/pr';
import { composeSticky, parseSticky } from './github/sticky';
import { buildPrompt, SYSTEM_PROMPT } from './prompt/builder';
import type { Finding } from './prompt/schema';
import { ChainError, runChain } from './providers/chain';
import { buildBrains } from './providers/registry';
import { diffLineMap } from './review/diffmap';
import { placeFindings } from './review/place';
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

  // The sticky Summary records the last reviewed commit; a new push reviews only what changed since.
  const existing = pr.isFork ? undefined : await getSticky(octokit, repo, pr.number);
  const previous = existing?.body ? parseSticky(existing.body) : undefined;
  let reviewFiles = raw;
  let since: string | undefined;
  if (previous?.sha) {
    if (previous.sha === pr.headSha) {
      core.info(`Commit ${pr.headSha} was already reviewed; nothing new to review.`);
      return;
    }
    const changes = await listChangesSince(octokit, repo, previous.sha, pr.headSha);
    if (changes) {
      reviewFiles = changes;
      since = previous.sha;
      core.info(`Incremental review since ${since}.`);
    } else {
      core.info('Could not diff against the last reviewed commit; reviewing the whole PR.');
    }
  }
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
      const ctx: Context = await collectContext(reviewFiles, cachedRead, b.maxInputTokens);
      if (ctx.files.length === 0) return null;
      const prompt = buildPrompt({ title: pr.title, body: pr.body, since }, ctx);
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
    const inline = new Set<Finding>();
    if (!pr.isFork) {
      try {
        // Inline comments must land on lines of the full PR diff, not just the incremental one.
        const placed = placeFindings(
          result.review.findings,
          diffLineMap(raw),
          await listCommentedLines(octokit, repo, pr.number),
        );
        const wanted = placed.filter((p) => p.placement === 'inline').map((p) => p.finding);
        for (const f of await postInline(
          octokit,
          repo,
          pr.number,
          pr.headSha,
          wanted,
          core.warning,
        )) {
          inline.add(f);
        }
      } catch (err) {
        core.warning(`Inline comments failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const content = renderReview(result.review, brain.id, result.ctx, failures, { inline, since });
    if (pr.isFork) {
      await publish(content);
    } else {
      const body = composeSticky(previous, content, pr.headSha, new Date().toISOString());
      await writeSticky(octokit, repo, pr.number, existing, body);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.error(message);
    await publish(renderErrorComment(message, err instanceof ChainError ? err.failures : []));
  }
}

run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
