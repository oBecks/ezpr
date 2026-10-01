import * as core from '@actions/core';
import { diffCost, estimateTokens } from '../context/budget';
import { chunkFiles } from '../context/chunk';
import { prepareFiles, type Prepared, type RawFile } from '../context/collect';
import { makeIgnore } from '../context/ignore';
import { checkoutReader, checkoutRoot, gatherExtras } from '../context/repo';
import { loadRules } from '../context/rules';
import { MAX_CHUNKS, STRICTNESS_THRESHOLD } from '../config';
import type { Settings } from '../context/settings';
import { writeSticky, type getSticky } from '../github/comments';
import { fileReader, readerAt } from '../github/pr';
import { composeSticky, type StickyState } from '../github/sticky';
import { buildSystemPrompt } from '../prompt/builder';
import type { Finding } from '../prompt/schema';
import type { ChainFailure } from '../providers/chain';
import type { Brain } from '../providers/types';
import type { Publish } from '../render/publish';
import { renderNothingToReview, renderReview, renderTooLarge } from '../render/summary';
import { reviewInChunks, type ChunkedResult } from './chunks';
import { postInlineFindings } from './inline';
import type { Selection } from './select';
import { errorText, type Gh } from './types';

export interface ReviewJob {
  gh: Gh;
  brains: Brain[];
  /** Every file of the PR. */
  all: RawFile[];
  selection: Selection;
  previous: StickyState | undefined;
  existing: Awaited<ReturnType<typeof getSticky>>;
  publish: Publish;
  settings: Settings;
}

type Read = (path: string) => Promise<string | null>;

interface Setup {
  primary: Brain;
  system: string;
  ignored: (path: string) => boolean;
  prep: Prepared;
  read: Read;
  hasRules: boolean;
}

/** Reads each repo file at most once per run. */
function cached(read: Read): Read {
  const cache = new Map<string, Promise<string | null>>();
  return (path) => {
    let hit = cache.get(path);
    if (!hit) {
      hit = read(path);
      cache.set(path, hit);
    }
    return hit;
  };
}

