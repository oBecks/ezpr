import type { Octokit, PrInfo } from '../github/pr';

export type Repo = { owner: string; repo: string };

/** Everything needed to talk to GitHub about one pull request. */
export interface Gh {
  octokit: Octokit;
  repo: Repo;
  pr: PrInfo;
  /**
   * False on a fork PR's `pull_request` run (read-only token, ADR-0004): the Review goes to the
   * job summary. A Command run has a write token, so it can comment on fork PRs (ADR-0010).
   */
  canComment: boolean;
}

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
