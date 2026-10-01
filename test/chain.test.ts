import { APICallError, NoObjectGeneratedError } from 'ai';
import { describe, expect, it } from 'vitest';
import { ChainError, runChain } from '../src/providers/chain';
import type { Brain } from '../src/providers/types';

const brain = (id: string): Brain => ({
  provider: 'gemini',
  id,
  maxInputTokens: 1,
  review: async () => ({ summary: id, findings: [] }),
});

const http = (statusCode: number, responseHeaders?: Record<string, string>) =>
  new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'https://example.test',
    requestBodyValues: {},
    statusCode,
    responseHeaders,
  });

const badOutput = () =>
  new NoObjectGeneratedError({
    message: 'bad',
    response: { id: 'x', timestamp: new Date(), modelId: 'm' },
    usage: {} as never,
    finishReason: 'stop',
  });

const noSleep = { sleep: async () => {} };

describe('runChain', () => {
  it('falls back on 429 without Retry-After and records the failure kind', async () => {
    const a = brain('a');
    const b = brain('b');
    const r = await runChain(
      [a, b],
      async (x) => {
        if (x === a) throw http(429);
        return x.id;
      },
      noSleep,
    );
    expect(r.brain).toBe(b);
    expect(r.failures).toEqual([{ brain: 'a', kind: 'rate-limit', error: 'HTTP 429' }]);
  });

  it('retries a 5xx once after a pause, then falls back', async () => {
    const [a, b] = [brain('a'), brain('b')];
    const slept: number[] = [];
    let aCalls = 0;
    const r = await runChain(
      [a, b],
      async (x) => {
        if (x === a) {
          aCalls++;
          throw http(503);
        }
        return x.id;
      },
      { sleep: async (ms) => void slept.push(ms) },
    );
    expect(aCalls).toBe(2);
    expect(slept).toEqual([2000]);
    expect(r.brain).toBe(b);
    expect(r.failures[0]?.kind).toBe('server');
  });

  it('succeeds when the retry after a 5xx works', async () => {
    const a = brain('a');
    let calls = 0;
    const r = await runChain(
      [a],
      async (x) => {
        if (++calls === 1) throw http(503);
        return x.id;
      },
      noSleep,
    );
    expect(r.brain).toBe(a);
    expect(r.failures).toEqual([]);
  });

  it('waits once for a short Retry-After and retries the same brain', async () => {
    const a = brain('a');
    const slept: number[] = [];
    let calls = 0;
    const r = await runChain(
      [a, brain('b')],
      async (x) => {
        calls++;
        if (calls === 1) throw http(429, { 'retry-after': '2' });
        return x.id;
      },
      { sleep: async (ms) => void slept.push(ms) },
    );
    expect(r.brain).toBe(a);
    expect(slept).toEqual([2000]);
    expect(r.failures).toEqual([]);
  });

  it('does not wait for a long Retry-After', async () => {
    const [a, b] = [brain('a'), brain('b')];
    const slept: number[] = [];
    const r = await runChain(
      [a, b],
      async (x) => {
        if (x === a) throw http(429, { 'retry-after': '120' });
        return x.id;
      },
      { sleep: async (ms) => void slept.push(ms) },
    );
    expect(slept).toEqual([]);
    expect(r.brain).toBe(b);
  });

  it('retries once after invalid output, then falls back', async () => {
    const [a, b] = [brain('a'), brain('b')];
    let aCalls = 0;
    const r = await runChain([a, b], async (x) => {
      if (x === a) {
        aCalls++;
        throw badOutput();
      }
      return x.id;
    });
    expect(aCalls).toBe(2);
    expect(r.brain).toBe(b);
    expect(r.failures[0]?.kind).toBe('bad-output');
  });

  it('accepts a repaired output on the second attempt', async () => {
    const a = brain('a');
    let calls = 0;
    const r = await runChain([a], async () => {
      if (++calls === 1) throw badOutput();
      return 'ok';
    });
    expect(r.result).toBe('ok');
    expect(r.failures).toEqual([]);
  });

  it('skips a brain with a rejected key without retrying', async () => {
    const [a, b] = [brain('a'), brain('b')];
    let aCalls = 0;
    const r = await runChain([a, b], async (x) => {
      if (x === a) {
        aCalls++;
        throw http(401);
      }
      return x.id;
    });
    expect(aCalls).toBe(1);
    expect(r.failures[0]?.kind).toBe('auth');
  });

  it('throws ChainError with every failure when all brains fail', async () => {
    const err = await runChain(
      [brain('a'), brain('b')],
      async () => {
        throw http(500);
      },
      noSleep,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ChainError);
    expect((err as ChainError).failures.map((f) => f.brain)).toEqual(['a', 'b']);
  });
});
