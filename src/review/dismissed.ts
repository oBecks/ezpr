import { createHash } from 'node:crypto';
import type { Finding } from '../prompt/schema';

/**
 * Identity of a Finding for `@ezpr ignore`: the file and the text of the line it sits on. A
 * model words the same issue differently on every run, and line numbers shift, but the code
 * stays the same until someone edits it, which is when a fresh look is due anyway.
 */
export function findingKey(path: string, lineText: string): string {
  const text = lineText.replace(/\s+/g, ' ').trim();
  return createHash('sha1').update(`${path}\n${text}`).digest('hex').slice(0, 12);
}

/** The commented line is the last line of a review comment's diff hunk, minus its +/space. */
export function hunkLineText(diffHunk: string): string {
  const last = diffHunk.trimEnd().split('\n').at(-1) ?? '';
  return last.slice(1);
}

/** Drops the Findings a maintainer has dismissed. Lines outside the diff cannot be dismissed. */
export function withoutDismissed(
  findings: Finding[],
  dismissed: readonly string[],
  lineTexts: Map<string, Map<number, string>>,
): Finding[] {
  if (dismissed.length === 0) return findings;
  const gone = new Set(dismissed);
  return findings.filter((f) => {
    const text = lineTexts.get(f.file)?.get(f.line);
    return text === undefined || !gone.has(findingKey(f.file, text));
  });
}
