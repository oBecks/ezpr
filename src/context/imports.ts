import * as nodePath from 'node:path';
import { skipReason } from './filter';
import { redact } from './redact';

const posix = nodePath.posix;

export interface ImportedFile {
  path: string;
  importedBy: string;
  content: string;
}

/** Larger imported files are skipped rather than truncated. */
const MAX_IMPORT_CHARS = 50_000;
const MAX_IMPORTS_PER_FILE = 10;

const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const C_EXTS = ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'];

type Lang = 'js' | 'py' | 'c' | 'other';

function langOf(file: string): Lang {
  const ext = posix.extname(file).toLowerCase();
  if (JS_EXTS.includes(ext)) return 'js';
  if (ext === '.py') return 'py';
  if (C_EXTS.includes(ext)) return 'c';
  return 'other';
}

function jsAlternatives(base: string): string[] {
  const ext = posix.extname(base);
  if (JS_EXTS.includes(ext)) {
    // ESM style: './x.js' written in TypeScript source means './x.ts'.
    const stem = base.slice(0, -ext.length);
    return [base, ...JS_EXTS.map((e) => stem + e)];
  }
  return [...JS_EXTS.map((e) => base + e), ...JS_EXTS.map((e) => `${base}/index${e}`)];
}

function pyAlternatives(base: string): string[] {
  return [`${base}.py`, `${base}/__init__.py`];
}

/**
 * Repo-relative paths each import of `file` may refer to. Each inner list is one import,
 * its alternatives in preference order; the first that exists is the import's target.
 * Only repo-local candidates are produced: packages and the standard library never resolve.
 */
export function importCandidates(file: string, content: string): string[][] {
  const dir = posix.dirname(file);
  const out: string[][] = [];
  const lang = langOf(file);

  if (lang === 'js') {
    const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}(?:\/[^'"]*)?)['"]/g;
    for (const m of content.matchAll(re)) {
      out.push(jsAlternatives(posix.join(dir, m[1] ?? '')));
    }
  } else if (lang === 'py') {
    const absolute = (mod: string) =>
      [mod, posix.join(dir, mod), `src/${mod}`].flatMap(pyAlternatives);
    for (const m of content.matchAll(
      /^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+([\w, ]+)/gm,
    )) {
      const dots = m[1] ?? '';
      const mod = (m[2] ?? '').replace(/\./g, '/');
      if (dots) {
        let base = dir;
        for (let i = 1; i < dots.length; i++) base = posix.dirname(base);
        if (mod) {
          out.push(pyAlternatives(posix.join(base, mod)));
        } else {
          for (const n of (m[3] ?? '').split(',')) {
            const name = n.trim().split(/\s+/)[0];
            if (name) out.push(pyAlternatives(posix.join(base, name)));
          }
        }
      } else if (mod) {
        out.push(absolute(mod));
      }
    }
    for (const m of content.matchAll(/^[ \t]*import[ \t]+([\w., ]+)/gm)) {
      for (const n of (m[1] ?? '').split(',')) {
        const mod = (n.trim().split(/\s+/)[0] ?? '').replace(/\./g, '/');
        if (mod) out.push(absolute(mod));
      }
    }
  } else if (lang === 'c') {
    for (const m of content.matchAll(/^[ \t]*#[ \t]*include[ \t]+"([^"]+)"/gm)) {
      const spec = m[1] ?? '';
      out.push([posix.join(dir, spec), spec, `include/${spec}`]);
    }
  } else {
    // Other languages: any quoted relative path on an import-like line.
    const ext = posix.extname(file);
    const re = /\b(?:import|require|include|use|from|source)\b[^\n'"]*['"](\.{1,2}\/[^'"]+)['"]/g;
    for (const m of content.matchAll(re)) {
      const target = posix.join(dir, m[1] ?? '');
      out.push([target, target + ext]);
    }
  }
  return out;
}

export interface ResolveOptions {
  /** Paths already in the review (changed files); never sent twice. */
  exclude: ReadonlySet<string>;
  ignored: (path: string) => boolean;
}

/** Reads the repo-local files that `file` imports (one hop, whole file, redacted). */
export async function resolveImports(
  file: string,
  content: string,
  read: (path: string) => Promise<string | null>,
  opts: ResolveOptions,
): Promise<ImportedFile[]> {
  const found: ImportedFile[] = [];
  for (const alts of importCandidates(file, content)) {
    if (found.length >= MAX_IMPORTS_PER_FILE) break;
    for (const raw of alts) {
      const p = posix.normalize(raw);
      if (p.startsWith('..') || posix.isAbsolute(p) || p === file) continue;
      if (opts.exclude.has(p)) break;
      if (skipReason(p) !== null || opts.ignored(p)) continue;
      const text = await read(p);
      if (text === null) continue;
      if (text.length <= MAX_IMPORT_CHARS) {
        found.push({ path: p, importedBy: file, content: redact(text) });
      }
      break;
    }
  }
  return found;
}
