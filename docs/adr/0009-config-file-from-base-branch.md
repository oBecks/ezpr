# `.ezpr.yml` is read from the base branch

The Config file can change Strictness, the Ignore list and Brain order, so a PR that could edit it could hide its own problems (`ignore: ["**"]`, `strictness: chill`). Like `REVIEW.md` (ADR-0006), it is read from the pull request's base branch. The cost: a PR that edits `.ezpr.yml` is reviewed under the old config until it merges. Rejected: reading it from the PR head for instant feedback.
