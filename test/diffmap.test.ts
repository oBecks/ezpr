import { describe, expect, it } from 'vitest';
import { diffLineMap, diffLineTexts, parseDiffLines } from '../src/review/diffmap';

const patch = [
  '@@ -1,4 +1,5 @@',
  ' line one',
  '-old two',
  '+new two',
  '+extra',
  ' line three',
  ' line four',
  '@@ -20,2 +21,2 @@',
  ' ctx',
  '-gone',
  '+added',
  '\\ No newline at end of file',
].join('\n');

describe('parseDiffLines', () => {
  it('maps added and context lines to new-file numbers', () => {
    expect([...parseDiffLines(patch)]).toEqual([1, 2, 3, 4, 5, 21, 22]);
  });

  it('excludes lines outside every hunk', () => {
    const lines = parseDiffLines(patch);
    expect(lines.has(6)).toBe(false);
    expect(lines.has(20)).toBe(false);
  });

  it('handles a header without counts (single-line hunk)', () => {
    expect([...parseDiffLines('@@ -0,0 +1 @@\n+only')]).toEqual([1]);
  });

  it('treats a blank line inside a hunk as context', () => {
    expect([...parseDiffLines('@@ -1,3 +1,3 @@\n a\n\n c')]).toEqual([1, 2, 3]);
  });

  it('does not count removed lines', () => {
    expect([...parseDiffLines('@@ -5,2 +5,0 @@\n-a\n-b')]).toEqual([]);
  });
});

describe('diffLineMap', () => {
  it('keys by path and skips files without a patch', () => {
    const map = diffLineMap([{ path: 'a.ts', patch: '@@ -1 +1 @@\n+x' }, { path: 'bin.png' }]);
    expect([...map.keys()]).toEqual(['a.ts']);
  });
});

describe('diffLineTexts', () => {
  it('maps each commentable line to its text', () => {
    const patch = '@@ -1,2 +1,3 @@\n keep\n+added\n keep2';
    const texts = diffLineTexts([{ path: 'a.ts', patch }, { path: 'bin.png' }]);
    expect(texts.get('a.ts')).toEqual(
      new Map([
        [1, 'keep'],
        [2, 'added'],
        [3, 'keep2'],
      ]),
    );
    expect(texts.has('bin.png')).toBe(false);
  });
});
