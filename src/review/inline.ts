import * as core from '@actions/core';
import type { RawFile } from '../context/collect';
import { listCommentedLines, postInline } from '../github/comments';
import type { Finding } from '../prompt/schema';
import { diffLineMap } from './diffmap';
import { placeFindings } from './place';
import { errorText, type Gh } from './types';

/** Posts the Findings that qualify as inline comments; returns the ones that were posted. */
export async function postInlineFindings(
  gh: Gh,
  allFiles: RawFile[],
  findings: Finding[],
): Promise<Set<Finding>> {
  const { octokit, repo, pr } = gh;
  try {
    // Inline comments must land on lines of the full PR diff, not just the incremental one.
    const placed = placeFindings(
      findings,
      diffLineMap(allFiles),
      await listCommentedLines(octokit, repo, pr.number),
    );
    const wanted = placed.filter((p) => p.placement === 'inline').map((p) => p.finding);
    return new Set(await postInline(octokit, repo, pr.number, pr.headSha, wanted, core.warning));
  } catch (err) {
    core.warning(`Inline comments failed: ${errorText(err)}`);
    return new Set();
  }
}
