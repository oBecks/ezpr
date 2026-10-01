import { classify, type FailureKind } from './errors';
import type { Brain } from './types';

export interface ChainFailure {
  brain: string;
  kind: FailureKind;
  error: string;
}

export interface ChainSuccess<T> {
  result: T;
  brain: Brain;
  failures: ChainFailure[];
}

export class ChainError extends Error {
  constructor(public failures: ChainFailure[]) {
    super(`All brains failed: ${failures.map((f) => `${f.brain}: ${f.error}`).join('; ')}`);
  }
}

export interface ChainOptions {
  /** A Retry-After longer than this sends us to the next Brain instead of waiting. */
  maxRetryAfterMs?: number;
  /** Pause before the single retry after a server error (5xx). */
  serverRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Tries each Brain in order (ADR-0002). Each Brain gets at most one retry: a repair attempt
 * after invalid output, one wait after a short Retry-After, or one pause after a server error. A rejected key (401/403) skips
 * that Brain and is reported rather than retried.
 */
export async function runChain<T>(
  brains: Brain[],
  run: (brain: Brain) => Promise<T>,
  opts: ChainOptions = {},
): Promise<ChainSuccess<T>> {
  const { maxRetryAfterMs = 30_000, serverRetryDelayMs = 2_000, sleep = defaultSleep } = opts;
  const failures: ChainFailure[] = [];

  for (const brain of brains) {
    let retried = false;
    for (;;) {
      try {
        return { result: await run(brain), brain, failures };
      } catch (err) {
        const c = classify(err);
        if (!retried && c.kind === 'bad-output') {
          retried = true;
          continue;
        }
        if (
          !retried &&
          c.kind === 'rate-limit' &&
          c.retryAfterMs !== undefined &&
          c.retryAfterMs <= maxRetryAfterMs
        ) {
          retried = true;
          await sleep(c.retryAfterMs);
          continue;
        }
        if (!retried && c.kind === 'server') {
          retried = true;
          await sleep(serverRetryDelayMs);
          continue;
        }
        failures.push({ brain: brain.id, kind: c.kind, error: c.message });
        break;
      }
    }
  }
  throw new ChainError(failures);
}
