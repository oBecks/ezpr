import * as core from '@actions/core';
import type { Octokit } from '../github/pr';
import { reviewPullRequest } from '../review/run';
import { errorText, type Repo } from '../review/types';
import type { CommandEvent } from './event';
import { explainFinding, explainPullRequest } from './explain';
import { mayRunCommands } from './gate';
import { ignoreFinding } from './ignore';
import { parseCommand, type CommandName } from './parse';
import { acknowledge, reply } from './reply';

/** Command names sit inside backticks mid-line, so this reply can never parse as a Command. */
export const USAGE = [
  'I understand these commands (maintainers only):',
  '',
  '- `@ezpr review` reviews the whole pull request again.',
  '- `@ezpr explain` explains the pull request, or one finding when you reply in its thread.',
  "- `@ezpr ignore` in a finding's thread dismisses that finding.",
].join('\n');

/**
 * Runs the Command in a comment, if there is one and its author may run it. Everyone else is
 * ignored without a reply (ADR-0010).
 */
export async function handleCommand(octokit: Octokit, repo: Repo, ev: CommandEvent): Promise<void> {
  const parsed = parseCommand(ev.body);
  if (!parsed) return;
  if (!mayRunCommands(ev)) {
    core.info('Command ignored: the commenter is not a maintainer.');
    return;
  }
  if (parsed.kind === 'unknown') return reply(octokit, repo, ev, USAGE);

  await acknowledge(octokit, repo, ev).catch((err) =>
    core.warning(`Reaction failed: ${errorText(err)}`),
  );
  return runCommand(octokit, repo, ev, parsed.name);
}

function runCommand(
  octokit: Octokit,
  repo: Repo,
  ev: CommandEvent,
  name: CommandName,
): Promise<void> {
  switch (name) {
    case 'review':
      return reviewPullRequest(octokit, repo, ev.prNumber, { fromCommand: true, force: true });
    case 'explain':
      return ev.where === 'thread'
        ? explainFinding(octokit, repo, ev)
        : explainPullRequest(octokit, repo, ev);
    case 'ignore':
      return ignoreFinding(octokit, repo, ev);
  }
}
