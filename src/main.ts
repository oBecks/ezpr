import * as core from '@actions/core';
import * as github from '@actions/github';
import { reviewPullRequest } from './review/run';
import { errorText } from './review/types';

async function run(): Promise<void> {
  const pull = github.context.payload.pull_request;
  if (!pull) {
    core.info('Not a pull_request event; nothing to review.');
    return;
  }
  const octokit = github.getOctokit(core.getInput('github-token', { required: true }));
  await reviewPullRequest(octokit, github.context.repo, pull.number);
}

run().catch((err) => core.setFailed(errorText(err)));
