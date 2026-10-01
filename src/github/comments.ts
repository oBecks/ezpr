import { INLINE_MARKER, SUMMARY_MARKER_PREFIX } from '../config';
import type { Finding } from '../prompt/schema';
import { lineKey } from '../review/place';
import type { Octokit } from './pr';

type Repo = { owner: string; repo: string };

export function findStickyComment<T extends { id: number; body?: string | null }>(
  comments: T[],
): T | undefined {
  return comments.find((c) => c.body?.includes(SUMMARY_MARKER_PREFIX));
}

export async function getSticky(octokit: Octokit, repo: Repo, issueNumber: number) {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    ...repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  return findStickyComment(comments);
}

export async function writeSticky(
  octokit: Octokit,
  repo: Repo,
  issueNumber: number,
  existing: { id: number } | undefined,
  body: string,
): Promise<void> {
  if (existing) {
    await octokit.rest.issues.updateComment({ ...repo, comment_id: existing.id, body });
  } else {
    await octokit.rest.issues.createComment({ ...repo, issue_number: issueNumber, body });
  }
}

export async function upsertSummary(
  octokit: Octokit,
  repo: Repo,
  issueNumber: number,
  body: string,
): Promise<void> {
  await writeSticky(octokit, repo, issueNumber, await getSticky(octokit, repo, issueNumber), body);
}

/** Keys (`path:line`) of lines that already carry a live EzPR inline comment. */
export function commentedKeys(
  comments: { body?: string | null; path: string; line?: number | null }[],
): Set<string> {
  const keys = new Set<string>();
  for (const c of comments) {
    // line is null once the comment is outdated; those lines may be commented on again.
    if (c.body?.includes(INLINE_MARKER) && c.line) keys.add(lineKey(c.path, c.line));
  }
  return keys;
}

export async function listCommentedLines(
  octokit: Octokit,
  repo: Repo,
  pullNumber: number,
): Promise<Set<string>> {
  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    ...repo,
    pull_number: pullNumber,
    per_page: 100,
  });
  return commentedKeys(comments);
}

const ICON = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' } as const;

export function inlineBody(f: Finding): string {
  return `${ICON[f.severity]} **${f.severity}** — ${f.message}\n\n${INLINE_MARKER}`;
}

/**
 * Post Findings as inline comments in one COMMENT review (ADR-0003). If GitHub rejects the
 * batch, retry one by one so a single bad line cannot lose the rest. Returns the Findings
 * that were actually posted.
 */
export async function postInline(
  octokit: Octokit,
  repo: Repo,
  pullNumber: number,
  headSha: string,
  findings: Finding[],
  warn: (msg: string) => void = () => {},
): Promise<Finding[]> {
  if (findings.length === 0) return [];
  const target = (f: Finding) => ({ path: f.file, line: f.line, side: 'RIGHT' as const });
  try {
    await octokit.rest.pulls.createReview({
      ...repo,
      pull_number: pullNumber,
      commit_id: headSha,
      event: 'COMMENT',
      comments: findings.map((f) => ({ ...target(f), body: inlineBody(f) })),
    });
    return findings;
  } catch (err) {
    warn(`Batched review failed (${errorMessage(err)}); posting comments one by one.`);
  }
  const posted: Finding[] = [];
  for (const f of findings) {
    try {
      await octokit.rest.pulls.createReviewComment({
        ...repo,
        pull_number: pullNumber,
        commit_id: headSha,
        ...target(f),
        body: inlineBody(f),
      });
      posted.push(f);
    } catch (err) {
      warn(`Could not comment on ${f.file}:${f.line}: ${errorMessage(err)}`);
    }
  }
  return posted;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const INLINE_BODY = /^\S+ \*\*(?:critical|high|medium|low)\*\* — ([\s\S]*)$/;

/** The Finding message inside an EzPR inline comment; null when the comment is not one. */
export function parseInlineBody(body: string): string | null {
  if (!body.includes(INLINE_MARKER)) return null;
  const text = body.replace(INLINE_MARKER, '').trim();
  return INLINE_BODY.exec(text)?.[1]?.trim() ?? null;
}
