# EzPR

A free, open-source AI pull request reviewer that runs as a GitHub Action.

> Status: Phase 2. One summary comment per PR, with automatic fallback between model providers. See [docs/ROADMAP.md](docs/ROADMAP.md).

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
      - uses: oBecks/ezpr@main
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

Without a key, EzPR posts a comment explaining how to add one.

## Providers and fallback

Every provider is optional and enabled only when its key exists. EzPR tries them in this
order and moves to the next on rate limits (429), server errors, timeouts or invalid output:

| Provider                 | Secret                                                 | Default model         |
| ------------------------ | ------------------------------------------------------ | --------------------- |
| Gemini                   | `GEMINI_API_KEY`                                       | `gemini-3.5-flash`    |
| OpenRouter               | `OPENROUTER_API_KEY`                                   | `openrouter/free`     |
| Groq                     | `GROQ_API_KEY`                                         | `openai/gpt-oss-120b` |
| Anthropic                | `ANTHROPIC_API_KEY`                                    | `claude-sonnet-5-5`   |
| OpenAI                   | `OPENAI_API_KEY`                                       | `gpt-6.1-sol`         |
| Custom OpenAI-compatible | `EZPR_BASE_URL`, `EZPR_MODEL`, optional `EZPR_API_KEY` | yours                 |

Pass each key you have through `env:` in the workflow, like `GEMINI_API_KEY` above. A key
that is rejected (401/403) is skipped and called out in the review. The review footer shows
which model wrote it, and which ones were skipped. Override a model with
`EZPR_<PROVIDER>_MODEL` (for example `EZPR_GROQ_MODEL`). The custom endpoint also accepts
`EZPR_MAX_INPUT_TOKENS`. Ollama on `localhost` only works on self-hosted runners.

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
