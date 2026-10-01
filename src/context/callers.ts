import { readdir, readFile } from 'node:fs/promises';
import * as nodePath from 'node:path';
import { skipReason } from './filter';
import { redact } from './redact';

export interface CallerSnippet {
  path: string;
  line: number;
  symbol: string;
  /** Numbered lines around the hit. */
  snippet: string;
}

export interface CallerOptions {
  /** Changed files: their uses are already in the diff. */
  exclude: ReadonlySet<string>;
  ignored: (path: string) => boolean;
  maxPerSymbol?: number;
  maxTotal?: number;
  maxFiles?: number;
  context?: number;
}

const MAX_FILE_CHARS = 200_000;

interface Search {
  re: RegExp;
  counts: Map<string, number>;
  maxPerSymbol: number;
  context: number;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function snippetAt(lines: string[], index: number, context: number): string {
  const from = Math.max(0, index - context);
  const to = Math.min(lines.length, index + context + 1);
  return lines
    .slice(from, to)
    .map((l, k) => `${from + k + 1}: ${l}`)
    .join('\n');
}

/** Hits in one file; hits closer together than `context` lines count once. */
function matchFile(path: string, text: string, s: Search, room: number): CallerSnippet[] {
  const lines = text.split('\n');
  const out: CallerSnippet[] = [];
  let lastHit = -Infinity;
  for (let i = 0; i < lines.length && out.length < room; i++) {
    const symbol = s.re.exec(lines[i] ?? '')?.[1];
    if (!symbol || i - lastHit <= s.context) continue;
    const seen = s.counts.get(symbol) ?? 0;
    if (seen >= s.maxPerSymbol) continue;
    s.counts.set(symbol, seen + 1);
    lastHit = i;
    out.push({ path, line: i + 1, symbol, snippet: redact(snippetAt(lines, i, s.context)) });
  }
  return out;
}

const searchableFile = (path: string, opts: CallerOptions): boolean =>
  skipReason(path) === null && !opts.ignored(path) && !opts.exclude.has(path);

const searchableDir = (path: string, opts: CallerOptions): boolean =>
  skipReason(`${path}/`) === null && !opts.ignored(path);

/** Files of the checkout in name order, depth first. Symlinks are never followed. */
async function* walk(root: string, opts: CallerOptions): AsyncGenerator<string> {
  const stack: string[] = [''];
  while (stack.length > 0) {
    const rel = stack.pop() ?? '';
    const entries = await readdir(nodePath.join(root, rel), { withFileTypes: true }).catch(
      () => [],
    );
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const at = (name: string) => (rel ? `${rel}/${name}` : name);
    const real = entries.filter((e) => !e.isSymbolicLink());
    const dirs = real.filter((e) => e.isDirectory()).map((e) => at(e.name));
    yield* real.filter((e) => e.isFile()).map((e) => at(e.name));
    // Pushed reversed so the first directory is popped first.
    stack.push(...dirs.filter((d) => searchableDir(d, opts)).reverse());
  }
}

async function readText(root: string, path: string): Promise<string | null> {
  const text = await readFile(nodePath.join(root, path), 'utf8').catch(() => null);
  return text === null || text.length > MAX_FILE_CHARS || text.includes('\0') ? null : text;
}

/**
 * Searches the checkout at `root` for uses of `symbols` outside the changed files. Symlinks
 * are never followed, so a PR cannot point the search outside the workspace.
 */
export async function findCallers(
  root: string,
  symbols: string[],
  opts: CallerOptions,
): Promise<CallerSnippet[]> {
  if (symbols.length === 0) return [];
  const { maxPerSymbol = 5, maxTotal = 20, maxFiles = 5000, context = 5 } = opts;
  const search: Search = {
    re: new RegExp(`(?<![\\w$])(${symbols.map(escape).join('|')})(?![\\w$])`),
    counts: new Map(),
    maxPerSymbol,
    context,
  };
  const hits: CallerSnippet[] = [];
  let scanned = 0;
  for await (const path of walk(root, opts)) {
    if (!searchableFile(path, opts)) continue;
    const text = await readText(root, path);
    if (text !== null) hits.push(...matchFile(path, text, search, maxTotal - hits.length));
    if (hits.length >= maxTotal || ++scanned >= maxFiles) break;
  }
  return hits;
}
