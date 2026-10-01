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
type Fields = Omit<CommandEvent, 'where' | 'prNumber' | 'threadRootId'>;

const obj = (v: unknown): Payload => (typeof v === 'object' && v !== null ? (v as Payload) : {});
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** The comment of a created-comment payload, or null when it lacks an id or a body. */
function commentFields(payload: Payload): (Fields & { replyTo?: number }) | null {
  const comment = obj(payload['comment']);
  const commentId = num(comment['id']);
  if (payload['action'] !== 'created' || commentId === undefined) return null;
  if (typeof comment['body'] !== 'string') return null;
  return {
    commentId,
    body: comment['body'],
    authorAssociation: String(comment['author_association'] ?? ''),
    userType: String(obj(comment['user'])['type'] ?? ''),
    replyTo: num(comment['in_reply_to_id']),
  };
}

/** Plain issues also fire `issue_comment`; only pull requests carry a `pull_request` key. */
function conversationEvent(payload: Payload, fields: Fields): CommandEvent | null {
  const issue = obj(payload['issue']);
  const prNumber = num(issue['number']);
  if (!issue['pull_request'] || prNumber === undefined) return null;
  return { ...fields, where: 'conversation', prNumber };
}

/** A thread is rooted at the comment replied to, or at the comment itself when it starts one. */
function threadEvent(payload: Payload, fields: Fields, replyTo?: number): CommandEvent | null {
  const prNumber = num(obj(payload['pull_request'])['number']);
  if (prNumber === undefined) return null;
  return { ...fields, where: 'thread', prNumber, threadRootId: replyTo ?? fields.commentId };
}

/** Reads a created comment from an `issue_comment` or `pull_request_review_comment` payload. */
export function commandEventFrom(eventName: string, payload: Payload): CommandEvent | null {
  const { replyTo, ...fields } = commentFields(payload) ?? {};
  if (!('commentId' in fields)) return null;
  if (eventName === 'issue_comment') return conversationEvent(payload, fields);
  if (eventName === 'pull_request_review_comment') return threadEvent(payload, fields, replyTo);
  return null;
}
