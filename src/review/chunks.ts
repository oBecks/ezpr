import { diffCost, type FileEntry } from '../context/budget';
import { mergeReviews } from '../context/chunk';
import { buildContext, type Context, type Prepared } from '../context/collect';
import type { Extras } from '../context/budget';
import { buildPrompt } from '../prompt/builder';
import type { Review } from '../prompt/schema';
import { ChainError, runChain, type ChainFailure } from '../providers/chain';
import type { Brain } from '../providers/types';

export interface ChunkedInput {
  brains: Brain[];
  system: string;
  /** Tokens already taken by the system prompt. */
  reserved: number;
  prep: Prepared;
  chunks: FileEntry[][];
  /** Files already left out before the Brains were asked. */
  droppedDiffs: string[];
  meta: { title: string; body: string; since?: string };
  /** Imported files and Caller snippets for one chunk; must not throw. */
  gather: (chunk: FileEntry[]) => Promise<Extras>;
  warn: (message: string) => void;
}

export interface ChunkedResult {
  review: Review;
  ctx: Context;
  /** Ids of the Brains that wrote a part, in order, without repeats. */
  used: string[];
  failures: ChainFailure[];
  /** Parts that produced a Review, and parts planned. */
  parts: number;
  plannedParts: number;
  /** Files of parts that no Brain could review. Distinct from files trimmed to fit a budget. */
  unreviewed: string[];
}

interface Part {
  review: Review;
  ctx: Context;
  brain: string;
}

/**
 * Chunks are sized for the first Brain, so a smaller fallback Brain would have to drop files.
 * Brains that can take the whole chunk go first (keeping their order); the smaller ones stay
 * as a last resort so a part is trimmed rather than lost.
 */
export function orderForChunk(brains: Brain[], chunk: FileEntry[], reserved: number): Brain[] {
  const need = chunk.reduce((n, f) => n + diffCost(f), 0);
  const fits = (b: Brain) => b.maxInputTokens - reserved >= need;
  return [...brains.filter(fits), ...brains.filter((b) => !fits(b))];
}

async function reviewPart(
  input: ChunkedInput,
  chunk: FileEntry[],
  failures: ChainFailure[],
): Promise<Part | null> {
  const extras = await input.gather(chunk);
  const done = await runChain(orderForChunk(input.brains, chunk, input.reserved), async (b) => {
    // Each Brain gets Context trimmed to its own budget.
    const ctx = buildContext(input.prep, chunk, b.maxInputTokens - input.reserved, extras);
    if (ctx.files.length === 0) return null;
    const prompt = buildPrompt(input.meta, ctx);
    return { review: await b.review(input.system, prompt), ctx };
  });
  failures.push(...done.failures);
  return done.result ? { ...done.result, brain: done.brain.id } : null;
}

/** The first part failing is a failed Review; a later part is reported as not reviewed. */
async function tryPart(
  input: ChunkedInput,
  chunk: FileEntry[],
  index: number,
  failures: ChainFailure[],
): Promise<Part | null> {
  try {
    return await reviewPart(input, chunk, failures);
  } catch (err) {
    if (index === 0 || !(err instanceof ChainError)) throw err;
    input.warn(`Part ${index + 1} failed: ${err.message}`);
    failures.push(...err.failures);
    return null;
  }
}

function mergeContexts(prep: Prepared, ctxs: Context[], droppedDiffs: string[]): Context {
  return {
    ...prep,
    files: ctxs.flatMap((c) => c.files),
    callers: ctxs.flatMap((c) => c.callers),
    imports: ctxs.flatMap((c) => c.imports),
    droppedDiffs: [...droppedDiffs, ...ctxs.flatMap((c) => c.droppedDiffs)],
    droppedContents: ctxs.flatMap((c) => c.droppedContents),
    droppedCallers: ctxs.reduce((n, c) => n + c.droppedCallers, 0),
    droppedImports: ctxs.flatMap((c) => c.droppedImports),
  };
}

/** Reviews each chunk in turn through the fallback chain and merges the results. */
export async function reviewInChunks(input: ChunkedInput): Promise<ChunkedResult | null> {
  const failures: ChainFailure[] = [];
  const parts: Part[] = [];
  const unreviewed: string[] = [];
  for (const [index, chunk] of input.chunks.entries()) {
    const part = await tryPart(input, chunk, index, failures);
    if (part) parts.push(part);
    else unreviewed.push(...chunk.map((f) => f.path));
  }
  if (parts.length === 0) return null;
  return {
    review: mergeReviews(parts.map((p) => p.review)),
    ctx: mergeContexts(
      input.prep,
      parts.map((p) => p.ctx),
      input.droppedDiffs,
    ),
    used: [...new Set(parts.map((p) => p.brain))],
    failures,
    parts: parts.length,
    plannedParts: input.chunks.length,
    unreviewed,
  };
}
