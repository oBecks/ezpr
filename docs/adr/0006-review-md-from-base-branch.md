# Project rules are read from the base branch

`REVIEW.md` is read from the pull request's base branch and given to the Brain as trusted guidance in the system prompt. If it came from the PR head, a PR could rewrite its own reviewer's rules and steer the Review. The cost is that a PR which edits `REVIEW.md` is reviewed under the old rules until it merges. Rejected: reading the head version as untrusted data too (extra tokens for little value).
