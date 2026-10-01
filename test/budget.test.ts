import { describe, expect, it } from 'vitest';
import { estimateTokens, fitToBudget, type FileEntry } from '../src/context/budget';

const file = (path: string, patch: string, content?: string): FileEntry => ({
  path,
  status: 'modified',
  patch,
  content,
});

describe('fitToBudget', () => {
  it('keeps everything when the budget is large', () => {
    const r = fitToBudget([file('a.ts', 'diff', 'full a')], 10_000);
    expect(r.files[0]?.content).toBe('full a');
    expect(r.droppedDiffs).toEqual([]);
    expect(r.droppedContents).toEqual([]);
  });

  it('drops full contents before diffs, smallest contents first', () => {
    const small = file('small.ts', 'd', 'x'.repeat(40));
    const big = file('big.ts', 'd', 'y'.repeat(4000));
    const diffCost = 2 * (estimateTokens('d') + estimateTokens('small.ts') + 10);
    const r = fitToBudget([big, small], diffCost + 20);
    expect(r.files.map((f) => f.path)).toEqual(['big.ts', 'small.ts']);
    expect(r.files.find((f) => f.path === 'small.ts')?.content).toBeDefined();
    expect(r.files.find((f) => f.path === 'big.ts')?.content).toBeUndefined();
    expect(r.droppedContents).toEqual(['big.ts']);
  });

  it('drops whole files only when even the diffs do not fit', () => {
    const r = fitToBudget([file('a.ts', 'x'.repeat(400)), file('b.ts', 'x'.repeat(400))], 120);
    expect(r.files.map((f) => f.path)).toEqual(['a.ts']);
    expect(r.droppedDiffs).toEqual(['b.ts']);
  });

  it('drops callers, then imports, only after file contents are placed', () => {
    const a = file('a.ts', 'd', 'x'.repeat(40));
    const used =
      estimateTokens('d') + estimateTokens('a.ts') + 10 + estimateTokens(a.content ?? '');
    const caller = { path: 'c.ts', line: 1, symbol: 'sym', snippet: 'y'.repeat(200) };
    const imp = { path: 'i.ts', importedBy: 'a.ts', content: 'z'.repeat(40) };
    const callerCost = estimateTokens(caller.snippet) + estimateTokens(caller.path) + 10;

    const some = fitToBudget([a], used + callerCost - 1, { callers: [caller], imports: [imp] });
    expect(some.droppedCallers).toBe(1);
    expect(some.imports.map((i) => i.path)).toEqual(['i.ts']);

    const tight = fitToBudget([a], used, { callers: [caller], imports: [imp] });
    expect(tight.droppedContents).toEqual([]);
    expect(tight.droppedCallers).toBe(1);
    expect(tight.droppedImports).toEqual(['i.ts']);
  });
});
