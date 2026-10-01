import type { Octokit, PrInfo } from '../github/pr';

export type Repo = { owner: string; repo: string };

/** Everything needed to talk to GitHub about one pull request. */
export interface Gh {
  octokit: Octokit;
  repo: Repo;
  pr: PrInfo;
}

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
