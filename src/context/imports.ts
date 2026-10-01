import * as nodePath from 'node:path';
import { skipReason } from './filter';
import { redact } from './redact';

const posix = nodePath.posix;

export interface ImportedFile {
  path: string;
  importedBy: string;
  content: string;
}

/** A changed file whose imports we want. */
export interface SourceFile {
  path: string;
  content: string;
}

/** Larger imported files are skipped rather than truncated. */
const MAX_IMPORT_CHARS = 50_000;
const MAX_IMPORTS_PER_FILE = 10;

const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const C_EXTS = ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'];

/** Alternatives, in preference order, for one import; the first that exists is its target. */
type Candidates = string[];
type Extractor = (src: SourceFile) => Candidates[];

const dirOf = (src: SourceFile): string => posix.dirname(src.path);

const specifiers = (re: RegExp, content: string): string[] =>
  [...content.matchAll(re)].map((m) => m[1] ?? '');

function jsAlternatives(base: string): Candidates {
  const ext = posix.extname(base);
  if (JS_EXTS.includes(ext)) {
    // ESM style: './x.js' written in TypeScript source means './x.ts'.
    const stem = base.slice(0, -ext.length);
    return [base, ...JS_EXTS.map((e) => stem + e)];
  }
  return [...JS_EXTS.map((e) => base + e), ...JS_EXTS.map((e) => `${base}/index${e}`)];
}

const pyAlternatives = (base: string): Candidates => [`${base}.py`, `${base}/__init__.py`];

const jsImports: Extractor = (src) => {
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}(?:\/[^'"]*)?)['"]/g;
  return specifiers(re, src.content).map((spec) => jsAlternatives(posix.join(dirOf(src), spec)));
};

/** `import a.b` and `from a.b import c`: relative to the repo root, the file, or `src/`. */
const pyAbsolute = (src: SourceFile, mod: string): Candidates =>
  [mod, posix.join(dirOf(src), mod), `src/${mod}`].flatMap(pyAlternatives);

interface PyFrom {
  /** Leading dots of a relative import. */
  dots: string;
  /** Dotted module path turned into slashes; empty for `from . import x`. */
  mod: string;
  /** Names after `import`, comma separated. */
  names: string;
}

/** `from .x import y` and `from . import y, z`. */
function pyRelative(src: SourceFile, from: PyFrom): Candidates[] {
  let base = dirOf(src);
  for (let i = 1; i < from.dots.length; i++) base = posix.dirname(base);
  if (from.mod) return [pyAlternatives(posix.join(base, from.mod))];
  const listed = from.names.split(',').map((n) => n.trim().split(/\s+/)[0] ?? '');
  return listed.filter(Boolean).map((n) => pyAlternatives(posix.join(base, n)));
}

const pyFrom: Extractor = (src) => {
  const re = /^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+([\w, ]+)/gm;
  return [...src.content.matchAll(re)].flatMap((m) => {
    const from: PyFrom = {
      dots: m[1] ?? '',
      mod: (m[2] ?? '').replace(/\./g, '/'),
      names: m[3] ?? '',
    };
    if (from.dots) return pyRelative(src, from);
    return from.mod ? [pyAbsolute(src, from.mod)] : [];
  });
};

const pyPlain: Extractor = (src) =>
  specifiers(/^[ \t]*import[ \t]+([\w., ]+)/gm, src.content)
    .flatMap((list) => list.split(','))
    .map((n) => (n.trim().split(/\s+/)[0] ?? '').replace(/\./g, '/'))
    .filter(Boolean)
    .map((mod) => pyAbsolute(src, mod));

const pyImports: Extractor = (src) => [...pyFrom(src), ...pyPlain(src)];

const cImports: Extractor = (src) =>
  specifiers(/^[ \t]*#[ \t]*include[ \t]+"([^"]+)"/gm, src.content).map((spec) => [
    posix.join(dirOf(src), spec),
    spec,
    `include/${spec}`,
  ]);

/** Other languages: any quoted relative path on an import-like line. */
const otherImports: Extractor = (src) => {
  const re = /\b(?:import|require|include|use|from|source)\b[^\n'"]*['"](\.{1,2}\/[^'"]+)['"]/g;
  return specifiers(re, src.content).map((spec) => {
    const target = posix.join(dirOf(src), spec);
    return [target, target + posix.extname(src.path)];
  });
};

function extractorFor(path: string): Extractor {
  const ext = posix.extname(path).toLowerCase();
  if (JS_EXTS.includes(ext)) return jsImports;
  if (ext === '.py') return pyImports;
  if (C_EXTS.includes(ext)) return cImports;
  return otherImports;
}

/**
 * Repo-relative paths each import of `src` may refer to. Only repo-local candidates are
 * produced: packages and the standard library never resolve.
 */
export function importCandidates(src: SourceFile): Candidates[] {
  return extractorFor(src.path)(src);
}

export interface ResolveOptions {
  /** Paths already in the review (changed files); never sent twice. */
  exclude: ReadonlySet<string>;
  ignored: (path: string) => boolean;
}

type Reader = (path: string) => Promise<string | null>;

/** A normalised in-repo path, or null for anything that points outside the repo. */
function localPath(raw: string): string | null {
  const p = posix.normalize(raw);
  return p.startsWith('..') || posix.isAbsolute(p) ? null : p;
}

const mayRead = (p: string, opts: ResolveOptions): boolean =>
  skipReason(p) === null && !opts.ignored(p);

/** The first alternative that exists and may be sent, or null. */
async function resolveOne(
  src: SourceFile,
  alternatives: Candidates,
  read: Reader,
  opts: ResolveOptions,
): Promise<ImportedFile | null> {
  for (const raw of alternatives) {
    const p = localPath(raw);
    if (p === null || p === src.path) continue;
    if (opts.exclude.has(p)) return null;
    if (!mayRead(p, opts)) continue;
    const text = await read(p);
    if (text === null) continue;
    return text.length <= MAX_IMPORT_CHARS
      ? { path: p, importedBy: src.path, content: redact(text) }
      : null;
  }
  return null;
}

/** Reads the repo-local files that `src` imports (one hop, whole file, redacted). */
export async function resolveImports(
  src: SourceFile,
  read: Reader,
  opts: ResolveOptions,
): Promise<ImportedFile[]> {
  const found: ImportedFile[] = [];
  for (const alternatives of importCandidates(src)) {
    if (found.length >= MAX_IMPORTS_PER_FILE) break;
    const hit = await resolveOne(src, alternatives, read, opts);
    if (hit) found.push(hit);
  }
  return found;
}
