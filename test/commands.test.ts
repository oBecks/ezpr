import { describe, expect, it, vi } from 'vitest';
import { commandEventFrom, type CommandEvent } from '../src/commands/event';
import { excerpt } from '../src/commands/explain';
import { mayRunCommands } from '../src/commands/gate';
import { IGNORE_HINT, ignoreFinding } from '../src/commands/ignore';
import { parseCommand } from '../src/commands/parse';
import { handleCommand, USAGE } from '../src/commands/run';
import { inlineBody } from '../src/github/comments';
import { buildMarker, parseSticky } from '../src/github/sticky';
import type { Octokit } from '../src/github/pr';
import { findingKey, withoutDismissed } from '../src/review/dismissed';

const repo = { owner: 'o', repo: 'r' };
const SHA = 'a'.repeat(40);
const AT = '2026-10-01T10:00:00.000Z';

describe('parseCommand', () => {
  it('reads each command, case-insensitively', () => {
    expect(parseCommand('@ezpr review')).toEqual({ kind: 'command', name: 'review' });
    expect(parseCommand('@EzPR Explain')).toEqual({ kind: 'command', name: 'explain' });
    expect(parseCommand('@ezpr ignore')).toEqual({ kind: 'command', name: 'ignore' });
  });

  it('ignores trailing text and takes only the first command', () => {
    expect(parseCommand('@ezpr review please, thanks\n@ezpr ignore')).toEqual({
      kind: 'command',
      name: 'review',
    });
  });

  it('only counts a mention at the start of a line', () => {
    expect(parseCommand('hey @ezpr review')).toBeNull();
    expect(parseCommand('thanks\n@ezpr review')).toEqual({ kind: 'command', name: 'review' });
    expect(parseCommand('   @ezpr review')).toEqual({ kind: 'command', name: 'review' });
  });

  it('skips quoted lines and code fences', () => {
    expect(parseCommand('> @ezpr review')).toBeNull();
    expect(parseCommand('```\n@ezpr review\n```')).toBeNull();
    expect(parseCommand('~~~\n@ezpr review\n~~~\n@ezpr explain')).toEqual({
      kind: 'command',
      name: 'explain',
    });
  });

  it('reports unknown words and a bare mention', () => {
    expect(parseCommand('@ezpr foo')).toEqual({ kind: 'unknown', word: 'foo' });
    expect(parseCommand('@ezpr')).toEqual({ kind: 'unknown', word: '' });
  });

  it('does not match other handles', () => {
    expect(parseCommand('@ezpr-bot review')).toBeNull();
    expect(parseCommand('@ezprs review')).toBeNull();
  });

  it('never parses the usage reply as a command', () => {
    expect(parseCommand(USAGE)).toBeNull();
    expect(parseCommand(IGNORE_HINT)).toBeNull();
  });
});

describe('mayRunCommands', () => {
  it('allows owners, members and collaborators', () => {
    for (const authorAssociation of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
      expect(mayRunCommands({ authorAssociation, userType: 'User' })).toBe(true);
    }
  });

  it('refuses everyone else, and bots', () => {
    for (const authorAssociation of ['CONTRIBUTOR', 'FIRST_TIMER', 'NONE', '']) {
      expect(mayRunCommands({ authorAssociation, userType: 'User' })).toBe(false);
    }
    expect(mayRunCommands({ authorAssociation: 'OWNER', userType: 'Bot' })).toBe(false);
    expect(mayRunCommands({})).toBe(false);
  });
});

describe('commandEventFrom', () => {
  const comment = {
    id: 7,
    body: '@ezpr review',
    author_association: 'OWNER',
    user: { type: 'User' },
  };

  it('reads a PR conversation comment', () => {
    const ev = commandEventFrom('issue_comment', {
      action: 'created',
      issue: { number: 12, pull_request: {} },
      comment,
    });
    expect(ev).toEqual({
      where: 'conversation',
      prNumber: 12,
      commentId: 7,
      body: '@ezpr review',
      authorAssociation: 'OWNER',
      userType: 'User',
    });
  });

  it('ignores comments on plain issues, edits and other events', () => {
    expect(
      commandEventFrom('issue_comment', { action: 'created', issue: { number: 1 }, comment }),
    ).toBeNull();
    expect(
      commandEventFrom('issue_comment', {
        action: 'edited',
        issue: { number: 1, pull_request: {} },
        comment,
      }),
    ).toBeNull();
    expect(commandEventFrom('push', { action: 'created', comment })).toBeNull();
  });

  it('uses the thread root for a review comment, or the comment itself when it starts a thread', () => {
    const base = { action: 'created', pull_request: { number: 3 } };
    const reply = commandEventFrom('pull_request_review_comment', {
      ...base,
      comment: { ...comment, in_reply_to_id: 99 },
    });
    expect(reply).toMatchObject({ where: 'thread', prNumber: 3, threadRootId: 99 });
    const first = commandEventFrom('pull_request_review_comment', { ...base, comment });
    expect(first).toMatchObject({ where: 'thread', threadRootId: 7 });
  });
});

describe('findingKey', () => {
  it('ignores case and spacing, but not the file or the wording', () => {
    expect(findingKey('a.ts', 'Null  deref\nhere')).toBe(findingKey('a.ts', 'null deref here'));
    expect(findingKey('a.ts', 'null deref')).not.toBe(findingKey('b.ts', 'null deref'));
    expect(findingKey('a.ts', 'null deref')).not.toBe(findingKey('a.ts', 'off by one'));
  });
});

