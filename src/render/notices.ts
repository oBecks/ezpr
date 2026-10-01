import { SUMMARY_MARKER } from '../config';
import { adviceFor, describeFailure } from '../providers/errors';
import type { ChainFailure } from '../providers/chain';

/** Shown when size cost a Review some files, or all of them. */
export const SIZE_TIPS =
  'Try splitting the PR into smaller ones, or add generated or vendored paths to `ignore` (in `.ezpr.yml` or the action input).';

/** Problems with `.ezpr.yml` or the action inputs; the rest of the config still applied. */
export function renderConfigProblems(problems: string[] = []): string[] {
  if (!problems.length) return [];
  return ['> ⚠️ Config problems:', ...problems.map((p) => `> - ${p}`), ''];
}

/** Appends config problems to a Summary that is not a Review. */
export function withConfigProblems(content: string, problems: string[]): string {
  return [content, '', ...renderConfigProblems(problems)].join('\n').trimEnd();
}

/** The Summary for a PR whose files all had diffs too big for one model call. */
export function renderTooLarge(size: { files: number; tokens: number; budget: number }): string {
  return [
    '## EzPR review',
    '',
    `This PR is too large to review: ${size.files} changed file(s), about ${size.tokens.toLocaleString('en-US')} tokens of diff, and no model call can take more than about ${size.budget.toLocaleString('en-US')}. Nothing was sent to a model.`,
    '',
    SIZE_TIPS,
  ]
    .join('\n')
    .trimEnd();
}

/** One bullet per Brain and failure kind, each with what to do about it. */
function renderFailureAdvice(failures: ChainFailure[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const f of failures) {
    const key = `${f.brain}:${f.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- \`${f.brain}\` ${describeFailure(f.kind)}. ${adviceFor(f.kind)}`);
  }
  return lines;
}

export function renderErrorComment(message: string, failures: ChainFailure[] = []): string {
  return [
    SUMMARY_MARKER,
    '## EzPR could not complete the review',
    '',
    ...(failures.length
      ? ['Every model failed:', '', ...renderFailureAdvice(failures)]
      : [message]),
    '',
    'The job log has details. Re-push or re-run the workflow to try again.',
  ].join('\n');
}

/** A Command that failed. Not a Summary, so no marker: it must never replace the sticky comment. */
export function renderCommandError(what: string, message: string, failures: ChainFailure[] = []) {
  return [
    `EzPR could not ${what}.`,
    '',
    ...(failures.length
      ? ['Every model failed:', '', ...renderFailureAdvice(failures)]
      : [message]),
  ].join('\n');
}
