# EzPR

A free, open-source AI pull request reviewer that runs as a GitHub Action.

## Language

**Review**:
One run of EzPR on a pull request, producing one Summary and zero or more Findings.

**Finding**:
A single issue the reviewer raises about a specific line of a changed file, with a severity and a message.

**Summary**:
The one overall comment per pull request. Updated in place on later Reviews rather than re-posted (the "sticky" Summary).

**Brain**:
A provider plus model pair that can write a Review (e.g. Gemini with a given model).

**Fallback chain**:
The ordered list of Brains tried in turn until one succeeds. Built from whichever providers have credentials.

**Setup comment**:
The comment EzPR posts when no Brain has credentials, explaining how to add a free key.

**Context**:
Everything sent to a Brain besides instructions: the diff, full changed files, Imported files, Caller snippets, and Project rules. Trimmed to a Brain's budget in that priority order, lowest first.

**Project rules**:
The repo's own `REVIEW.md`, read from the base branch (so a pull request cannot rewrite its own reviewer's rules) and always included when present. Guidance from the repo owner, not pull request data.

**Fork PR**:
A pull request from a fork, where EzPR cannot post comments and writes the Review to the job summary instead.

**Inline comment**:
A Finding posted as a review comment on its line of the pull request diff. Only Findings at or above the Severity threshold whose line is part of the diff become inline comments; every Finding still appears in the Summary.

**Severity threshold**:
The least severe level that becomes an Inline comment. Findings below it stay Summary-only. Default: `medium`.

**Already commented**:
A line (file path and line number) that carries a live Inline comment from an earlier Review. A new Finding on such a line is not posted inline again, whatever its message.

**Reviewed SHA**:
The head commit a Review covered, recorded in the Summary's marker. The next Review covers only the changes since it (an **Incremental review**), or the whole pull request if that range cannot be computed.

**Review history**:
The Summary shows the latest Review on top; earlier Reviews are kept in a collapsed section, each labelled with its Reviewed SHA and time.

**Imported file**:
A repo-local file that a changed file imports (one hop only), sent whole as background. Not itself under review.

**Caller snippet**:
A few lines around a place outside the changed files that uses a symbol the pull request changed. Not itself under review.

**Ignore list**:
Path globs, set by the Action's `ignore` input, that are never sent to a Brain.

**Chunk**:
A group of changed files reviewed in one Brain call when the diffs alone do not fit one Brain's budget. A Review has at most three; each walks the Fallback chain on its own, and their Findings are merged. A Chunk tries Brains that fit it whole first (ADR-0008). Files of a Chunk no Brain could review are reported as not reviewed, and the Summary states how many changed files were reviewed.
