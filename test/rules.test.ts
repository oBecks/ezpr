import { describe, expect, it } from 'vitest';
import { loadRules, MAX_RULES_CHARS } from '../src/context/rules';

describe('loadRules', () => {
  it('returns null when REVIEW.md is absent or blank', async () => {
    expect(await loadRules(async () => null)).toBeNull();
    expect(await loadRules(async () => '  \n')).toBeNull();
  });

  it('reads REVIEW.md, redacts secrets and truncates with a note', async () => {
    expect(await loadRules(async (p) => (p === 'REVIEW.md' ? ' Be strict. ' : null))).toBe(
      'Be strict.',
    );
    const long = await loadRules(async () => 'a'.repeat(MAX_RULES_CHARS + 50));
    expect(long?.endsWith('[REVIEW.md truncated]')).toBe(true);
    expect(await loadRules(async () => `key ghp_${'a'.repeat(36)}`)).toContain('[REDACTED]');
  });
});
