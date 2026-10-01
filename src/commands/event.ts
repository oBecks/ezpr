import type { Commenter } from './gate';

/** A comment that may hold a Command, reduced to what the handlers need. */
export interface CommandEvent extends Commenter {
  /** `conversation` = PR conversation comment; `thread` = reply on a line of the diff. */
  where: 'conversation' | 'thread';
  prNumber: number;
  commentId: number;
  body: string;
  /** For a thread reply: the first comment of the thread (the Finding, for EzPR's threads). */
  threadRootId?: number;
}

type Payload = Record<string, unknown>;
const obj = (v: unknown): Payload | undefined =>
  typeof v === 'object' && v !== null ? (v as Payload) : undefined;

/** Reads a created comment from an `issue_comment` or `pull_request_review_comment` payload. */
export function commandEventFrom(eventName: string, payload: Payload): CommandEvent | null {
  if (payload['action'] !== 'created') return null;
  const comment = obj(payload['comment']);
  if (!comment || typeof comment['id'] !== 'number' || typeof comment['body'] !== 'string') {
    return null;
  }
  const base = {
    commentId: comment['id'],
    body: comment['body'],
    authorAssociation: String(comment['author_association'] ?? ''),
    userType: String(obj(comment['user'])?.['type'] ?? ''),
  };
  if (eventName === 'issue_comment') {
    const issue = obj(payload['issue']);
    // Plain issues also fire issue_comment; only pull requests carry a `pull_request` key.
    if (!issue?.['pull_request'] || typeof issue['number'] !== 'number') return null;
    return { ...base, where: 'conversation', prNumber: issue['number'] };
  }
  if (eventName === 'pull_request_review_comment') {
    const pull = obj(payload['pull_request']);
    if (typeof pull?.['number'] !== 'number') return null;
    const replyTo = comment['in_reply_to_id'];
    return {
      ...base,
      where: 'thread',
      prNumber: pull['number'],
      threadRootId: typeof replyTo === 'number' ? replyTo : comment['id'],
    };
  }
  return null;
}
