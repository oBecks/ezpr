# The repo checkout is optional

Caller search and grep-based import following need the whole repo, so they read the `actions/checkout` working tree when present. Without one, EzPR still reviews: it follows imports through the API, skips caller search, and says so in the Summary. Rejected: requiring a checkout (breaks existing workflows) and GitHub code search (indexes only the default branch, heavily rate-limited, so results would be stale for PR code).
