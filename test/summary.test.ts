import { describe, expect, it } from 'vitest';
import type { Context } from '../src/context/collect';
import { renderErrorComment, renderTooLarge, withConfigProblems } from '../src/render/notices';
import { renderFailures, renderNothingToReview, renderReview } from '../src/render/summary';

const file = (path: string) => ({ path, status: 'modified', patch: '+x' });
const ctx = (over: Partial<Context> = {}): Context => ({
  files: [file('a.ts')],
  callers: [],
  imports: [],
  skippedNoise: [],
  skippedSecrets: [],
  skippedIgnored: [],
  missingPatch: [],
  droppedDiffs: [],
  droppedContents: [],
  droppedCallers: 0,
  droppedImports: [],
  ...over,
});
const review = { summary: 'Looks fine.', findings: [] };

describe('renderReview coverage', () => {
  it('stays quiet when every file was reviewed', () => {
    expect(renderReview(review, 'g', ctx())).not.toContain('Partial review');
  });

  it('warns about partial coverage and names unreviewed files apart from trimmed ones', () => {
    const text = renderReview(review, 'g, o', ctx({ droppedDiffs: ['big.ts'] }), [], {
      parts: 2,
      plannedParts: 3,
      unreviewed: ['x.ts', 'y.ts'],
    });
    expect(text).toContain('Partial review: 1 of 4 changed files were reviewed');
    expect(text).toContain('2 of 3 parts reviewed');
    expect(text).toContain('Not reviewed (no model could handle this part): `x.ts`, `y.ts`');
    expect(text).toContain('left out to fit model limits: `big.ts`');
  });

  it('lists ignored and secret-like files that were never sent', () => {
    const text = renderReview(
      review,
      'g',
      ctx({ skippedIgnored: ['src/secret-notes.ts'], skippedSecrets: ['.env'] }),
    );
    expect(text).toContain('Not sent to a model');
    expect(text).toContain('`src/secret-notes.ts`, `.env`');
  });

  it('names files GitHub sent no diff for', () => {
    const text = renderReview(review, 'g', ctx({ missingPatch: ['src/huge.ts'] }));
    expect(text).toContain('No diff available from GitHub');
    expect(text).toContain('`src/huge.ts`');
  });

  it('caps long path lists', () => {
    const many = Array.from({ length: 13 }, (_, i) => `f${i}.ts`);
    expect(renderReview(review, 'g', ctx({ skippedIgnored: many }))).toContain('and 3 more');
  });
});

describe('renderFailures', () => {
  const f = (brain: string) => ({ brain, kind: 'rate-limit' as const, error: 'x' });

  it('says "fell back past" only for Brains that wrote no part', () => {
    expect(renderFailures([f('a')], ['b'])).toBe('Fell back past: `a` rate-limited.');
  });

  it('says a Brain that also wrote a part failed only on some parts', () => {
    expect(renderFailures([f('a'), f('b')], ['a'])).toBe(
      'Fell back past: `b` rate-limited. Failed on some parts: `a` rate-limited.',
    );
  });
});

describe('renderNothingToReview', () => {
  it('explains each reason files were skipped', () => {
    const text = renderNothingToReview(
      {
        skippedNoise: ['package-lock.json'],
        skippedSecrets: [],
        skippedIgnored: ['docs/x.md'],
        missingPatch: ['src/huge.ts'],
      },
      3,
    );
    expect(text).toContain('all 3 changed file(s) were skipped');
    expect(text).toContain('No diff available from GitHub');
    expect(text).toContain('`ignore` list');
    expect(text).toContain('`package-lock.json`');
    expect(text).not.toContain('Secret-like');
  });
});

describe('Phase 5 comments', () => {
  it('shows config problems in a Review and gives size tips on a trimmed one', () => {
    const text = renderReview(review, 'g', ctx({ droppedDiffs: ['big.ts'] }), [], {
      configProblems: ['Unknown key `x` was ignored.'],
    });
    expect(text).toContain('Config problems');
    expect(text).toContain('Unknown key `x` was ignored.');
    expect(text).toContain('splitting the PR');
  });

  it('gives no size tips when nothing was trimmed', () => {
    expect(renderReview(review, 'g', ctx())).not.toContain('splitting the PR');
  });

  it('explains a too-large PR with counts and tips', () => {
    const text = withConfigProblems(renderTooLarge({ files: 3, tokens: 250_000, budget: 98_000 }), [
      'bad key',
    ]);
    expect(text).toContain('too large to review: 3 changed file(s)');
    expect(text).toContain('250,000');
    expect(text).toContain('98,000');
    expect(text).toContain('splitting the PR');
    expect(text).toContain('bad key');
  });

  it('adds config problems to the nothing-to-review Summary', () => {
    const prep = {
      skippedNoise: ['a.lock'],
      skippedSecrets: [],
      skippedIgnored: [],
      missingPatch: [],
    };
    expect(withConfigProblems(renderNothingToReview(prep, 1), ['bad key'])).toContain('bad key');
  });

  it('names each failed Brain once with advice when every model failed', () => {
    const text = renderErrorComment('x', [
      { brain: 'gemini/g', kind: 'auth', error: 'e' },
      { brain: 'gemini/g', kind: 'auth', error: 'e2' },
      { brain: 'groq/m', kind: 'rate-limit', error: 'e' },
    ]);
    expect(text.match(/`gemini\/g`/g)).toHaveLength(1);
    expect(text).toContain('check the secret');
    expect(text).toContain('re-run later');
  });

  it('keeps the plain message when there are no Brain failures', () => {
    expect(renderErrorComment('boom')).toContain('boom');
  });
});
