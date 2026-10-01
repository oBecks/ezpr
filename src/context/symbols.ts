import * as nodePath from 'node:path';

/** Names too generic to search for: they would match noise everywhere. */
const COMMON = new Set([
  'init',
  'main',
  'test',
  'data',
  'name',
  'type',
  'value',
  'list',
  'from',
  'this',
  'self',
  'call',
  'item',
  'args',
  'next',
  'done',
  'null',
  'true',
  'false',
  'else',
  'with',
  'then',
  'func',
  'function',
  'class',
  'const',
  'async',
  'await',
  'return',
  'import',
  'export',
  'default',
  'catch',
  'while',
  'switch',
  'static',
  'public',
  'private',
  'void',
]);

const MIN_LENGTH = 4;
const MAX_SYMBOLS = 10;

const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const C_EXTS = ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'];

const DECLS = {
  js: [
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/,
    /\bclass\s+([A-Za-z_$][\w$]*)/,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/,
    /\b(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:(?:public|private|protected|static|async|readonly|override)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$/,
  ],
  py: [/^\s*(?:async\s+)?def\s+(\w+)/, /^\s*class\s+(\w+)/],
  c: [
    /\b(?:class|struct|enum)\s+(\w+)/,
    /^[A-Za-z_][\w:<>,*&\s]*?[\s*&](\w+)\s*\([^;]*$/,
    /#\s*define\s+(\w+)/,
  ],
  other: [/\b(?:function|def|class|func|fn|fun|struct|interface|type)\s+(\w+)/],
};

function declsFor(file: string): RegExp[] {
  const ext = nodePath.posix.extname(file).toLowerCase();
  if (JS_EXTS.includes(ext)) return DECLS.js;
  if (ext === '.py') return DECLS.py;
  if (C_EXTS.includes(ext)) return DECLS.c;
  return DECLS.other;
}

/** A line a patch adds or removes (not the `+++`/`---` file headers). */
const isChangedLine = (line: string): boolean => /^(?:\+(?!\+\+)|-(?!--))/.test(line);

const searchable = (name: string | undefined): name is string =>
  name !== undefined && name.length >= MIN_LENGTH && !COMMON.has(name);

/**
 * Names of functions, classes and similar declarations that a patch adds, changes or
 * removes. Regex based and deliberately approximate: it errs towards fewer, longer names.
 */
export function changedSymbols(file: string, patch: string): string[] {
  const res = declsFor(file);
  const names = patch
    .split('\n')
    .filter(isChangedLine)
    .flatMap((line) => res.map((re) => re.exec(line.slice(1))?.[1]));
  return [...new Set(names.filter(searchable))];
}

/** Symbols across several patches, capped so the caller search stays cheap. */
export function symbolsOf(files: { path: string; patch: string }[]): string[] {
  const all = new Set<string>();
  for (const f of files) for (const s of changedSymbols(f.path, f.patch)) all.add(s);
  return [...all].slice(0, MAX_SYMBOLS);
}
