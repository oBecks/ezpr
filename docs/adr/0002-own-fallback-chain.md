# Own fallback chain with classified errors

The chain moves to the next Brain on 429, 5xx, timeouts, network errors, and output that is still invalid after one repair attempt. A 401/403 (bad key) skips that Brain for the run and is flagged in the Summary instead of silently falling through. We rejected "fall back on any error" because it hides misconfiguration such as a typo'd key. `Retry-After` (or the provider's "retry in Ns" error text) is honored only when it is 30 seconds or less; a longer wait goes to the next Brain.

A 5xx gets one retry on the same Brain after a short pause, since provider overloads (e.g. Gemini 503 "high demand") are often brief and a user with a single key has nothing to fall back to.
