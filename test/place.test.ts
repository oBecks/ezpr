import { describe, expect, it } from 'vitest';
import { commentedKeys } from '../src/github/comments';
import { INLINE_MARKER } from '../src/config';
import type { Finding } from '../src/prompt/schema';
import { lineKey, placeFindings } from '../src/review/place';

const f = (over: Partial<Finding> = {}): Finding => ({
  file: 'a.ts',
  line: 3,
  severity: 'high',
  message: 'bug',
  ...over,
});
const diff = new Map([['a.ts', new Set([1, 2, 3, 4])]]);

describe('placeFindings', () => {
  it('puts an in-diff finding above the threshold inline', () => {
    expect(placeFindings([f()], diff, new Set())[0]?.placement).toBe('inline');
  });

  it('keeps low severity in the summary by default', () => {
    expect(placeFindings([f({ severity: 'low' })], diff, new Set())[0]?.placement).toBe(
      'low-severity',
    );
  });

  it('includes medium by default', () => {
    expect(placeFindings([f({ severity: 'medium' })], diff, new Set())[0]?.placement).toBe(
      'inline',
    );
  });

  it('moves a line outside the diff to the summary instead of snapping it', () => {
    const [placed] = placeFindings([f({ line: 99 })], diff, new Set());
    expect(placed?.placement).toBe('off-diff');
    expect(placed?.finding.line).toBe(99);
  });

  it('treats an unknown file as off-diff', () => {
    expect(placeFindings([f({ file: 'zzz.ts' })], diff, new Set())[0]?.placement).toBe('off-diff');
  });

  it('skips a line already commented on', () => {
    const done = new Set([lineKey('a.ts', 3)]);
    expect(placeFindings([f()], diff, done)[0]?.placement).toBe('duplicate');
  });

  it('keeps only the most severe finding per line within one run', () => {
    const placed = placeFindings(
      [f({ severity: 'medium', message: 'm' }), f({ severity: 'critical', message: 'c' })],
      diff,
      new Set(),
    );
    expect(placed.map((p) => [p.finding.message, p.placement])).toEqual([
      ['c', 'inline'],
      ['m', 'duplicate'],
    ]);
  });

  it('honours a custom threshold', () => {
    const placed = placeFindings([f({ severity: 'high' })], diff, new Set(), 'critical');
    expect(placed[0]?.placement).toBe('low-severity');
  });
});

describe('commentedKeys', () => {
  it('counts only live EzPR inline comments', () => {
    const keys = commentedKeys([
      { body: `x ${INLINE_MARKER}`, path: 'a.ts', line: 3 },
      { body: 'human comment', path: 'a.ts', line: 4 },
      { body: INLINE_MARKER, path: 'a.ts', line: null },
      { body: null, path: 'a.ts', line: 1 },
    ]);
    expect([...keys]).toEqual(['a.ts:3']);
  });
});