/** The same failure from several parts is reported once. */
function dedupe(failures: ChainFailure[]): ChainFailure[] {
  const seen = new Set<string>();
  return failures.filter((f) => {
    const key = `${f.brain}:${f.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function logFailures(failures: ChainFailure[]): void {
  for (const f of failures) {
    const log = f.kind === 'auth' ? core.warning : core.info;
    log(`${f.brain} failed (${f.kind}): ${f.error}`);
  }
}

async function setUp(job: ReviewJob, primary: Brain): Promise<Setup> {
  const { octokit, repo, pr } = job.gh;
  const ignored = makeIgnore(job.settings.ignore);
  const read = cached(fileReader(octokit, pr));
  // Project rules come from the base branch so a PR cannot rewrite its own rules (ADR-0006).
  const rules = await loadRules(readerAt(octokit, repo, pr.baseSha));
  const system = buildSystemPrompt(rules, job.settings.strictness);
  const prep = await prepareFiles(job.selection.files, read, ignored);
  return { primary, system, ignored, prep, read, hasRules: Boolean(rules) };
}

/** One line in the job log saying what the Brains were given, so a run can be checked. */
function logContext(setup: Setup, done: ChunkedResult, hasCheckout: boolean): void {
  const { ctx } = done;
  const skipped = [
    `${ctx.skippedIgnored.length} ignored`,
    `${ctx.skippedNoise.length} generated/binary`,
    `${ctx.skippedSecrets.length} secret-like`,
    `${ctx.missingPatch.length} without diff`,
  ].join(', ');
  core.info(
    `Context sent: ${ctx.files.length} file(s), ${ctx.imports.length} imported file(s), ` +
      `${ctx.callers.length} caller snippet(s); project rules: ${setup.hasRules ? 'yes' : 'no'}; ` +
      `repo checkout: ${hasCheckout ? 'yes' : 'no'}; parts: ${done.parts}/${done.plannedParts}; ` +
      `skipped: ${skipped}.`,
  );
}

/** Imported files and Caller snippets for a chunk; a failure only loses the extra context. */
function extrasGatherer(job: ReviewJob, setup: Setup, root: string | undefined) {
  // Imports and callers come from the checkout when there is one (ADR-0007).
  const read = root ? checkoutReader(root) : setup.read;
  const changed = new Set(job.all.map((f) => f.path));
  return async (chunk: Parameters<typeof gatherExtras>[0]) => {
    try {
      return await gatherExtras(chunk, { read, root, changed, ignored: setup.ignored });
    } catch (err) {
      core.warning(`Could not gather extra context: ${errorText(err)}`);
      return {};
    }
  };
}

function reviewChunks(job: ReviewJob, setup: Setup, root: string | undefined) {
  const { pr } = job.gh;
  const reserved = estimateTokens(setup.system);
  // Chunks are sized for the first Brain; a smaller fallback Brain trims its own copy.
  const plan = chunkFiles(
    setup.prep.candidates,
    setup.primary.maxInputTokens - reserved,
    MAX_CHUNKS,
  );
  if (plan.chunks.length > 1) core.info(`Large PR: reviewing in ${plan.chunks.length} parts.`);
  return reviewInChunks({
    brains: job.brains,
    system: setup.system,
    reserved,
    prep: setup.prep,
    chunks: plan.chunks,
    droppedDiffs: plan.droppedDiffs,
    meta: { title: pr.title, body: pr.body, since: job.selection.since },
    gather: extrasGatherer(job, setup, root),
    warn: core.warning,
  });
}

async function publishReview(
  job: ReviewJob,
  done: ChunkedResult,
  noCheckout: boolean,
): Promise<void> {
  const { octokit, repo, pr } = job.gh;
  const inline = pr.isFork
    ? new Set<Finding>()
    : await postInlineFindings(
        job.gh,
        job.all,
        done.review.findings,
        STRICTNESS_THRESHOLD[job.settings.strictness],
      );
  const content = renderReview(done.review, done.used.join(', '), done.ctx, dedupe(done.failures), {
    inline,
    since: job.selection.since,
    parts: done.parts,
    plannedParts: done.plannedParts,
    unreviewed: done.unreviewed,
    used: done.used,
    noCheckout,
    configProblems: job.settings.problems,
  });
  if (pr.isFork) return job.publish(content);
  const body = composeSticky(job.previous, content, pr.headSha, new Date().toISOString());
  await writeSticky(octokit, repo, pr.number, job.existing, body);
}

/**
 * Says so when no file could be sent, instead of leaving the PR with no sign of EzPR. A PR that
 * already has a Review keeps it: a push touching only skipped files is not worth replacing it.
 */
async function publishNothing(job: ReviewJob, prep: Prepared): Promise<void> {
  core.info('No reviewable files in this PR.');
  if (job.previous?.sha) return;
  const total = job.selection.files.length;
  return publishStandalone(job, renderNothingToReview(prep, total, job.settings.problems));
}

/** Publishes a Summary that is not a Review of the diff (nothing reviewed, or too large). */
async function publishStandalone(job: ReviewJob, content: string): Promise<void> {
  if (job.gh.pr.isFork) return job.publish(content);
  const { octokit, repo, pr } = job.gh;
  const body = composeSticky(job.previous, content, pr.headSha, new Date().toISOString());
  await writeSticky(octokit, repo, pr.number, job.existing, body);
}

/** Reviews the selected files and publishes the result. */
export async function reviewPr(job: ReviewJob): Promise<void> {
  const primary = job.brains[0];
  if (!primary) return;
  const setup = await setUp(job, primary);
  if (setup.prep.candidates.length === 0) return publishNothing(job, setup.prep);
  const root = checkoutRoot(process.env);
  const done = await reviewChunks(job, setup, root);
  if (!done) {
    // Every diff was larger than one whole call. A PR that already has a Review keeps it.
    core.info('PR too large: no diff fits a model call.');
    if (job.previous?.sha) return;
    const size = {
      files: setup.prep.candidates.length,
      tokens: setup.prep.candidates.reduce((n, f) => n + diffCost(f), 0),
      budget: setup.primary.maxInputTokens - estimateTokens(setup.system),
    };
    return publishStandalone(job, renderTooLarge(size, job.settings.problems));
  }
  logContext(setup, done, Boolean(root));
  logFailures(done.failures);
  await publishReview(job, done, !root);
}
