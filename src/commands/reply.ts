import type { Octokit } from '../github/pr';
import type { Repo } from '../review/types';
import type { CommandEvent } from './event';

/** Answers a Command where it was given: in the thread, or as a PR conversation comment. */
export async function reply(
  octokit: Octokit,
  repo: Repo,
  ev: CommandEvent,
  body: string,
): Promise<void> {
  if (ev.where === 'thread' && ev.threadRootId !== undefined) {
    await octokit.rest.pulls.createReplyForReviewComment({
      ...repo,
      pull_number: ev.prNumber,
      comment_id: ev.threadRootId,
      body,
    });
    return;
  }
  await octokit.rest.issues.createComment({ ...repo, issue_number: ev.prNumber, body });
}

/** 👀 on the comment that holds the Command. */
export async function acknowledge(octokit: Octokit, repo: Repo, ev: CommandEvent): Promise<void> {
  if (ev.where === 'thread') {
    await octokit.rest.reactions.createForPullRequestReviewComment({
      ...repo,
      comment_id: ev.commentId,
      content: 'eyes',
    });
    return;
  }
  await octokit.rest.reactions.createForIssueComment({
    ...repo,
    comment_id: ev.commentId,
    content: 'eyes',
  });
}
