import * as core from '@actions/core';
import * as github from '@actions/github';
import { commandEventFrom } from './commands/event';
import { handleCommand } from './commands/run';
import { reviewPullRequest } from './review/run';
import { errorText } from './review/types';

async function run(): Promise<void> {
  const octokit = github.getOctokit(core.getInput('github-token', { required: true }));
  const { eventName, payload, repo } = github.context;

  if (eventName === 'issue_comment' || eventName === 'pull_request_review_comment') {
    const ev = commandEventFrom(eventName, payload);
    if (!ev) {
      core.info('Not a new comment on a pull request; nothing to do.');
      return;
    }
    return handleCommand(octokit, repo, ev);
  }

  const pull = payload.pull_request;
  if (!pull) {
    core.info('Not a pull_request event; nothing to review.');
    return;
  }
  await reviewPullRequest(octokit, repo, pull.number);
}

run().catch((err) => core.setFailed(errorText(err)));
