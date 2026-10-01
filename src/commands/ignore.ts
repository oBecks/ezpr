import { getSticky, parseInlineBody, writeSticky } from '../github/comments';
import { addDismissed } from '../github/sticky';
import type { Octokit } from '../github/pr';
import { findingKey, hunkLineText } from '../review/dismissed';
import type { Repo } from '../review/types';
import type { CommandEvent } from './event';
import { reply } from './reply';

export const IGNORE_HINT =
  'Reply `@ezpr ignore` inside the thread of one of my inline comments to dismiss that finding.';

/**
 * `@ezpr ignore`: the Finding in this thread is never raised again. Remembered in the Summary
 * marker, so nothing in the repo changes. The thread stays open.
 */
export async function ignoreFinding(octokit: Octokit, repo: Repo, ev: CommandEvent): Promise<void> {
  if (ev.where !== 'thread' || ev.threadRootId === undefined) {
    return reply(octokit, repo, ev, IGNORE_HINT);
  }
  const { data: root } = await octokit.rest.pulls.getReviewComment({
    ...repo,
    comment_id: ev.threadRootId,
  });
  const message = parseInlineBody(root.body);
  if (message === null) return reply(octokit, repo, ev, IGNORE_HINT);

  const sticky = await getSticky(octokit, repo, ev.prNumber);
  if (!sticky?.body) {
    return reply(
      octokit,
      repo,
      ev,
      'I could not find my Summary comment, so nothing was recorded.',
    );
  }
  await writeSticky(
    octokit,
    repo,
    ev.prNumber,
    sticky,
    addDismissed(sticky.body, findingKey(root.path, hunkLineText(root.diff_hunk))),
  );
  await reply(octokit, repo, ev, "Dismissed. I won't raise this finding again on this PR.");
}
