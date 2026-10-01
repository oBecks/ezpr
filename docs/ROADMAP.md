# Roadmap

Phases are a plan and may change. Lasting decisions live in `docs/adr/`.

## Phase 1: MVP (done)

- Scaffold: TypeScript strict, esbuild bundle to `dist/`, vitest, eslint/prettier, CI (incl. dist up-to-date check), MIT.
- Read PR diff and full changed files (head SHA) via Octokit; detect fork PRs.
- Filter noise (lock files, binaries, generated, secret-like files); redact obvious secrets.
- Per-model token budget with priority trimming (diff, changed files); note what was omitted.
- No-key runs post a Setup comment (see ADR-0005).
- Dogfood: `.github/workflows/self-review.yml` runs the Action on this repo's own PRs (`uses: ./`), needs `GEMINI_API_KEY` repo secret.
- Single Brain: Gemini via the AI SDK Google provider (model name in config), zod-validated JSON output (`summary` + `findings[]`), behind the chain interface.
- Sticky Summary (hidden marker) with model footer; fork PRs go to the job summary.
- Tests: filtering, budgeting, redaction, sticky-comment upsert. End to end in this repo's own PRs and private `ezpr-sandbox`.

## Phase 2: Fallback chain (done)

- Brains for Gemini, OpenRouter, Groq, Anthropic, OpenAI, custom endpoint (`EZPR_BASE_URL`/`EZPR_MODEL`/`EZPR_API_KEY`); enabled only when credentials exist.
- Default order: Gemini, OpenRouter, Groq, Anthropic, OpenAI, custom.
- Error classification per ADR-0002; footer shows final model plus skipped Brains.
- Model names live in config. Tests for chain and error classification.

## Phase 3: Inline comments (done)

- Line-accurate placement against the diff; map Findings to review comments.
- Skip lines already commented on in earlier runs; severity threshold decides inline vs summary-only.
- Incremental review: the sticky marker records the last reviewed commit SHA; a new push reviews only changes since then.
- Keep review history: the sticky Summary shows the latest review on top, earlier reviews go into a collapsed `<details>` section labelled with commit SHA and time instead of being overwritten.

## Phase 4: Better context (done)

- Optional repo checkout (ADR-0007): the working tree powers import following and caller search; without it, API-only imports and a Summary note.
- Follow imports: regex per language (TS/JS, Python, C/C++ `#include`), one hop, repo-local files, whole file; grep fallback for other languages.
- Callers: changed symbol names from the diff, grepped in the checkout; +-5 lines per hit, at most 5 per symbol and about 20 snippets per Review; skip short or common names. Only symbols in the files being reviewed (so incremental runs search only new changes).
- Project rules: `REVIEW.md` from the base branch in the system prompt, capped at about 4k tokens (ADR-0006).
- `ignore` action input (newline-separated globs); Phase 5 merges it with `.ezpr.yml`.
- Budget order: rules, diffs, file contents, callers, imports; lowest tier dropped first and named in the omitted note. Imports and callers go in labelled background-only blocks.
- Chunk large PRs: only when diffs alone exceed a Brain's budget; at most 3 calls, each walking the chain; merge and dedupe Findings, place against the full-PR diff; footer lists every Brain used.
- Tests: pure functions plus temp-dir fixtures, no network.

## Phase 5: Config and errors (done)

- `.ezpr.yml` from the base branch (ADR-0009): `brains` (reorder/subset providers that have keys), `strictness` (chill/balanced/strict: prompt tone plus inline threshold high/medium/low), `ignore`. No `language` (output stays English) and no custom rules (`REVIEW.md` covers them).
- Action inputs `ignore`, `strictness`, `brains` merge with the file: ignore lists are unioned, the input wins for the rest.
- Invalid keys are skipped one by one and named in the Summary; the rest of the file still applies. Parsed with `yaml` and zod.
- Helpful comments: no keys (Setup comment), all Brains failed (each failure with a fix), PR too large (counts and tips; a partial review gets the tips line). A PR that already has a Review keeps it when a later run fails or finds nothing.

## Phase 6: Commands, CLI, release

- Commands in the same workflow file: `pull_request`, `issue_comment` and `pull_request_review_comment`; the Action branches on the event. One shared gate (owner/member/collaborator only, others silently ignored) and one parser (line-start, first command only, quotes and code fences ignored). Works on fork PRs (ADR-0010). One concurrency group per comment (`ezpr-cmd-<comment id>`), so quick commands are never dropped; a Review merges in dismissals made while it ran. 👀 reaction on accept; usage reply on an unknown command (maintainers only).
- `@ezpr review`: Forced Review of the whole PR (ignores the Reviewed SHA; Already commented lines still skipped).
- `@ezpr explain`: Walkthrough on the PR conversation; in an inline thread, explains that Finding. No free-form questions in v1.
- `@ezpr ignore` (inline-thread reply): Dismissed finding keyed by file path plus message hash, stored in the Summary marker (max 50, oldest dropped). Replies "Dismissed", leaves the thread open. Path globs stay in `.ezpr.yml`.
- CLI `@obecks/ezpr` (`ezpr` is taken on npm), `init` only: provider menu (Gemini default, OpenRouter, Groq, Anthropic, OpenAI; custom endpoint = "see README"), one provider per run, Y/n data-use warning for free-tier providers, hidden key prompt piped to `gh secret set` on stdin, writes the workflow (all five secrets in `env:`), shows a diff and refuses to overwrite without `--force`, manual-steps fallback without `gh`.
- README polish (data-use callout in Setup), tag `v1.0.0` plus floating `v1`, README and `init` pin `@v1`, manual Marketplace release.
- To verify while building: each provider's free-tier data-use claims; workflow permissions needed for reactions and replies.

## Open questions

- Confirm Gemini free-tier limits and the default model name with a real call (docs list only AI Studio dashboard limits).
