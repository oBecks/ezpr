import * as core from '@actions/core';
import * as github from '@actions/github';
import { estimateTokens } from './context/budget';
import { chunkFiles } from './context/chunk';
import { prepareFiles, type RawFile } from './context/collect';
import { makeIgnore, parseIgnore } from './context/ignore';
import { checkoutReader, checkoutRoot, gatherExtras } from './context/repo';
import { loadRules } from './context/rules';
import { MAX_CHUNKS } from './config';
import {
  getSticky,
  listCommentedLines,
  postInline,
  upsertSummary,
  writeSticky,
} from './github/comments';
import {
  fileReader,
  listChangedFiles,
  listChangesSince,
  loadPr,
  readerAt,
  type Octokit,
  type PrInfo,
} from './github/pr';
import { composeSticky, parseSticky, type StickyState } from './github/sticky';
import { buildSystemPrompt } from './prompt/builder';
import type { Finding } from './prompt/schema';
import { ChainError, type ChainFailure } from './providers/chain';
import { buildBrains } from './providers/registry';
import { diffLineMap } from './review/diffmap';
import { reviewInChunks } from './review/chunks';
import { placeFindings } from './review/place';
import { renderErrorComment, renderReview, renderSetupComment } from './render/summary';

type Repo = { owner: string; repo: string };

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

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

/** Reads each repo file at most once per run. */
function cached(read: (path: string) => Promise<string | null>) {
  const cache = new Map<string, Promise<string | null>>();
  return (path: string): Promise<string | null> => {
    let hit = cache.get(path);
    if (!hit) {
      hit = read(path);
      cache.set(path, hit);
    }
    return hit;
  };
}

interface Selection {
  files: RawFile[];
  since?: string;
}

/**
 * The sticky Summary records the last reviewed commit; a new push reviews only what changed
 * since. Null when the head commit was already reviewed.
 */
async function selectFiles(
  octokit: Octokit,
  repo: Repo,
  pr: PrInfo,
  all: RawFile[],
  previousSha: string | undefined,
): Promise<Selection | null> {
  if (!previousSha) return { files: all };
  if (previousSha === pr.headSha) {
    core.info(`Commit ${pr.headSha} was already reviewed; nothing new to review.`);
    return null;
  }
  const changes = await listChangesSince(octokit, repo, previousSha, pr.headSha);
  if (!changes) {
    core.info('Could not diff against the last reviewed commit; reviewing the whole PR.');
    return { files: all };
  }
  core.info(`Incremental review since ${previousSha}.`);
  return { files: changes, since: previousSha };
}

/** Posts the Findings that qualify as inline comments; returns the ones that were posted. */
async function postInlineFindings(
  octokit: Octokit,
  repo: Repo,
  pr: PrInfo,
  allFiles: RawFile[],
  findings: Finding[],
): Promise<Set<Finding>> {
  try {
    // Inline comments must land on lines of the full PR diff, not just the incremental one.
    const placed = placeFindings(
      findings,
      diffLineMap(allFiles),
      await listCommentedLines(octokit, repo, pr.number),
    );
    const wanted = placed.filter((p) => p.placement === 'inline').map((p) => p.finding);
    return new Set(await postInline(octokit, repo, pr.number, pr.headSha, wanted, core.warning));
  } catch (err) {
    core.warning(`Inline comments failed: ${errorText(err)}`);
    return new Set();
  }
}

interface ReviewJob {
  octokit: Octokit;
  repo: Repo;
  pr: PrInfo;
  brains: ReturnType<typeof buildBrains>;
  /** Every file of the PR. */
  all: RawFile[];
  selection: Selection;
  previous: StickyState | undefined;
  existing: Awaited<ReturnType<typeof getSticky>>;
  publish: (body: string) => Promise<void>;
}

async function reviewPr(job: ReviewJob): Promise<void> {
  const { octokit, repo, pr, brains, all, selection } = job;
  const primary = brains[0];
  const ignored = makeIgnore(parseIgnore(core.getInput('ignore')));
  const read = cached(fileReader(octokit, pr));
  // Project rules come from the base branch so a PR cannot rewrite its own rules (ADR-0006).
  const system = buildSystemPrompt(await loadRules(readerAt(octokit, repo, pr.baseSha)));
  const prep = await prepareFiles(selection.files, read, ignored);
  if (!primary || prep.candidates.length === 0) {
    core.info('No reviewable files in this PR.');
    return;
  }

  // Imports and callers come from the checkout when there is one (ADR-0007).
  const root = checkoutRoot(process.env);
  const readRepo = root ? checkoutReader(root) : read;
  const changed = new Set(all.map((f) => f.path));
  const reserved = estimateTokens(system);
  // Chunks are sized for the first Brain; a smaller fallback Brain trims its own copy.
  const plan = chunkFiles(prep.candidates, primary.maxInputTokens - reserved, MAX_CHUNKS);
  if (plan.chunks.length > 1) core.info(`Large PR: reviewing in ${plan.chunks.length} parts.`);

  const done = await reviewInChunks({
    brains,
    system,
    reserved,
    prep,
    chunks: plan.chunks,
    droppedDiffs: plan.droppedDiffs,
    meta: { title: pr.title, body: pr.body, since: selection.since },
    gather: async (chunk) => {
      try {
        return await gatherExtras(chunk, { read: readRepo, root, changed, ignored });
      } catch (err) {
        core.warning(`Could not gather extra context: ${errorText(err)}`);
        return {};
      }
    },
    warn: core.warning,
  });
  if (!done) {
    core.info('No reviewable files in this PR.');
    return;
  }
  logFailures(done.failures);

  const inline = pr.isFork
    ? new Set<Finding>()
    : await postInlineFindings(octokit, repo, pr, all, done.review.findings);
  const content = renderReview(done.review, done.used.join(', '), done.ctx, dedupe(done.failures), {
    inline,
    since: selection.since,
    parts: done.parts,
    noCheckout: !root,
  });
  if (pr.isFork) {
    await job.publish(content);
    return;
  }
  const body = composeSticky(job.previous, content, pr.headSha, new Date().toISOString());
  await writeSticky(octokit, repo, pr.number, job.existing, body);
}

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

  const all = await listChangedFiles(octokit, repo, pr.number);
  const existing = pr.isFork ? undefined : await getSticky(octokit, repo, pr.number);
  const previous = existing?.body ? parseSticky(existing.body) : undefined;
  const selection = await selectFiles(octokit, repo, pr, all, previous?.sha);
  if (!selection) return;

  try {
    await reviewPr({ octokit, repo, pr, brains, all, selection, previous, existing, publish });
  } catch (err) {
    core.error(errorText(err));
    await publish(
      renderErrorComment(errorText(err), err instanceof ChainError ? err.failures : []),
    );
  }
}

run().catch((err) => core.setFailed(errorText(err)));
