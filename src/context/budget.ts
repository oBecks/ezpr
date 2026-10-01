import type { CallerSnippet } from './callers';
import type { ImportedFile } from './imports';

/** Rough token estimate (about 4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface FileEntry {
  path: string;
  status: string;
  patch: string;
  content?: string;
}

export interface Fitted {
  files: FileEntry[];
  callers: CallerSnippet[];
  imports: ImportedFile[];
  /** Paths whose diff was dropped entirely because the budget ran out. */
  droppedDiffs: string[];
  /** Paths whose full content was dropped to stay in budget. */
  droppedContents: string[];
  /** Caller snippets dropped to stay in budget. */
  droppedCallers: number;
  /** Imported files dropped to stay in budget. */
  droppedImports: string[];
}

export interface Extras {
  callers?: CallerSnippet[];
  imports?: ImportedFile[];
}

/** Tokens a file's diff costs in the prompt. */
export function diffCost(f: { patch: string; path: string }): number {
  return estimateTokens(f.patch) + estimateTokens(f.path) + 10;
}

/**
 * Priority: every diff first (in order), then full file contents smallest-first, then
 * Caller snippets, then Imported files. Each lower tier is dropped before a higher one.
 * `files` holds the candidate content; returned entries are trimmed to the budget.
 */
export function fitToBudget(files: FileEntry[], budgetTokens: number, extras: Extras = {}): Fitted {
  let used = 0;
  const droppedDiffs: string[] = [];
  const droppedContents: string[] = [];
  const kept: FileEntry[] = [];

  for (const f of files) {
    const cost = diffCost(f);
    if (used + cost > budgetTokens) {
      droppedDiffs.push(f.path);
      continue;
    }
    used += cost;
    kept.push({ ...f, content: undefined });
  }

  const candidates = files
    .filter((f) => f.content !== undefined && kept.some((k) => k.path === f.path))
    .sort((a, b) => (a.content?.length ?? 0) - (b.content?.length ?? 0));

  for (const f of candidates) {
    const cost = estimateTokens(f.content ?? '');
    const target = kept.find((k) => k.path === f.path);
    if (!target) continue;
    if (used + cost > budgetTokens) {
      droppedContents.push(f.path);
      continue;
    }
    used += cost;
    target.content = f.content;
  }

  const callers: CallerSnippet[] = [];
  let droppedCallers = 0;
  for (const c of extras.callers ?? []) {
    const cost = estimateTokens(c.snippet) + estimateTokens(c.path) + 10;
    if (used + cost > budgetTokens) {
      droppedCallers++;
      continue;
    }
    used += cost;
    callers.push(c);
  }

  const imports: ImportedFile[] = [];
  const droppedImports: string[] = [];
  for (const i of extras.imports ?? []) {
    const cost = estimateTokens(i.content) + estimateTokens(i.path) + 10;
    if (used + cost > budgetTokens) {
      droppedImports.push(i.path);
      continue;
    }
    used += cost;
    imports.push(i);
  }

  return {
    files: kept,
    callers,
    imports,
    droppedDiffs,
    droppedContents,
    droppedCallers,
    droppedImports,
  };
}
