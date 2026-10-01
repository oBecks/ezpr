import * as core from '@actions/core';
import * as github from '@actions/github';
import { mergeReviews, chunkFiles } from './context/chunk';
import { buildContext, prepareFiles, type Context } from './context/collect';
import { makeIgnore, parseIgnore } from './context/ignore';
import { checkoutReader, checkoutRoot, gatherExtras } from './context/repo';
import { loadRules } from './context/rules';
import { estimateTokens } from './context/budget';
import { MAX_CHUNKS } from './config';
import {
  getSticky,
  listCommentedLines,
  postInline,
  upsertSummary,
  writeSticky,
} from './github/comments';
import { fileReader, listChangedFiles, listChangesSince, loadPr, readerAt } from './github/pr';
import { composeSticky, parseSticky } from './github/sticky';
import { buildPrompt, buildSystemPrompt } from './prompt/builder';
import type { Finding, Review } from './prompt/schema';
import { ChainError, runChain, type ChainFailure } from './providers/chain';
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
    const ignored = makeIgnore(parseIgnore(core.getInput('ignore')));
    // Project rules come from the base branch so a PR cannot rewrite its own rules (ADR-0006).
    const rules = await loadRules(readerAt(octokit, repo, pr.baseSha));
    const system = buildSystemPrompt(rules);
    const reserved = estimateTokens(system);

    // Imports and callers come from the checkout when there is one (ADR-0007).
    const root = checkoutRoot(process.env);
    const readRepo = root ? checkoutReader(root) : cachedRead;
    const changed = new Set(raw.map((f) => f.path));

    const prep = await prepareFiles(reviewFiles, cachedRead, ignored);
    const primary = brains[0];
    if (prep.candidates.length === 0 || !primary) {
      core.info('No reviewable files in this PR.');
      return;
    }
    // Chunks are sized for the first Brain; a smaller fallback Brain trims its own copy.
    const plan = chunkFiles(prep.candidates, primary.maxInputTokens - reserved, MAX_CHUNKS);
    if (plan.chunks.length > 1) core.info(`Large PR: reviewing in ${plan.chunks.length} parts.`);

    const reviews: Review[] = [];
    const ctxs: Context[] = [];
    const used: string[] = [];
    const failures: ChainFailure[] = [];
    const droppedDiffs = [...plan.droppedDiffs];
    for (const [n, chunk] of plan.chunks.entries()) {
      let extras = {};
      try {
        extras = await gatherExtras(chunk, { read: readRepo, root, changed, ignored });
      } catch (err) {
        core.warning(
          `Could not gather extra context: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      try {
        const done = await runChain(brains, async (b) => {
          // Each Brain gets Context trimmed to its own budget.
          const ctx = buildContext(prep, chunk, b.maxInputTokens - reserved, extras);
          if (ctx.files.length === 0) return null;
          const prompt = buildPrompt({ title: pr.title, body: pr.body, since }, ctx);
          return { review: await b.review(system, prompt), ctx };
        });
        failures.push(...done.failures);
        if (!done.result) {
          droppedDiffs.push(...chunk.map((f) => f.path));
          continue;
        }
        reviews.push(done.result.review);
        ctxs.push(done.result.ctx);
        if (!used.includes(done.brain.id)) used.push(done.brain.id);
      } catch (err) {
        // The first part failing is a failed Review; a later part is reported as left out.
        if (n === 0 || !(err instanceof ChainError)) throw err;
        core.warning(`Part ${n + 1} failed: ${err.message}`);
        failures.push(...err.failures);
        droppedDiffs.push(...chunk.map((f) => f.path));
      }
    }
    for (const f of failures) {
      const log = f.kind === 'auth' ? core.warning : core.info;
      log(`${f.brain} failed (${f.kind}): ${f.error}`);
    }
    if (reviews.length === 0) {
      core.info('No reviewable files in this PR.');
      return;
    }
    const result = { review: mergeReviews(reviews) };
    const merged: Context = {
      ...prep,
      files: ctxs.flatMap((c) => c.files),
      callers: ctxs.flatMap((c) => c.callers),
      imports: ctxs.flatMap((c) => c.imports),
      droppedDiffs: [...droppedDiffs, ...ctxs.flatMap((c) => c.droppedDiffs)],
      droppedContents: ctxs.flatMap((c) => c.droppedContents),
      droppedCallers: ctxs.reduce((n, c) => n + c.droppedCallers, 0),
      droppedImports: ctxs.flatMap((c) => c.droppedImports),
    };
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
    const content = renderReview(result.review, used.join(', '), merged, dedupe(failures), {
      inline,
      since,
      parts: reviews.length,
      noCheckout: !root,
    });
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

function dedupe(failures: ChainFailure[]): ChainFailure[] {
  const seen = new Set<string>();
  return failures.filter((f) => {
    const key = `${f.brain}:${f.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
