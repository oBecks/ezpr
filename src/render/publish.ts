import * as core from '@actions/core';
import { upsertSummary } from '../github/comments';
import { ChainError } from '../providers/chain';
import type { Gh } from '../review/types';
import { errorText } from '../review/types';
import { renderErrorComment } from './notices';

export type Publish = (body: string) => Promise<void>;

/** Fork PRs get a read-only token, so results go to the job summary (ADR-0004). */
export function makePublisher(gh: Gh): Publish {
  return async (body) => {
    if (!gh.pr.isFork) {
      await upsertSummary(gh.octokit, gh.repo, gh.pr.number, body);
      return;
    }
    await core.summary.addRaw(body).write();
    core.info('Fork PR: wrote review to the job summary instead of commenting.');
  };
}

/** Tells the PR that the Review could not be completed. */
export async function publishFailure(
  publish: Publish,
  err: unknown,
  /** The PR already has a Review; it stays, and the failure only goes to the job log. */
  keepReview = false,
): Promise<void> {
  core.error(errorText(err));
  if (keepReview) return;
  const failures = err instanceof ChainError ? err.failures : [];
  await publish(renderErrorComment(errorText(err), failures));
}
