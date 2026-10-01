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

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const re = new RegExp(`(?<![\\w$])(${symbols.map(escape).join('|')})(?![\\w$])`);
  const counts = new Map<string, number>();
  const hits: CallerSnippet[] = [];
  let scanned = 0;

  const stack: string[] = [''];
  while (stack.length > 0 && hits.length < maxTotal && scanned < maxFiles) {
    const rel = stack.pop() ?? '';
    let entries;
    try {
      entries = await readdir(nodePath.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const dirs: string[] = [];
    for (const e of entries) {
      if (hits.length >= maxTotal || scanned >= maxFiles) break;
      if (e.isSymbolicLink()) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (skipReason(`${p}/`) === null && !opts.ignored(p)) dirs.push(p);
        continue;
      }
      if (!e.isFile() || skipReason(p) !== null || opts.ignored(p) || opts.exclude.has(p)) continue;
      scanned++;
      let text: string;
      try {
        text = await readFile(nodePath.join(root, p), 'utf8');
      } catch {
        continue;
      }
      if (text.length > MAX_FILE_CHARS || text.includes('\0')) continue;
      const lines = text.split('\n');
      let lastHit = -Infinity;
      for (let i = 0; i < lines.length; i++) {
        const symbol = re.exec(lines[i] ?? '')?.[1];
        if (!symbol || i - lastHit <= context) continue;
        if ((counts.get(symbol) ?? 0) >= maxPerSymbol) continue;
        counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
        lastHit = i;
        const from = Math.max(0, i - context);
        const to = Math.min(lines.length, i + context + 1);
        const snippet = lines
          .slice(from, to)
          .map((l, k) => `${from + k + 1}: ${l}`)
          .join('\n');
        hits.push({ path: p, line: i + 1, symbol, snippet: redact(snippet) });
        if (hits.length >= maxTotal) break;
      }
    }
    // Depth-first in name order: push reversed so the first directory is popped first.
    stack.push(...dirs.reverse());
  }
  return hits;
}
