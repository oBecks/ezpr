# EzPR

A free, open-source AI pull request reviewer that runs as a GitHub Action. It posts one
Summary per pull request and line-accurate inline comments, understands the files around your
change, and falls back between model providers when one is rate-limited.

## Setup

The quickest way, from your repository:

```bash
npx @obecks/ezpr init
```

It writes the workflow below, opens the page where you create an API key, and saves the key as
a repository secret with the [GitHub CLI](https://cli.github.com/) (`gh`). The key is read
without echo and passed to `gh` on stdin. An existing, different workflow is never overwritten
unless you pass `--force`.

> **Free tiers and your code.** Free API tiers can treat data differently from paid ones: some
> providers may use submitted prompts to improve their models. EzPR sends the diff and changed
> files of each pull request to the provider you choose (see [Privacy](#privacy)). For a private
> repository, check the provider's terms, or use a paid key.

Or by hand:

1. Create a free Gemini key at https://aistudio.google.com/apikey
2. Add it as a repository secret named `GEMINI_API_KEY`.
3. Add `.github/workflows/ai-review.yml`:

```yaml
name: AI Review
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
  group: ${{ github.event_name == 'pull_request' && format('ezpr-{0}', github.event.pull_request.number) || format('ezpr-cmd-{0}', github.event.comment.id) }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
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
      - uses: oBecks/ezpr@v1
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
          MISTRAL_API_KEY: ${{ secrets.MISTRAL_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

A secret you have not created is an empty string, which EzPR treats as "no key", so adding
another provider later is only a new repository secret. Without any key, EzPR posts a comment
explaining how to add one.

## Commands

Comment on a pull request to steer EzPR. Commands start at the beginning of a line; quoted
lines and code blocks are ignored. Only the repository's owners, members and collaborators can
run them; anyone else is silently ignored, so strangers cannot spend your API quota.

| Command         | Where                     | What it does                                                                                    |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `@ezpr review`  | PR conversation           | Reviews the whole pull request again, even if the latest commit was already reviewed.           |
| `@ezpr explain` | PR conversation           | Posts a walkthrough: what the change does and where a reviewer should look first.               |
| `@ezpr explain` | Reply in an inline thread | Explains that finding: why it was raised, and how to fix it.                                    |
| `@ezpr ignore`  | Reply in an inline thread | Dismisses that finding. It is not raised again on this PR while that line of code is unchanged. |

EzPR reacts with 👀 when it takes a command up. Dismissals are remembered in the Summary
comment, so nothing in your repository changes.

Commands in the PR conversation work on pull requests from forks too: that run has a write
token, so EzPR can comment on the fork's PR. (Replies inside an inline thread arrive as a
different event, which GitHub runs read-only and without secrets for forks, so `explain` and
`ignore` in a thread do nothing there.) It only ever reads the PR's code as text, never runs it
([ADR-0010](docs/adr/0010-commands-may-review-fork-prs.md)). Command runs are not
checked out, so they skip the caller search described below.

## Providers and fallback

Every provider is optional and enabled only when its key exists. EzPR tries them in this
order and moves to the next on rate limits (429), server errors, timeouts or invalid output:

| Provider                 | Secret                                                 | Default model           |
| ------------------------ | ------------------------------------------------------ | ----------------------- |
| Gemini                   | `GEMINI_API_KEY`                                       | `gemini-3.5-flash-lite` |
| OpenRouter               | `OPENROUTER_API_KEY`                                   | `openrouter/free`       |
| Groq                     | `GROQ_API_KEY`                                         | `openai/gpt-oss-120b`   |
| Mistral                  | `MISTRAL_API_KEY`                                      | `mistral-small-latest`  |
| Anthropic                | `ANTHROPIC_API_KEY`                                    | `claude-sonnet-5-5`     |
| OpenAI                   | `OPENAI_API_KEY`                                       | `gpt-6.1-sol`           |
| Custom OpenAI-compatible | `EZPR_BASE_URL`, `EZPR_MODEL`, optional `EZPR_API_KEY` | yours                   |

Pass each key you have through `env:` in the workflow, like the ones above. For the custom
endpoint, add its variables there as well. A key that is rejected (401/403) is skipped and
called out in the review. The review footer shows which model wrote it, and which ones were
skipped. Override a model with `EZPR_<PROVIDER>_MODEL` (for example `EZPR_GROQ_MODEL`). The
custom endpoint also accepts `EZPR_MAX_INPUT_TOKENS`. Ollama on `localhost` only works on
self-hosted runners.

## Repo context

On pull request runs, the `actions/checkout` step in the workflow lets EzPR also send the
files your changes import and short snippets of code that calls the symbols you changed.
Without a checkout it still reviews, but skips the caller search and says so
([ADR-0007](docs/adr/0007-checkout-optional.md)).

- `REVIEW.md` in the repo root is always included as guidance for the reviewer. It is read
  from the base branch, so a PR cannot rewrite its own rules
  ([ADR-0006](docs/adr/0006-review-md-from-base-branch.md)).
- `ignore:` takes newline-separated path globs that are never sent to a model:

```yaml
- uses: oBecks/ezpr@v1
  with:
    ignore: |
      docs/**
      *.generated.ts
```

- A PR too large for one model call is reviewed in up to three parts.

## Configuration

Put a `.ezpr.yml` in the repo root. It is read from the base branch, so a PR cannot change
its own reviewer's settings ([ADR-0009](docs/adr/0009-config-file-from-base-branch.md)).

```yaml
brains: [groq, gemini] # providers to use, in this order; default: every provider with a key
strictness: balanced # chill | balanced | strict
ignore:
  - docs/**
  - '*.generated.ts'
```

- `brains` takes `gemini`, `openrouter`, `groq`, `mistral`, `anthropic`, `openai` and `custom`. A listed
  provider without an API key is skipped.
- `strictness` changes how picky the review is and which Findings become inline comments:
  `chill` only `high` and above, `balanced` (default) `medium` and above, `strict` all.
- The action inputs `ignore`, `strictness` and `brains` set the same things in the workflow.
  Ignore lists are combined; for the others the input wins.
- A bad key is skipped and named in the Summary; the rest of the file still applies.

## Privacy

Free API tiers can use submitted code to improve the provider's models, and terms differ per
provider and change over time. Mistral's free tier, for one, requires you to opt in to training on your data. Read the terms of the provider you use before sending a private
repository's code to it. EzPR skips secret-like files (`.env`, keys) and redacts common secret
formats before sending anything. The diff, the changed files and the files they import are
sent to the provider.

## Fork PRs

On a plain `pull_request` run from a fork the token is read-only, so EzPR writes the review to
the job summary instead of commenting (see
[ADR-0004](docs/adr/0004-fork-prs-job-summary-only.md)). A maintainer can comment
`@ezpr review` to get a full review with comments, as described under [Commands](#commands).

## Development

```bash
npm ci
npm test
npm run build   # rebuilds dist/ (the Action, which must be committed) and cli/ (the npm CLI)
```
