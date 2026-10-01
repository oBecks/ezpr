import { INLINE_MIN_SEVERITY, SEVERITIES, type Severity } from '../config';
import type { Finding } from '../prompt/schema';

/** Why a Finding is (or is not) an inline comment. Everything but `inline` stays in the Summary. */
export type Placement = 'inline' | 'low-severity' | 'off-diff' | 'duplicate';

export interface Placed {
  finding: Finding;
  placement: Placement;
}

export function lineKey(path: string, line: number): string {
  return `${path}:${line}`;
}

export function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s);
}

/**
 * Decide, per Finding, whether it becomes an inline comment. Most severe first.
 * - below the threshold: Summary only
 * - line not in the diff: Summary only (never moved to another line)
 * - path and line already commented on (earlier Review, or earlier in this one): skipped
 */
export function placeFindings(
  findings: Finding[],
  diffLines: Map<string, Set<number>>,
  commented: ReadonlySet<string>,
  minSeverity: Severity = INLINE_MIN_SEVERITY,
): Placed[] {
  const taken = new Set(commented);
  const sorted = [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  return sorted.map((finding) => {
    if (severityRank(finding.severity) > severityRank(minSeverity)) {
      return { finding, placement: 'low-severity' };
    }
    if (!diffLines.get(finding.file)?.has(finding.line)) {
      return { finding, placement: 'off-diff' };
    }
    const key = lineKey(finding.file, finding.line);
    if (taken.has(key)) return { finding, placement: 'duplicate' };
    taken.add(key);
    return { finding, placement: 'inline' };
  });
}
