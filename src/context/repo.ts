import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import * as nodePath from 'node:path';
import type { Extras, FileEntry } from './budget';
import { findCallers, type CallerSnippet } from './callers';
import { resolveImports, type ImportedFile } from './imports';
import { symbolsOf } from './symbols';

/** The checkout directory, if the workflow ran `actions/checkout` (ADR-0007). */
export function checkoutRoot(env: NodeJS.ProcessEnv): string | undefined {
  const ws = env['GITHUB_WORKSPACE'];
  return ws && existsSync(nodePath.join(ws, '.git')) ? ws : undefined;
}

/** Reads a repo file from the checkout; never follows a path out of it (symlinks, `..`). */
export function checkoutReader(root: string): (path: string) => Promise<string | null> {
  return async (path) => {
    try {
      const real = await realpath(nodePath.join(root, path));
      const realRoot = await realpath(root);
      if (real !== realRoot && !real.startsWith(realRoot + nodePath.sep)) return null;
      return await readFile(real, 'utf8');
    } catch {
      return null;
    }
  };
}

export interface GatherOptions {
  /** Reads a repo file: from the checkout when there is one, else from the API. */
  read: (path: string) => Promise<string | null>;
  /** Checkout directory; without it Caller snippets are not searched. */
  root?: string;
  /** Every changed file in the PR. */
  changed: ReadonlySet<string>;
  ignored: (path: string) => boolean;
}

/** Imported files of every changed file in the chunk, each path once. */
async function gatherImports(chunk: FileEntry[], opts: GatherOptions): Promise<ImportedFile[]> {
  const withContent = chunk.filter((f) => f.content !== undefined);
  const lists = await Promise.all(
    withContent.map((f) =>
      resolveImports(f.path, f.content ?? '', opts.read, {
        exclude: opts.changed,
        ignored: opts.ignored,
      }),
    ),
  );
  return lists.flat().filter((i, n, all) => all.findIndex((j) => j.path === i.path) === n);
}

/** Imported files and Caller snippets for one chunk of changed files. */
export async function gatherExtras(chunk: FileEntry[], opts: GatherOptions): Promise<Extras> {
  const imports = await gatherImports(chunk, opts);
  const callers: CallerSnippet[] = opts.root
    ? await findCallers(opts.root, symbolsOf(chunk), {
        exclude: opts.changed,
        ignored: opts.ignored,
      })
    : [];
  return { imports, callers };
}
