import { fitToBudget, type Extras, type FileEntry } from './budget';
import type { CallerSnippet } from './callers';
import { skipReason } from './filter';
import type { ImportedFile } from './imports';
import { redact } from './redact';

export interface RawFile {
  path: string;
  status: string;
  patch?: string;
}

export interface Context {
  files: FileEntry[];
  callers: CallerSnippet[];
  imports: ImportedFile[];
  skippedNoise: string[];
  skippedSecrets: string[];
  /** Files matched by the `ignore` input. */
  skippedIgnored: string[];
  /** Files GitHub sent no diff for (too large to include). */
  missingPatch: string[];
  droppedDiffs: string[];
  droppedContents: string[];
  droppedCallers: number;
  droppedImports: string[];
}

/** Maximum size of one file's full content we will consider sending. */
const MAX_FILE_CHARS = 200_000;

export interface Prepared {
  candidates: FileEntry[];
  skippedNoise: string[];
  skippedSecrets: string[];
  skippedIgnored: string[];
  missingPatch: string[];
}

/** Filters and redacts the changed files; independent of any Brain's budget. */
export async function prepareFiles(
  raw: RawFile[],
  readFile: (path: string) => Promise<string | null>,
  ignored: (path: string) => boolean = () => false,
): Promise<Prepared> {
  const skippedNoise: string[] = [];
  const skippedSecrets: string[] = [];
  const skippedIgnored: string[] = [];
  const missingPatch: string[] = [];
  const candidates: FileEntry[] = [];

  for (const f of raw) {
    const reason = skipReason(f.path);
    if (reason === 'secret') {
      skippedSecrets.push(f.path);
      continue;
    }
    if (reason === 'noise') {
      skippedNoise.push(f.path);
      continue;
    }
    if (ignored(f.path)) {
      skippedIgnored.push(f.path);
      continue;
    }
    if (!f.patch) {
      missingPatch.push(f.path);
      continue;
    }
    const content = f.status === 'removed' ? null : await readFile(f.path);
    candidates.push({
      path: f.path,
      status: f.status,
      patch: redact(f.patch),
      content: content !== null && content.length <= MAX_FILE_CHARS ? redact(content) : undefined,
    });
  }
  return { candidates, skippedNoise, skippedSecrets, skippedIgnored, missingPatch };
}

/** Fits `files` (a chunk of the prepared candidates) and extras to one Brain's budget. */
export function buildContext(
  prepared: Omit<Prepared, 'candidates'>,
  files: FileEntry[],
  budgetTokens: number,
  extras: Extras = {},
): Context {
  const fitted = fitToBudget(files, budgetTokens, extras);
  return {
    files: fitted.files,
    callers: fitted.callers,
    imports: fitted.imports,
    skippedNoise: prepared.skippedNoise,
    skippedSecrets: prepared.skippedSecrets,
    skippedIgnored: prepared.skippedIgnored,
    missingPatch: prepared.missingPatch,
    droppedDiffs: fitted.droppedDiffs,
    droppedContents: fitted.droppedContents,
    droppedCallers: fitted.droppedCallers,
    droppedImports: fitted.droppedImports,
  };
}

export async function collectContext(
  raw: RawFile[],
  readFile: (path: string) => Promise<string | null>,
  budgetTokens: number,
): Promise<Context> {
  const prepared = await prepareFiles(raw, readFile);
  return buildContext(prepared, prepared.candidates, budgetTokens);
}
