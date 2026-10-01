import { createHash } from 'node:crypto';
import type { Finding } from '../prompt/schema';

/**
 * Identity of a Finding for `@ezpr ignore`: the file and the message, not the line, so it
 * survives line shifts. A reworded message from the model counts as a new Finding.
 */
export function findingKey(path: string, message: string): string {
  const text = message.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha1').update(`${path}\n${text}`).digest('hex').slice(0, 12);
}

/** Drops the Findings a maintainer has dismissed. */
export function withoutDismissed(findings: Finding[], dismissed: readonly string[]): Finding[] {
  if (dismissed.length === 0) return findings;
  const gone = new Set(dismissed);
  return findings.filter((f) => !gone.has(findingKey(f.file, f.message)));
}
