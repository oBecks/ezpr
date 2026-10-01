import { describe, expect, it } from 'vitest';
import { INLINE_MARKER, SUMMARY_MARKER } from '../src/config';
import { findStickyComment, inlineBody, parseInlineBody } from '../src/github/comments';

describe('findStickyComment', () => {
  it('finds the comment carrying the marker', () => {
    const comments = [
      { id: 1, body: 'hello' },
      { id: 2, body: `${SUMMARY_MARKER}\nold review` },
      { id: 3, body: null },
    ];
    expect(findStickyComment(comments)?.id).toBe(2);
  });

  it('returns undefined when there is none', () => {
    expect(findStickyComment([{ id: 1, body: 'x' }])).toBeUndefined();
  });
});

describe('parseInlineBody', () => {
  it('recovers the message from an inline comment body', () => {
    const f = {
      file: 'a.ts',
      line: 1,
      severity: 'high' as const,
      message: 'Line one.\n\nLine two.',
    };
    expect(parseInlineBody(inlineBody(f))).toBe('Line one.\n\nLine two.');
  });

  it('returns null for comments that are not EzPR findings', () => {
    expect(parseInlineBody('a human wrote this')).toBeNull();
    expect(parseInlineBody(`no severity here\n\n${INLINE_MARKER}`)).toBeNull();
  });
});
