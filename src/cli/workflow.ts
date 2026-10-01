import { PROVIDER_ORDER } from '../config';

/** Where `init` writes the workflow, relative to the repo root. */
export const WORKFLOW_PATH = '.github/workflows/ai-review.yml';

/** The release line the generated workflow pins; moves with each v1.x release. */
export const DEFAULT_REF = 'v1';

/**
 * The workflow `init` writes, and the one the README shows. All provider secrets are listed:
 * a secret that does not exist is an empty string, which EzPR treats as "no key", so adding a
 * provider later is just a new repository secret.
 */
export function renderWorkflow(ref: string = DEFAULT_REF): string {
  const secrets = PROVIDER_ORDER.map(
    (p) => `          ${p.envKey}: \${{ secrets.${p.envKey} }}`,
  ).join('\n');
  return `name: AI Review
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: \${{ github.event_name == 'pull_request' && format('ezpr-{0}', github.event.pull_request.number) || format('ezpr-cmd-{0}', github.event.comment.id) }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}
jobs:
  review:
    if: >-
      (github.event_name == 'pull_request' && github.event.pull_request.draft == false) ||
      (github.event_name == 'issue_comment' && github.event.issue.pull_request && contains(github.event.comment.body, '@ezpr') && contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@ezpr') && contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association))
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        if: github.event_name == 'pull_request'
      - uses: oBecks/ezpr@${ref}
        env:
${secrets}
`;
}
