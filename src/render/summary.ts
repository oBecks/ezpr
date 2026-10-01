import { SUMMARY_MARKER } from '../config';
import type { Context, Prepared } from '../context/collect';
import { shortSha } from '../github/sticky';
import type { Finding, Review } from '../prompt/schema';
import type { ChainFailure } from '../providers/chain';
import { adviceFor, describeFailure } from '../providers/errors';

const ICON = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' } as const;

const MAX_LISTED = 10;

function paths(list: string[]): string {
  const shown = list.slice(0, MAX_LISTED).map((p) => `\`${p}\``);
  const more = list.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

/** Shown when size cost a Review some files, or all of them. */
export const SIZE_TIPS =
  'Try splitting the PR into smaller ones, or add generated or vendored paths to `ignore` (in `.ezpr.yml` or the action input).';

/** Problems with `.ezpr.yml` or the action inputs; the rest of the config still applied. */
export function renderConfigProblems(problems: string[] = []): string[] {
  if (!problems.length) return [];
  return ['> ⚠️ Config problems:', ...problems.map((p) => `> - ${p}`), ''];
}

export function renderReview(
  review: Review,
  brainId: string,
  ctx: Context,
  failures: ChainFailure[] = [],
  opts: {
    inline?: ReadonlySet<Finding>;
    since?: string;
    /** Chunks that produced a Review, and Chunks planned. */
    parts?: number;
    plannedParts?: number;
    /** Files of Chunks that no Brain could review. */
    unreviewed?: string[];
    /** Ids of the Brains that wrote a part. */
    used?: string[];
    /** The workflow had no repo checkout, so Caller snippets were not searched. */
    noCheckout?: boolean;
    configProblems?: string[];
  } = {},
): string {
  const lines = ['## EzPR review', ''];
  if (opts.since) {
    lines.push(`_Incremental review: changes since \`${shortSha(opts.since)}\`._`, '');
  }
  lines.push(review.summary, '');
  const planned = opts.plannedParts ?? opts.parts ?? 1;
  if (planned > 1) {
    const done = opts.parts ?? planned;
    lines.push(
      done === planned
        ? `_Large PR: reviewed in ${planned} parts._`
        : `_Large PR: ${done} of ${planned} parts reviewed._`,
      '',
    );
  }

  if (review.findings.length) {
    lines.push('### Findings', '');
    for (const f of review.findings) {
      const tag = opts.inline?.has(f) ? ' _(inline comment)_' : '';
      lines.push(
        `- ${ICON[f.severity]} **${f.severity}** \`${f.file}:${f.line}\` — ${f.message}${tag}`,
      );
    }
    lines.push('');
  }

  const unreviewed = opts.unreviewed ?? [];
  const notSeen = ctx.droppedDiffs.length + unreviewed.length;
  if (notSeen > 0) {
    const total = ctx.files.length + notSeen;
    lines.push(
      `> ⚠️ Partial review: ${ctx.files.length} of ${total} changed files were reviewed. The summary above covers only those.`,
      '',
    );
    if (ctx.droppedDiffs.length) lines.push(`> ${SIZE_TIPS}`, '');
  }
  if (unreviewed.length) {
    lines.push(`> Not reviewed (no model could handle this part): ${paths(unreviewed)}`, '');
  }
  if (ctx.missingPatch.length) {
    lines.push(
      `> No diff available from GitHub (the change is too large; try splitting the PR): ${paths(ctx.missingPatch)}`,
      '',
    );
  }
  const skipped = [...ctx.skippedIgnored, ...ctx.skippedSecrets];
  if (skipped.length) {
    lines.push(`> Not sent to a model (ignore list or secret-like files): ${paths(skipped)}`, '');
  }
  const omitted = [...ctx.droppedDiffs, ...ctx.droppedContents, ...ctx.droppedImports];
  if (ctx.droppedCallers) omitted.push(`${ctx.droppedCallers} caller snippet(s)`);
  if (omitted.length) {
    const list = omitted.map((p) => `\`${p}\``).join(', ');
    lines.push(`> Some context was left out to fit model limits: ${list}`, '');
  }
  if (opts.noCheckout) {
    lines.push(
      '> Callers of changed code were not searched: add an `actions/checkout` step before EzPR to enable it.',
      '',
    );
  }
  if (failures.length) {
    lines.push(`> ${renderFailures(failures, opts.used)}`, '');
  }
  lines.push(...renderConfigProblems(opts.configProblems));
  lines.push(`<sub>Reviewed by EzPR using \`${brainId}\`</sub>`);
  return lines.join('\n');
}

/** A Brain that also wrote a part failed only on some parts; the rest were skipped entirely. */
export function renderFailures(failures: ChainFailure[], used: string[] = []): string {
  const text = (f: ChainFailure) => `\`${f.brain}\` ${describeFailure(f.kind)}`;
  const partial = failures.filter((f) => used.includes(f.brain));
  const skipped = failures.filter((f) => !used.includes(f.brain));
  const out: string[] = [];
  if (skipped.length) out.push(`Fell back past: ${skipped.map(text).join('; ')}.`);
  if (partial.length) out.push(`Failed on some parts: ${partial.map(text).join('; ')}.`);
  return out.join(' ');
}

/** The Summary for a PR where every changed file was skipped before reaching a model. */
export function renderNothingToReview(
  prep: Omit<Prepared, 'candidates'>,
  total: number,
  configProblems: string[] = [],
): string {
  const lines = [
    '## EzPR review',
    '',
    `Nothing was sent to a model: all ${total} changed file(s) were skipped.`,
    '',
  ];
  if (prep.missingPatch.length) {
    lines.push(
      `- No diff available from GitHub (the change is too large; try splitting the PR): ${paths(prep.missingPatch)}`,
    );
  }
  if (prep.skippedIgnored.length) {
    lines.push(`- Matched the \`ignore\` list: ${paths(prep.skippedIgnored)}`);
  }
  if (prep.skippedSecrets.length) {
    lines.push(`- Secret-like files: ${paths(prep.skippedSecrets)}`);
  }
  if (prep.skippedNoise.length) {
    lines.push(`- Generated, binary or lock files: ${paths(prep.skippedNoise)}`);
  }
  lines.push('', ...renderConfigProblems(configProblems));
  return lines.join('\n').trimEnd();
}

/** The Summary for a PR whose files all had diffs too big for one model call. */
export function renderTooLarge(
  size: { files: number; tokens: number; budget: number },
  configProblems: string[] = [],
): string {
  return [
    '## EzPR review',
    '',
    `This PR is too large to review: ${size.files} changed file(s), about ${size.tokens.toLocaleString('en-US')} tokens of diff, and no model call can take more than about ${size.budget.toLocaleString('en-US')}. Nothing was sent to a model.`,
    '',
    SIZE_TIPS,
    '',
    ...renderConfigProblems(configProblems),
  ]
    .join('\n')
    .trimEnd();
}

export function renderSetupComment(): string {
  return [
    SUMMARY_MARKER,
    '## EzPR needs an API key',
    '',
    'No model credentials were found, so no review was run.',
    '',
    '1. Create a free key at https://aistudio.google.com/apikey',
    '2. Add it as a repository secret named `GEMINI_API_KEY` (Settings → Secrets and variables → Actions). OpenRouter, Groq, Anthropic and OpenAI keys work too: `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.',
    '3. Pass it to the action:',
    '',
    '```yaml',
    '- uses: oBecks/ezpr@main',
    '  env:',
    '    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}',
    '```',
  ].join('\n');
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
