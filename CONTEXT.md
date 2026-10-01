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
Everything sent to a Brain besides instructions: the diff, full changed files, and (later) imported files, callers, and project rules.

**Project rules**:
The repo's own `REVIEW.md`, always included in Context when present.

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
