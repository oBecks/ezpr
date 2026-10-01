import { MAX_DISMISSED, MAX_HISTORY, SUMMARY_MARKER_PREFIX } from '../config';

export interface HistoryEntry {
  sha: string;
  at: string;
  body: string;
}

export interface StickyState {
  /** Commit the latest Review covered; absent for Setup/error comments and pre-Phase-3 Summaries. */
  sha?: string;
  at?: string;
  /** Latest Review text, without the marker. */
  latest: string;
  history: HistoryEntry[];
  /** Keys of Findings a maintainer dismissed with `@ezpr ignore`; never raised again. */
  dismissed: string[];
}

const MARKER = new RegExp(
  String.raw`^${SUMMARY_MARKER_PREFIX}(?: sha=([0-9a-f]{7,40}))?(?: at=(\S+))?(?: dismissed=([0-9a-f,]+))? -->`,
);
const HISTORY_MARK = '<!-- ezpr:history -->';
const ENTRY =
  /<!-- ezpr:entry sha=(\S+) at=(\S+) -->\n<details>\n<summary>[^\n]*<\/summary>\n\n([\s\S]*?)\n\n<\/details>\n<!-- \/ezpr:entry -->/g;

export interface MarkerFields {
  sha?: string;
  at?: string;
  dismissed?: string[];
}

export function markerLine({ sha, at, dismissed = [] }: MarkerFields): string {
  const fields = [
    sha ? ` sha=${sha}` : '',
    at ? ` at=${at}` : '',
    dismissed.length ? ` dismissed=${dismissed.join(',')}` : '',
  ];
  return `${SUMMARY_MARKER_PREFIX}${fields.join('')} -->`;
}

export function buildMarker(sha: string, at: string, dismissed: string[] = []): string {
  return markerLine({ sha, at, dismissed });
}

export function formatTime(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function parseSticky(body: string): StickyState {
  const firstLine = body.split('\n', 1)[0] ?? '';
  const marker = MARKER.exec(firstLine);
  const rest = marker ? body.slice(firstLine.length).replace(/^\n/, '') : body;
  const split = rest.indexOf(`\n\n${HISTORY_MARK}`);
  const latest = split === -1 ? rest : rest.slice(0, split);
  const historyText = split === -1 ? '' : rest.slice(split);
  const history = [...historyText.matchAll(ENTRY)].map((m) => ({
    sha: m[1] ?? '',
    at: m[2] ?? '',
    body: m[3] ?? '',
  }));
  const dismissed = marker?.[3]?.split(',').filter(Boolean) ?? [];
  return { sha: marker?.[1], at: marker?.[2], latest, history, dismissed };
}

function renderEntry(e: HistoryEntry): string {
  return [
    `<!-- ezpr:entry sha=${e.sha} at=${e.at} -->`,
    '<details>',
    `<summary>\`${shortSha(e.sha)}\` · ${formatTime(e.at)}</summary>`,
    '',
    e.body,
    '',
    '</details>',
    '<!-- /ezpr:entry -->',
  ].join('\n');
}

/**
 * Build the sticky Summary body: the new Review on top, the previous latest Review (and the
 * history before it) in a collapsed section labelled with SHA and time.
 */
export function composeSticky(
  previous: StickyState | undefined,
  latest: string,
  sha: string,
  at: string,
): string {
  const history = [...(previous?.history ?? [])];
  if (previous?.sha && previous.at) {
    history.unshift({ sha: previous.sha, at: previous.at, body: previous.latest });
  }
  const kept = history.slice(0, MAX_HISTORY);
  const parts = [buildMarker(sha, at, previous?.dismissed), latest];
  if (kept.length) {
    parts.push(
      '',
      HISTORY_MARK,
      '<details>',
      `<summary>Earlier reviews (${kept.length})</summary>`,
      '',
      kept.map(renderEntry).join('\n\n'),
      '',
      '</details>',
    );
  }
  return parts.join('\n');
}

/** Records a dismissed Finding in the marker of an existing Summary body. Newest last, capped. */
export function addDismissed(body: string, key: string): string {
  const state = parseSticky(body);
  if (state.dismissed.includes(key)) return body;
  const dismissed = [...state.dismissed, key].slice(-MAX_DISMISSED);
  const firstLine = body.split('\n', 1)[0] ?? '';
  const rest = MARKER.test(firstLine) ? body.slice(firstLine.length) : `\n${body}`;
  return markerLine({ sha: state.sha, at: state.at, dismissed }) + rest;
}
