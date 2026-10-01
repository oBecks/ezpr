import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/providers/errors';

const http = (statusCode: number | undefined, message = 'x', headers?: Record<string, string>) =>
  new APICallError({
    message,
    url: 'https://example.test',
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
  });

describe('classify', () => {
  it.each([
    [429, 'rate-limit'],
    [401, 'auth'],
    [403, 'auth'],
    [408, 'timeout'],
    [413, 'context-too-long'],
    [500, 'server'],
    [503, 'server'],
    [404, 'other'],
  ] as const)('maps HTTP %i to %s', (status, kind) => {
    expect(classify(http(status)).kind).toBe(kind);
  });

  it('treats a 400 about context length as context-too-long', () => {
    expect(classify(http(400, 'maximum context length exceeded')).kind).toBe('context-too-long');
    expect(classify(http(400, 'bad field')).kind).toBe('other');
  });

  it('treats a 400 asking to reduce the message length (Groq) as context-too-long', () => {
    expect(
      classify(http(400, 'Please reduce the length of the messages or completion.')).kind,
    ).toBe('context-too-long');
  });

  it('treats a 400 about an invalid API key as auth (Google style)', () => {
    expect(classify(http(400, 'API key not valid. Please pass a valid API key.')).kind).toBe(
      'auth',
    );
    expect(classify(http(400, 'Incorrect API key provided')).kind).toBe('auth');
  });

  it('treats a response-less API error as a network error', () => {
    expect(classify(http(undefined)).kind).toBe('network');
  });

  it('parses Retry-After seconds and milliseconds', () => {
    expect(classify(http(429, 'x', { 'Retry-After': '3' })).retryAfterMs).toBe(3000);
    expect(classify(http(429, 'x', { 'retry-after-ms': '250' })).retryAfterMs).toBe(250);
    expect(classify(http(429)).retryAfterMs).toBeUndefined();
  });

  it('reads the wait from the error text when there is no header (Google style)', () => {
    const msg = 'You exceeded your current quota. Please retry in 25.586407951s.';
    expect(classify(http(429, msg)).retryAfterMs).toBe(25_587);
    expect(classify(http(429, 'retry in 300ms')).retryAfterMs).toBe(300);
    expect(classify(http(429, 'try again later')).retryAfterMs).toBeUndefined();
  });

  it('prefers the Retry-After header over the error text', () => {
    expect(classify(http(429, 'retry in 25s', { 'retry-after': '2' })).retryAfterMs).toBe(2000);
  });

  it('recognises timeouts and fetch failures', () => {
    const t = new Error('t');
    t.name = 'TimeoutError';
    expect(classify(t).kind).toBe('timeout');
    expect(classify(new TypeError('fetch failed')).kind).toBe('network');
    expect(classify(new Error('boom')).kind).toBe('other');
  });
});
