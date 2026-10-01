import { SUMMARY_MARKER } from '../config';
import type { Context } from '../context/collect';
import { shortSha } from '../github/sticky';
import type { Finding, Review } from '../prompt/schema';
import type { ChainFailure } from '../providers/chain';
import { describeFailure } from '../providers/errors';

const ICON = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' } as const;

export function renderReview(
  review: Review,
  brainId: string,
  ctx: Context,
  failures: ChainFailure[] = [],
  opts: { inline?: ReadonlySet<Finding>; since?: string } = {},
): string {
  const lines = ['## EzPR review', ''];
  if (opts.since) {
    lines.push(`_Incremental review: changes since \`${shortSha(opts.since)}\`._`, '');
  }
  lines.push(review.summary, '');

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

  const omitted = [...ctx.droppedDiffs, ...ctx.droppedContents];
  if (omitted.length) {
    const list = omitted.map((p) => `\`${p}\``).join(', ');
    lines.push(`> Some context was left out to fit model limits: ${list}`, '');
  }
  if (failures.length) {
    lines.push(`> ${renderFailures(failures)}`, '');
  }
  lines.push(`<sub>Reviewed by EzPR using \`${brainId}\`</sub>`);
  return lines.join('\n');
}

export function renderFailures(failures: ChainFailure[]): string {
  const list = failures.map((f) => `\`${f.brain}\` ${describeFailure(f.kind)}`).join('; ');
  return `Fell back past: ${list}.`;
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

export function renderErrorComment(message: string, failures: ChainFailure[] = []): string {
  return [
    SUMMARY_MARKER,
    '## EzPR could not complete the review',
    '',
    failures.length ? renderFailures(failures) : message,
    '',
    'The job log has details. Re-push or re-run the workflow to try again.',
  ].join('\n');
}
