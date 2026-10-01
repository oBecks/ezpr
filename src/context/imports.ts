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

/** Alternatives, in preference order, for one import; the first that exists is its target. */
type Candidates = string[];
type Extractor = (file: string, content: string) => Candidates[];

const specifiers = (re: RegExp, content: string): string[] =>
  [...content.matchAll(re)].map((m) => m[1] ?? '');

function jsAlternatives(base: string): string[] {
  const ext = posix.extname(base);
  if (JS_EXTS.includes(ext)) {
    // ESM style: './x.js' written in TypeScript source means './x.ts'.
    const stem = base.slice(0, -ext.length);
    return [base, ...JS_EXTS.map((e) => stem + e)];
  }
  return [...JS_EXTS.map((e) => base + e), ...JS_EXTS.map((e) => `${base}/index${e}`)];
}

const pyAlternatives = (base: string): string[] => [`${base}.py`, `${base}/__init__.py`];

const jsImports: Extractor = (file, content) => {
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}(?:\/[^'"]*)?)['"]/g;
  return specifiers(re, content).map((spec) =>
    jsAlternatives(posix.join(posix.dirname(file), spec)),
  );
};

/** `import a.b` and `from a.b import c`: relative to the repo root, the file, or `src/`. */
const pyAbsolute = (file: string, mod: string): Candidates =>
  [mod, posix.join(posix.dirname(file), mod), `src/${mod}`].flatMap(pyAlternatives);

/** `from .x import y` and `from . import y, z`. */
function pyRelative(file: string, dots: string, mod: string, names: string): Candidates[] {
  let base = posix.dirname(file);
  for (let i = 1; i < dots.length; i++) base = posix.dirname(base);
  if (mod) return [pyAlternatives(posix.join(base, mod))];
  const listed = names.split(',').map((n) => n.trim().split(/\s+/)[0] ?? '');
  return listed.filter(Boolean).map((n) => pyAlternatives(posix.join(base, n)));
}

const pyFrom: Extractor = (file, content) => {
  const re = /^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+([\w, ]+)/gm;
  return [...content.matchAll(re)].flatMap((m) => {
    const [dots = '', rawMod = '', names = ''] = [m[1], m[2], m[3]];
    const mod = rawMod.replace(/\./g, '/');
    if (dots) return pyRelative(file, dots, mod, names);
    return mod ? [pyAbsolute(file, mod)] : [];
  });
};

const pyPlain: Extractor = (file, content) =>
  specifiers(/^[ \t]*import[ \t]+([\w., ]+)/gm, content)
    .flatMap((list) => list.split(','))
    .map((n) => (n.trim().split(/\s+/)[0] ?? '').replace(/\./g, '/'))
    .filter(Boolean)
    .map((mod) => pyAbsolute(file, mod));

const pyImports: Extractor = (file, content) => [
  ...pyFrom(file, content),
  ...pyPlain(file, content),
];

const cImports: Extractor = (file, content) =>
  specifiers(/^[ \t]*#[ \t]*include[ \t]+"([^"]+)"/gm, content).map((spec) => [
    posix.join(posix.dirname(file), spec),
    spec,
    `include/${spec}`,
  ]);

/** Other languages: any quoted relative path on an import-like line. */
const otherImports: Extractor = (file, content) => {
  const re = /\b(?:import|require|include|use|from|source)\b[^\n'"]*['"](\.{1,2}\/[^'"]+)['"]/g;
  return specifiers(re, content).map((spec) => {
    const target = posix.join(posix.dirname(file), spec);
    return [target, target + posix.extname(file)];
  });
};

function extractorFor(file: string): Extractor {
  const ext = posix.extname(file).toLowerCase();
  if (JS_EXTS.includes(ext)) return jsImports;
  if (ext === '.py') return pyImports;
  if (C_EXTS.includes(ext)) return cImports;
  return otherImports;
}

/**
 * Repo-relative paths each import of `file` may refer to. Only repo-local candidates are
 * produced: packages and the standard library never resolve.
 */
export function importCandidates(file: string, content: string): Candidates[] {
  return extractorFor(file)(file, content);
}

export interface ResolveOptions {
  /** Paths already in the review (changed files); never sent twice. */
  exclude: ReadonlySet<string>;
  ignored: (path: string) => boolean;
}

/** A normalised in-repo path, or null for anything that points outside or at the file itself. */
function localPath(raw: string, file: string): string | null {
  const p = posix.normalize(raw);
  return p.startsWith('..') || posix.isAbsolute(p) || p === file ? null : p;
}

const mayRead = (p: string, opts: ResolveOptions): boolean =>
  skipReason(p) === null && !opts.ignored(p);

/** The first alternative that exists and may be sent, or null. */
async function resolveOne(
  file: string,
  alternatives: Candidates,
  read: (path: string) => Promise<string | null>,
  opts: ResolveOptions,
): Promise<ImportedFile | null> {
  for (const raw of alternatives) {
    const p = localPath(raw, file);
    if (p === null) continue;
    if (opts.exclude.has(p)) return null;
    if (!mayRead(p, opts)) continue;
    const text = await read(p);
    if (text === null) continue;
    return text.length <= MAX_IMPORT_CHARS
      ? { path: p, importedBy: file, content: redact(text) }
      : null;
  }
  return null;
}

/** Reads the repo-local files that `file` imports (one hop, whole file, redacted). */
export async function resolveImports(
  file: string,
  content: string,
  read: (path: string) => Promise<string | null>,
  opts: ResolveOptions,
): Promise<ImportedFile[]> {
  const found: ImportedFile[] = [];
  for (const alternatives of importCandidates(file, content)) {
    if (found.length >= MAX_IMPORTS_PER_FILE) break;
    const hit = await resolveOne(file, alternatives, read, opts);
    if (hit) found.push(hit);
  }
  return found;
}
