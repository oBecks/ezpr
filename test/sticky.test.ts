import { describe, expect, it } from 'vitest';
import { SUMMARY_MARKER } from '../src/config';
import { buildMarker, composeSticky, formatTime, parseSticky } from '../src/github/sticky';

const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const SHA3 = 'c'.repeat(40);
const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-01T11:30:00.000Z';
const T3 = '2026-10-02T09:15:00.000Z';

describe('parseSticky', () => {
  it('reads sha and time from the marker', () => {
    const s = parseSticky(`${buildMarker(SHA1, T1)}\n## EzPR review\nhello`);
    expect(s.sha).toBe(SHA1);
    expect(s.at).toBe(T1);
    expect(s.latest).toBe('## EzPR review\nhello');
    expect(s.history).toEqual([]);
  });

  it('treats the plain marker (setup/error comments) as having no sha', () => {
    const s = parseSticky(`${SUMMARY_MARKER}\n## EzPR needs an API key`);
    expect(s.sha).toBeUndefined();
    expect(s.latest).toBe('## EzPR needs an API key');
  });

  it('copes with a body without any marker', () => {
    const s = parseSticky('just text');
    expect(s.sha).toBeUndefined();
    expect(s.latest).toBe('just text');
  });
});

describe('composeSticky', () => {
  it('has no history section for a first review', () => {
    const body = composeSticky(undefined, 'first', SHA1, T1);
    expect(body).toBe(`${buildMarker(SHA1, T1)}\nfirst`);
  });

  it('moves the previous review into a collapsed section labelled with sha and time', () => {
    const first = composeSticky(undefined, 'first', SHA1, T1);
    const second = composeSticky(parseSticky(first), 'second', SHA2, T2);
    expect(second.startsWith(`${buildMarker(SHA2, T2)}\nsecond\n`)).toBe(true);
    expect(second).toContain('<details>');
    expect(second).toContain(`\`${SHA1.slice(0, 7)}\` · ${formatTime(T1)}`);
    expect(second).toContain('first');
  });

  it('round-trips and keeps the newest history entry first', () => {
    const a = composeSticky(undefined, 'first', SHA1, T1);
    const b = composeSticky(parseSticky(a), 'second', SHA2, T2);
    const c = composeSticky(parseSticky(b), 'third', SHA3, T3);
    const parsed = parseSticky(c);
    expect(parsed.sha).toBe(SHA3);
    expect(parsed.latest).toBe('third');
    expect(parsed.history.map((h) => [h.sha, h.body])).toEqual([
      [SHA2, 'second'],
      [SHA1, 'first'],
    ]);
  });

  it('does not push a setup/error comment into the history', () => {
    const prev = parseSticky(`${SUMMARY_MARKER}\n## EzPR needs an API key`);
    expect(composeSticky(prev, 'first', SHA1, T1)).toBe(`${buildMarker(SHA1, T1)}\nfirst`);
  });

  it('caps the history length', () => {
    let body = composeSticky(undefined, 'r0', SHA1, T1);
    for (let i = 1; i <= 15; i++) body = composeSticky(parseSticky(body), `r${i}`, SHA1, T1);
    expect(parseSticky(body).history).toHaveLength(10);
    expect(parseSticky(body).history[0]?.body).toBe('r14');
  });
});

describe('formatTime', () => {
  it('renders a short UTC label', () => {
    expect(formatTime(T2)).toBe('2026-10-01 11:30 UTC');
  });
});
