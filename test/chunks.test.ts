import { describe, expect, it } from 'vitest';
import { diffCost, type FileEntry } from '../src/context/budget';
import { ChainError } from '../src/providers/chain';
import type { Brain } from '../src/providers/types';
import { orderForChunk, reviewInChunks } from '../src/review/chunks';

const file = (path: string, size = 400): FileEntry => ({
  path,
  status: 'modified',
  patch: 'x'.repeat(size),
});

const brain = (id: string, maxInputTokens: number, review?: Brain['review']): Brain => ({
  provider: 'gemini',
  id,
  maxInputTokens,
  review: review ?? (async () => ({ summary: id, findings: [] })),
});

const prep = (candidates: FileEntry[]) => ({
  candidates,
  skippedNoise: [],
  skippedSecrets: [],
  skippedIgnored: [],
  missingPatch: [],
});

describe('orderForChunk', () => {
  it('puts Brains that fit the whole chunk first, keeping order, smaller ones last', () => {
    const chunk = [file('a'), file('b')];
    const need = chunk.reduce((n, f) => n + diffCost(f), 0);
    const small = brain('small', need - 1);
    const big1 = brain('big1', need);
    const big2 = brain('big2', need * 2);
    expect(orderForChunk([small, big1, big2], chunk, 0).map((b) => b.id)).toEqual([
      'big1',
      'big2',
      'small',
    ]);
  });
});

describe('reviewInChunks', () => {
  const run = (brains: Brain[], chunks: FileEntry[][], droppedDiffs: string[] = []) =>
    reviewInChunks({
      brains,
      system: '',
      reserved: 0,
      prep: prep(chunks.flat()),
      chunks,
      droppedDiffs,
      meta: { title: 't', body: '' },
      gather: async () => ({}),
      warn: () => {},
    });

  it('reports files of a failed later part as unreviewed, not as budget omissions', async () => {
    const chunks = [[file('a')], [file('b')], [file('c')]];
    let call = 0;
    const flaky = brain('g', 100_000, async () => {
      call += 1;
      if (call === 2) throw new Error('boom');
      return { summary: 's', findings: [] };
    });
    const r = await run([flaky], chunks, ['huge.ts']);
    expect(r?.parts).toBe(2);
    expect(r?.plannedParts).toBe(3);
    expect(r?.unreviewed).toEqual(['b']);
    expect(r?.ctx.droppedDiffs).toEqual(['huge.ts']);
    expect(r?.failures.map((f) => f.brain)).toEqual(['g']);
  });

  it('sends a chunk to a larger fallback Brain instead of trimming it on a smaller one', async () => {
    const chunk = [file('a', 4000), file('b', 4000)];
    const need = chunk.reduce((n, f) => n + diffCost(f), 0);
    const small = brain('small', need - 1);
    const big = brain('big', need);
    const r = await run([small, big], [chunk]);
    expect(r?.used).toEqual(['big']);
    expect(r?.ctx.files.map((f) => f.path)).toEqual(['a', 'b']);
    expect(r?.unreviewed).toEqual([]);
  });

  it('still throws when the first part fails', async () => {
    const dead = brain('g', 100_000, async () => {
      throw new Error('boom');
    });
    await expect(run([dead], [[file('a')]])).rejects.toBeInstanceOf(ChainError);
  });
});
