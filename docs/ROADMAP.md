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

- `@ezpr review`, `@ezpr explain`, `@ezpr ignore` (separate `issue_comment` trigger).
- `npx <name> init`: writes the workflow, opens the key signup page, runs `gh secret set`.
- README polish (incl. free-tier data-use warning), Marketplace release.

## Open questions

- Phase 6: npm package name for the CLI; command trigger design.
- Confirm Gemini free-tier limits and the default model name with a real call (docs list only AI Studio dashboard limits).
