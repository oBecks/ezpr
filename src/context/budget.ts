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
  /** Paths whose diff was dropped entirely because the budget ran out. */
  droppedDiffs: string[];
  /** Paths whose full content was dropped to stay in budget. */
  droppedContents: string[];
}

/**
 * Priority: every diff first (in order), then full file contents smallest-first.
 * `files` holds the candidate content; returned entries are trimmed to the budget.
 */
export function fitToBudget(files: FileEntry[], budgetTokens: number): Fitted {
  let used = 0;
  const droppedDiffs: string[] = [];
  const droppedContents: string[] = [];
  const kept: FileEntry[] = [];

  for (const f of files) {
    const cost = estimateTokens(f.patch) + estimateTokens(f.path) + 10;
    if (used + cost > budgetTokens) {
      droppedDiffs.push(f.path);
      continue;
    }
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

  return { files: kept, droppedDiffs, droppedContents };
}