describe('excerpt', () => {
  it('numbers the lines around the target, clamped to the file', () => {
    const content = ['a', 'b', 'c', 'd', 'e'].join('\n');
    expect(excerpt(content, 3, 1)).toBe('2: b\n3: c\n4: d');
    expect(excerpt(content, 1, 1)).toBe('1: a\n2: b');
    expect(excerpt(content, 5, 10)).toBe('1: a\n2: b\n3: c\n4: d\n5: e');
  });
});

interface Calls {
  replies: string[];
  comments: string[];
  updated: string[];
}

/** Just the Octokit calls the Command handlers make. */
function fakeOctokit(opts: { rootBody?: string; stickyBody?: string }) {
  const calls: Calls = { replies: [], comments: [], updated: [] };
  const octokit = {
    paginate: vi.fn(async () => (opts.stickyBody ? [{ id: 5, body: opts.stickyBody }] : [])),
    rest: {
      issues: {
        listComments: {},
        updateComment: vi.fn(async (a: { body: string }) => void calls.updated.push(a.body)),
        createComment: vi.fn(async (a: { body: string }) => void calls.comments.push(a.body)),
      },
      pulls: {
        getReviewComment: vi.fn(async () => ({
          data: { id: 99, path: 'src/a.ts', body: opts.rootBody ?? '' },
        })),
        createReplyForReviewComment: vi.fn(
          async (a: { body: string }) => void calls.replies.push(a.body),
        ),
      },
      reactions: {
        createForIssueComment: vi.fn(async () => ({})),
        createForPullRequestReviewComment: vi.fn(async () => ({})),
      },
    },
  };
  return { octokit: octokit as unknown as Octokit, raw: octokit, calls };
}

const threadEvent = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  where: 'thread',
  prNumber: 4,
  commentId: 100,
  threadRootId: 99,
  body: '@ezpr ignore',
  authorAssociation: 'OWNER',
  userType: 'User',
  ...over,
});

describe('ignoreFinding', () => {
  const finding = { file: 'src/a.ts', line: 3, severity: 'high' as const, message: 'Null deref.' };

  it('records the finding in the Summary marker and replies in the thread', async () => {
    const stickyBody = `${buildMarker(SHA, AT)}\n## EzPR review`;
    const { octokit, calls } = fakeOctokit({ rootBody: inlineBody(finding), stickyBody });
    await ignoreFinding(octokit, repo, threadEvent());

    const state = parseSticky(calls.updated[0] ?? '');
    expect(state.dismissed).toEqual([findingKey('src/a.ts', 'Null deref.')]);
    expect(state.sha).toBe(SHA);
    expect(state.latest).toBe('## EzPR review');
    expect(calls.replies[0]).toMatch(/Dismissed/);
  });

  it('keeps earlier dismissals and does not repeat a key', async () => {
    const key = findingKey('src/a.ts', 'Null deref.');
    const stickyBody = `${buildMarker(SHA, AT, ['abcdef012345', key])}\nbody`;
    const { octokit, calls } = fakeOctokit({ rootBody: inlineBody(finding), stickyBody });
    await ignoreFinding(octokit, repo, threadEvent());
    expect(calls.updated[0]).toBe(stickyBody);
  });

  it('says how to use it outside a thread, or on a comment that is not a finding', async () => {
    const outside = fakeOctokit({ stickyBody: 'x' });
    await ignoreFinding(outside.octokit, repo, threadEvent({ where: 'conversation' }));
    expect(outside.calls.comments).toEqual([IGNORE_HINT]);

    const other = fakeOctokit({ rootBody: 'just a human comment', stickyBody: 'x' });
    await ignoreFinding(other.octokit, repo, threadEvent());
    expect(other.calls.replies).toEqual([IGNORE_HINT]);
    expect(other.calls.updated).toEqual([]);
  });
});

describe('handleCommand', () => {
  it('says nothing to a commenter who is not a maintainer', async () => {
    const { octokit, calls, raw } = fakeOctokit({});
    await handleCommand(
      octokit,
      repo,
      threadEvent({ authorAssociation: 'NONE', body: '@ezpr foo' }),
    );
    expect(calls.replies).toEqual([]);
    expect(calls.comments).toEqual([]);
    expect(raw.rest.reactions.createForPullRequestReviewComment).not.toHaveBeenCalled();
  });

  it('does nothing when there is no command', async () => {
    const { octokit, calls } = fakeOctokit({});
    await handleCommand(octokit, repo, threadEvent({ body: 'looks good to me' }));
    expect(calls.replies).toEqual([]);
  });

  it('lists the commands for an unknown one, without a reaction', async () => {
    const { octokit, calls, raw } = fakeOctokit({});
    await handleCommand(octokit, repo, threadEvent({ body: '@ezpr dance' }));
    expect(calls.replies).toEqual([USAGE]);
    expect(raw.rest.reactions.createForPullRequestReviewComment).not.toHaveBeenCalled();
  });

  it('reacts with eyes before running a command', async () => {
    const { octokit, raw } = fakeOctokit({ rootBody: 'human', stickyBody: 'x' });
    await handleCommand(octokit, repo, threadEvent());
    expect(raw.rest.reactions.createForPullRequestReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 100, content: 'eyes' }),
    );
  });
});

describe('withoutDismissed', () => {
  const a = { file: 'a.ts', line: 1, severity: 'high' as const, message: 'Null deref.' };
  const b = { file: 'a.ts', line: 9, severity: 'low' as const, message: 'Other.' };

  it('drops dismissed findings wherever they moved to', () => {
    const key = findingKey('a.ts', 'null deref.');
    expect(withoutDismissed([{ ...a, line: 40 }, b], [key])).toEqual([b]);
  });

  it('keeps everything when nothing is dismissed', () => {
    const list = [a, b];
    expect(withoutDismissed(list, [])).toBe(list);
  });
});
