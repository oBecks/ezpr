# EzPR

A free, open-source AI pull request reviewer that runs as a GitHub Action.

> Status: Phase 5. Inline comments, incremental review, repo context (imports, callers, `REVIEW.md`), `.ezpr.yml` config, and helpful error comments, with automatic fallback between model providers. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Setup

1. Create a free Gemini key at https://aistudio.google.com/apikey
2. Add it as a repository secret named `GEMINI_API_KEY`.
3. Add `.github/workflows/ai-review.yml`:

```yaml
name: AI Review
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oBecks/ezpr@main
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

Without a key, EzPR posts a comment explaining how to add one.

## Providers and fallback

Every provider is optional and enabled only when its key exists. EzPR tries them in this
order and moves to the next on rate limits (429), server errors, timeouts or invalid output:

| Provider                 | Secret                                                 | Default model           |
| ------------------------ | ------------------------------------------------------ | ----------------------- |
| Gemini                   | `GEMINI_API_KEY`                                       | `gemini-3.5-flash-lite` |
| OpenRouter               | `OPENROUTER_API_KEY`                                   | `openrouter/free`       |
| Groq                     | `GROQ_API_KEY`                                         | `openai/gpt-oss-120b`   |
| Anthropic                | `ANTHROPIC_API_KEY`                                    | `claude-sonnet-5-5`     |
| OpenAI                   | `OPENAI_API_KEY`                                       | `gpt-6.1-sol`           |
| Custom OpenAI-compatible | `EZPR_BASE_URL`, `EZPR_MODEL`, optional `EZPR_API_KEY` | yours                   |

Pass each key you have through `env:` in the workflow, like `GEMINI_API_KEY` above. A key
that is rejected (401/403) is skipped and called out in the review. The review footer shows
which model wrote it, and which ones were skipped. Override a model with
`EZPR_<PROVIDER>_MODEL` (for example `EZPR_GROQ_MODEL`). The custom endpoint also accepts
`EZPR_MAX_INPUT_TOKENS`. Ollama on `localhost` only works on self-hosted runners.

## Repo context

Add an `actions/checkout` step before EzPR (as in the setup above) and it also sends the
files your changes import and short snippets of code that calls the symbols you changed.
Without a checkout it still reviews, but skips the caller search and says so
([ADR-0007](docs/adr/0007-checkout-optional.md)).

- `REVIEW.md` in the repo root is always included as guidance for the reviewer. It is read
  from the base branch, so a PR cannot rewrite its own rules
  ([ADR-0006](docs/adr/0006-review-md-from-base-branch.md)).
- `ignore:` takes newline-separated path globs that are never sent to a model:

```yaml
- uses: oBecks/ezpr@main
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

- `brains` takes `gemini`, `openrouter`, `groq`, `anthropic`, `openai` and `custom`. A listed
  provider without an API key is skipped.
- `strictness` changes how picky the review is and which Findings become inline comments:
  `chill` only `high` and above, `balanced` (default) `medium` and above, `strict` all.
- The action inputs `ignore`, `strictness` and `brains` set the same things in the workflow.
  Ignore lists are combined; for the others the input wins.
- A bad key is skipped and named in the Summary; the rest of the file still applies.

## Privacy

Free API tiers may use submitted code to improve the provider's models. For private
repositories, decide what you are comfortable sending. EzPR skips secret-like files
(`.env`, keys) and redacts common secret formats before sending anything.

## Fork PRs

On pull requests from forks the token is read-only, so EzPR writes the review to the job
summary instead of commenting (see [ADR-0004](docs/adr/0004-fork-prs-job-summary-only.md)).

## Development

```bash
npm ci
npm test
npm run build   # rebuilds dist/, which must be committed
```
