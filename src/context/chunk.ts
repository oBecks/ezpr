import type { Finding, Review } from '../prompt/schema';
import { diffCost, type FileEntry } from './budget';

export interface ChunkPlan {
  chunks: FileEntry[][];
  /** Files left out: a diff larger than a whole call, or past the chunk cap. */
  droppedDiffs: string[];
}

/**
 * Packs files into calls of at most `budgetTokens` of diff each, in order, up to
 * `maxChunks`. When everything fits there is exactly one chunk.
 */
export function chunkFiles(files: FileEntry[], budgetTokens: number, maxChunks: number): ChunkPlan {
  const chunks: FileEntry[][] = [];
  const droppedDiffs: string[] = [];
  let current: FileEntry[] = [];
  let used = 0;

  for (const f of files) {
    const cost = diffCost(f);
    if (cost > budgetTokens) {
      droppedDiffs.push(f.path);
      continue;
    }
    if (current.length > 0 && used + cost > budgetTokens) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    if (current.length === 0 && chunks.length >= maxChunks) {
      droppedDiffs.push(f.path);
      continue;
    }
    current.push(f);
    used += cost;
  }
  if (current.length > 0) chunks.push(current);
  return { chunks, droppedDiffs };
}

/** One Review from several chunk Reviews: first summary, Findings deduped by file and line. */
export function mergeReviews(reviews: Review[]): Review {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const r of reviews) {
    for (const f of r.findings) {
      const key = `${f.file}:${f.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(f);
    }
  }
  return { summary: reviews[0]?.summary ?? '', findings };
}
