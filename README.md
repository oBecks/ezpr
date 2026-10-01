# EzPR

**A free, open-source AI code reviewer for your GitHub pull requests.** Open a pull request and
EzPR reads the change, then comments on the exact lines that look wrong: bugs, unsafe code,
callers that will break. It runs inside GitHub Actions with a model API key you own, and it
falls back to another model when one is rate-limited, so a free key goes a long way.

> 🟠 **high** `src/stats.ts:3` — The loop condition `i <= values.length` reads one element past
> the end of the array, so the last iteration adds `undefined` and the average becomes `NaN`.
> Change `<=` to `<`.

That is the kind of comment EzPR leaves on a line of a pull request.

## Quick start (about 2 minutes)

You need a GitHub repository and [Node.js](https://nodejs.org/). The [GitHub CLI](https://cli.github.com/)
(`gh`, signed in with `gh auth login`) lets EzPR save your API key for you.

**1. In your repository folder, run:**

```bash
npx @obeck/ezpr init
```

It asks which model provider you want (Gemini is the free default), opens the page where you
create an API key, and saves the key as a repository secret. Your key is typed hidden and is
never printed or stored in a file. It also writes `.github/workflows/ai-review.yml`.

**2. Commit and push that file.**

**3. Open a pull request.** EzPR comments within a minute or two.

> **Before you start: free tiers and your code.** Free API tiers can treat data differently from
> paid ones, and some providers may use submitted prompts to improve their models. EzPR sends
> the diff and changed files of each pull request to the provider you choose (details in
> [Privacy](#privacy)). For a private repository, read the provider's terms first, or use a
> paid key.

<details>
<summary><b>Prefer to set it up by hand?</b></summary>

1. Create a free Gemini key at https://aistudio.google.com/apikey
2. In your repository: **Settings → Secrets and variables → Actions → New repository secret**.
   Name it `GEMINI_API_KEY` and paste the key.
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

A secret you have not created is empty, which EzPR treats as "no key". Adding another provider
later is only a new repository secret, with no change to this file.

</details>

## What you get on every pull request

- **Inline comments** on the lines that matter, each with a severity (🔴 critical, 🟠 high,
  🟡 medium, 🔵 low) and a suggested fix.
- **One Summary comment** with the overall picture. It updates in place on later pushes, and
  keeps earlier reviews in a collapsed section.
- **Incremental reviews.** A new push reviews only what changed since the last review.
- **Context, not just the diff.** EzPR also reads the files your change imports and finds code
  that calls the things you changed.
- **Fallback between models.** If one provider is rate-limited or down, the next one takes over,
  and the footer says which model wrote the review.
- **It never blocks merging.** EzPR only comments. It doesn't request changes or approve
  ([ADR-0003](docs/adr/0003-comment-only-never-blocks.md)).

## Talk to it: commands

Comment on a pull request to steer EzPR. A command goes at the start of a line.

| Command         | Where to type it          | What it does                                                                                    |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `@ezpr review`  | PR conversation           | Reviews the whole pull request again, even if the latest commit was already reviewed.           |
| `@ezpr explain` | PR conversation           | Posts a walkthrough: what the change does and where a reviewer should look first.               |
| `@ezpr explain` | Reply in an inline thread | Explains that finding: why it was raised and how to fix it.                                     |
| `@ezpr ignore`  | Reply in an inline thread | Dismisses that finding. It is not raised again on this PR while that line of code is unchanged. |

EzPR reacts with 👀 when it picks a command up. Only the repository's owners, members and
collaborators can run commands, so strangers can't spend your API quota. Dismissals are
remembered in the Summary comment, so nothing in your repository changes.

<details>
<summary>Commands on pull requests from forks</summary>

A plain pull request from a fork gets a read-only token, so EzPR can only write its review to
the workflow's job summary
([ADR-0004](docs/adr/0004-fork-prs-job-summary-only.md)). A maintainer can comment
`@ezpr review` to get a full review with inline comments. That run has a write token, and EzPR
only ever reads the fork's code as text, never runs it
([ADR-0010](docs/adr/0010-commands-may-review-fork-prs.md)). Replies inside an inline thread
arrive as a different event that GitHub runs read-only on forks, so `explain` and `ignore` in a
thread do nothing there.

</details>

## Make it yours

All of this is optional. EzPR works without any of it.

**Tell it about your project: `REVIEW.md`.** Put a `REVIEW.md` in your repo root with what
matters to you ("we never use `any`", "all queries must be parameterised"). EzPR reads it on
every review. It is read from the base branch, so a pull request can't rewrite its own rules
([ADR-0006](docs/adr/0006-review-md-from-base-branch.md)).

**Tune it: `.ezpr.yml`.** Also read from the base branch
([ADR-0009](docs/adr/0009-config-file-from-base-branch.md)):

```yaml
brains: [groq, gemini] # providers to use, in this order; default: every provider with a key
strictness: balanced # chill | balanced | strict
ignore:
  - docs/**
  - '*.generated.ts'
```

- `strictness`: how picky the review is, and which findings become inline comments. `chill`
  comments on `high` and above, `balanced` (the default) on `medium` and above, `strict` on
  everything.
- `ignore`: files that are never sent to a model.
- `brains`: which providers to use and in what order. A listed provider without a key is skipped.
- A bad entry is skipped and named in the Summary. The rest of the file still applies.
- The action inputs `ignore`, `strictness` and `brains` set the same things in the workflow file.
  Ignore lists are combined. For the others, the input wins.

```yaml
- uses: oBecks/ezpr@v1
  with:
    ignore: |
      docs/**
      *.generated.ts
```

## Model providers

Every provider is optional and used only when its key exists. EzPR tries them in this order and
moves to the next on rate limits, server errors, timeouts or invalid output:

| Provider                 | Secret                                                 | Default model           |
| ------------------------ | ------------------------------------------------------ | ----------------------- |
| Gemini                   | `GEMINI_API_KEY`                                       | `gemini-3.5-flash-lite` |
| OpenRouter               | `OPENROUTER_API_KEY`                                   | `openrouter/free`       |
| Groq                     | `GROQ_API_KEY`                                         | `openai/gpt-oss-120b`   |
| Mistral                  | `MISTRAL_API_KEY`                                      | `mistral-small-latest`  |
| Anthropic                | `ANTHROPIC_API_KEY`                                    | `claude-sonnet-5-5`     |
| OpenAI                   | `OPENAI_API_KEY`                                       | `gpt-6.1-sol`           |
| Custom OpenAI-compatible | `EZPR_BASE_URL`, `EZPR_MODEL`, optional `EZPR_API_KEY` | yours                   |

Pass each key you have through `env:` in the workflow, like the ones in the workflow file
above. For the custom endpoint, add its variables there too. A key that is rejected (401/403) is
skipped and called out in the review. Override a model with `EZPR_<PROVIDER>_MODEL` (for
example `EZPR_GROQ_MODEL`). The custom endpoint also accepts `EZPR_MAX_INPUT_TOKENS`. Ollama on
`localhost` only works on self-hosted runners.

## Troubleshooting

**EzPR didn't comment on my pull request.**
Open the **Actions** tab and look at the "AI Review" run. Common causes: the pull request is a
draft (drafts are skipped until marked ready), or it comes from a fork (see above). `@ezpr`
commands only work once the workflow file is on your default branch, and only for maintainers.

**It posted "EzPR needs an API key".**
No secret was found. Check that the secret exists under Settings → Secrets and variables →
Actions, that it is named exactly like the table above (for example `GEMINI_API_KEY`), and
that the workflow passes it through `env:`.

**It says every model failed.**
The comment lists each provider and what to do about it, such as a rejected key or a rate limit.
Free tiers have daily limits, so adding a second provider's key makes EzPR much more reliable.

**It says the pull request is too large.**
EzPR reviews at most three parts of a very large diff. Split the pull request, or add generated
and vendored paths to `ignore`.

**It didn't search for callers of changed code.**
That needs the `actions/checkout` step from the workflow file, and it only runs on pull request
events, not on commands ([ADR-0007](docs/adr/0007-checkout-optional.md)). EzPR still reviews
without it and says so.

## Privacy

EzPR sends the pull request's diff, the changed files and the files they import to the model
provider you configured, using your own API key. Nothing goes to any other server.

Free API tiers can use submitted code to improve the provider's models, and terms differ per
provider and change over time. Mistral's free tier, for one, requires you to opt in to training
on your data. Read the terms of the provider you use before sending a private repository's code
to it. EzPR skips secret-like files (`.env`, keys) and redacts common secret formats before
sending anything.

## Contributing

```bash
npm ci
npm test
npm run build   # rebuilds dist/ (the Action, which must be committed) and cli/ (the npm CLI)
```

Design decisions are recorded in [docs/adr](docs/adr), and the plan is in
[docs/ROADMAP.md](docs/ROADMAP.md). Licensed under the [MIT License](LICENSE).
