import { describe, expect, it } from 'vitest';
import { makeIgnore, parseIgnore } from '../src/context/ignore';

describe('parseIgnore', () => {
  it('drops blanks and comments', () => {
    expect(parseIgnore('docs/**\n\n# note\n  *.generated.ts \r\n')).toEqual([
      'docs/**',
      '*.generated.ts',
    ]);
  });
});

describe('makeIgnore', () => {
  it('matches a bare name at any depth', () => {
    const ig = makeIgnore(['*.generated.ts']);
    expect(ig('a.generated.ts')).toBe(true);
    expect(ig('src/deep/a.generated.ts')).toBe(true);
    expect(ig('src/a.ts')).toBe(false);
  });

  it('anchors patterns that contain a slash', () => {
    const ig = makeIgnore(['docs/**', '/legacy/']);
    expect(ig('docs/a/b.md')).toBe(true);
    expect(ig('src/docs/a.md')).toBe(false);
    expect(ig('legacy/x.ts')).toBe(true);
  });

  it('ignores everything below a matched directory', () => {
    expect(makeIgnore(['fixtures'])('test/fixtures/a/b.ts')).toBe(true);
  });
});
