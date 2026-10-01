import { redact } from './redact';

/** About 4k tokens. */
export const MAX_RULES_CHARS = 16_000;

/** Reads the Project rules (`REVIEW.md`) with `read`, which must read from the base branch (ADR-0006). */
export async function loadRules(
  read: (path: string) => Promise<string | null>,
): Promise<string | null> {
  const text = (await read('REVIEW.md'))?.trim();
  if (!text) return null;
  const clean = redact(text);
  return clean.length > MAX_RULES_CHARS
    ? `${clean.slice(0, MAX_RULES_CHARS)}\n[REVIEW.md truncated]`
    : clean;
}
