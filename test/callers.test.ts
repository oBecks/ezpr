import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findCallers } from '../src/context/callers';

let root: string;
const put = (rel: string, text: string) => {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
};
const opts = { exclude: new Set<string>(), ignored: () => false };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ezpr-callers-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('findCallers', () => {
  it('finds whole-word uses with numbered context', async () => {
    put('src/use.ts', 'a\nb\nconst r = computeTotal(1);\nc\nconst notcomputeTotals = 1;');
    const hits = await findCallers(root, ['computeTotal'], opts);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: 'src/use.ts', line: 3, symbol: 'computeTotal' });
    expect(hits[0]?.snippet).toContain('3: const r = computeTotal(1);');
  });

  it('skips changed files, noise directories, secret files and the ignore list', async () => {
    put('src/changed.ts', 'computeTotal()');
    put('node_modules/x/index.js', 'computeTotal()');
    put('.env', 'computeTotal=1');
    put('gen/a.ts', 'computeTotal()');
    put('src/ok.ts', 'computeTotal()');
    const hits = await findCallers(root, ['computeTotal'], {
      exclude: new Set(['src/changed.ts']),
      ignored: (p) => p.startsWith('gen'),
    });
    expect(hits.map((h) => h.path)).toEqual(['src/ok.ts']);
  });

  it('caps hits per symbol and merges nearby hits', async () => {
    put('a.ts', Array.from({ length: 40 }, () => 'computeTotal()').join('\n'));
    const capped = await findCallers(root, ['computeTotal'], {
      ...opts,
      maxPerSymbol: 2,
      context: 1,
    });
    expect(capped).toHaveLength(2);
    const nearby = await findCallers(root, ['computeTotal'], { ...opts, context: 100 });
    expect(nearby).toHaveLength(1);
  });

  it('redacts secrets in snippets', async () => {
    put('a.ts', `computeTotal("ghp_${'a'.repeat(36)}")`);
    const hits = await findCallers(root, ['computeTotal'], opts);
    expect(hits[0]?.snippet).toContain('[REDACTED]');
  });

  it('does not follow symlinks out of the checkout', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'ezpr-outside-'));
    try {
      writeFileSync(join(outside, 'leak.ts'), 'computeTotal()');
      try {
        symlinkSync(outside, join(root, 'link'), 'junction');
        symlinkSync(join(outside, 'leak.ts'), join(root, 'leak.ts'), 'file');
      } catch {
        return; // cannot create symlinks on this machine
      }
      expect(await findCallers(root, ['computeTotal'], opts)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
