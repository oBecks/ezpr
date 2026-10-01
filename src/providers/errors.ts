import { APICallError, JSONParseError, NoObjectGeneratedError, TypeValidationError } from 'ai';

export type FailureKind =
  | 'rate-limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'bad-output'
  | 'context-too-long'
  | 'auth'
  | 'other';

export interface Classified {
  kind: FailureKind;
  message: string;
  /** Parsed from Retry-After when the provider sent one. */
  retryAfterMs?: number;
}

function retryAfterMs(headers: Record<string, string> | undefined): number | undefined {
  if (!headers) return undefined;
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const ms = Number(lower['retry-after-ms']);
  if (Number.isFinite(ms) && ms >= 0 && lower['retry-after-ms']) return ms;
  const secs = Number(lower['retry-after']);
  if (Number.isFinite(secs) && secs >= 0 && lower['retry-after']) return secs * 1000;
  return undefined;
}

/** Google reports the wait in the error body ("Please retry in 25.5s"), not in a header. */
function retryAfterFromMessage(message: string): number | undefined {
  const m = /retry in (\d+(?:\.\d+)?)\s*(ms|s)(?![a-z])/i.exec(message);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return Math.ceil(m[2]?.toLowerCase() === 'ms' ? n : n * 1000);
}

/** Some providers (Google) answer a bad key with 400 instead of 401. */
const BAD_KEY =
  /api[ _-]?key.*(invalid|not valid|incorrect)|invalid.*api[ _-]?key|incorrect api key/i;

const TOO_LONG = /context|too (long|large)|maximum.*tokens|token limit|exceeds/i;

/** Decides what a failure means for the chain (see ADR-0002). */
export function classify(err: unknown): Classified {
  const message = err instanceof Error ? err.message : String(err);

  if (APICallError.isInstance(err)) {
    const status = err.statusCode;
    if (status === 429) {
      return {
        kind: 'rate-limit',
        message,
        retryAfterMs: retryAfterMs(err.responseHeaders) ?? retryAfterFromMessage(message),
      };
    }
    if (status === 401 || status === 403 || (status === 400 && BAD_KEY.test(message))) {
      return { kind: 'auth', message };
    }
    if (status === 408) return { kind: 'timeout', message };
    if (status === 413 || (status === 400 && TOO_LONG.test(message))) {
      return { kind: 'context-too-long', message };
    }
    if (status !== undefined && status >= 500) return { kind: 'server', message };
    if (status === undefined) return { kind: 'network', message };
    return { kind: 'other', message };
  }

  if (
    NoObjectGeneratedError.isInstance(err) ||
    JSONParseError.isInstance(err) ||
    TypeValidationError.isInstance(err)
  ) {
    return { kind: 'bad-output', message };
  }

  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout', message };
  if (err instanceof TypeError || /ECONN|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(message)) {
    return { kind: 'network', message };
  }
  return { kind: 'other', message };
}

const DESCRIPTION: Record<FailureKind, string> = {
  'rate-limit': 'rate-limited',
  server: 'server error',
  timeout: 'timed out',
  network: 'network error',
  'bad-output': 'returned invalid output',
  'context-too-long': 'input too large for the model',
  auth: 'rejected the API key, check the secret',
  other: 'failed',
};

export function describeFailure(kind: FailureKind): string {
  return DESCRIPTION[kind];
}
