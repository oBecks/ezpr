import * as core from '@actions/core';
import type { RawFile } from '../context/collect';
import { listChangesSince } from '../github/pr';
import type { Gh } from './types';

export interface Selection {
  files: RawFile[];
  since?: string;
}

/** Files changed since the last reviewed commit, or the whole PR when that cannot be computed. */
async function incremental(gh: Gh, all: RawFile[], sha: string): Promise<Selection> {
  const changes = await listChangesSince(gh.octokit, gh.repo, sha, gh.pr.headSha);
  if (!changes) {
    core.info('Could not diff against the last reviewed commit; reviewing the whole PR.');
    return { files: all };
  }
  core.info(`Incremental review since ${sha}.`);
  return { files: changes, since: sha };
}

/**
 * The sticky Summary records the last reviewed commit; a new push reviews only what changed
 * since. Null when the head commit was already reviewed.
 */
export async function selectFiles(
  gh: Gh,
  all: RawFile[],
  previousSha: string | undefined,
): Promise<Selection | null> {
  if (!previousSha) return { files: all };
  if (previousSha !== gh.pr.headSha) return incremental(gh, all, previousSha);
  core.info(`Commit ${previousSha} was already reviewed; nothing new to review.`);
  return null;
}
