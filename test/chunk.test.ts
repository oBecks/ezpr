import { describe, expect, it } from 'vitest';
import { diffCost, type FileEntry } from '../src/context/budget';
import { chunkFiles, mergeReviews } from '../src/context/chunk';

const f = (path: string, size: number): FileEntry => ({
  path,
  status: 'modified',
  patch: 'x'.repeat(size),
});

describe('chunkFiles', () => {
  it('keeps everything in one chunk when it fits', () => {
    const files = [f('a', 100), f('b', 100)];
    expect(chunkFiles(files, 10_000, 3)).toEqual({ chunks: [files], droppedDiffs: [] });
  });

  it('packs greedily in order and starts a new chunk when full', () => {
    const files = [f('a', 400), f('b', 400), f('c', 400), f('d', 400)];
    const budget = diffCost(files[0] as FileEntry) * 2;
    const plan = chunkFiles(files, budget, 3);
    expect(plan.chunks.map((c) => c.map((x) => x.path))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('names a diff bigger than a whole call and files past the chunk cap', () => {
    const files = [f('huge', 100_000), f('a', 400), f('b', 400), f('c', 400)];
    const budget = diffCost(files[1] as FileEntry);
    const plan = chunkFiles(files, budget, 2);
    expect(plan.chunks.map((c) => c.map((x) => x.path))).toEqual([['a'], ['b']]);
    expect(plan.droppedDiffs).toEqual(['huge', 'c']);
  });
});

describe('mergeReviews', () => {
  it('uses the first summary and dedupes findings by file and line', () => {
    const a = { file: 'a.ts', line: 1, severity: 'high', message: 'one' } as const;
    const merged = mergeReviews([
      { summary: 'first', findings: [a] },
      {
        summary: 'second',
        findings: [
          { ...a, message: 'dup' },
          { ...a, line: 2 },
        ],
      },
    ]);
    expect(merged.summary).toBe('first');
    expect(merged.findings.map((x) => `${x.line}:${x.message}`)).toEqual(['1:one', '2:one']);
  });
});
