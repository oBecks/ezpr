import { describe, expect, it } from 'vitest';
import { importCandidates, resolveImports } from '../src/context/imports';

describe('importCandidates', () => {
  it('resolves relative TS/JS imports and ignores packages', () => {
    const src = `import { a } from './util';\nimport x from 'zod';\nconst b = require('../lib/b.js');`;
    const c = importCandidates('src/app/main.ts', src);
    expect(c).toHaveLength(2);
    expect(c[0]).toContain('src/app/util.ts');
    expect(c[0]).toContain('src/app/util/index.ts');
    expect(c[1]).toContain('src/lib/b.ts');
  });

  it('handles Python relative and absolute imports', () => {
    const src = `from .models import User\nfrom . import helpers\nimport pkg.sub\nimport os`;
    const flat = importCandidates('app/views.py', src).flat();
    expect(flat).toContain('app/models.py');
    expect(flat).toContain('app/helpers.py');
    expect(flat).toContain('pkg/sub.py');
  });

  it('handles quoted C includes only', () => {
    const src = `#include <stdio.h>\n#include "util.h"`;
    const c = importCandidates('src/main.c', src);
    expect(c).toHaveLength(1);
    expect(c[0]?.[0]).toBe('src/util.h');
  });

  it('falls back to relative paths on import-like lines in other languages', () => {
    const c = importCandidates('lib/a.rb', `require_relative './b'\nrequire './c'`);
    expect(c.flat()).toContain('lib/c');
  });
});

describe('resolveImports', () => {
  const files: Record<string, string> = {
    'src/util.ts': 'export const u = 1;',
    'src/changed.ts': 'export const c = 1;',
    '.env': 'KEY=1',
    'src/big.ts': 'x'.repeat(60_000),
  };
  const read = async (p: string) => files[p] ?? null;
  const none = () => false;
  const src = `import './util';\nimport './changed';\nimport './missing';\nimport '../.env';\nimport './big';`;

  it('returns existing local files, skipping changed, missing, secret and oversized ones', async () => {
    const r = await resolveImports('src/main.ts', src, read, {
      exclude: new Set(['src/changed.ts']),
      ignored: none,
    });
    expect(r.map((i) => i.path)).toEqual(['src/util.ts']);
    expect(r[0]?.importedBy).toBe('src/main.ts');
  });

  it('honours the ignore list and redacts content', async () => {
    const secret = `t = "ghp_${'a'.repeat(36)}"`;
    const r = await resolveImports(
      'src/main.ts',
      `import './s';\nimport './util';`,
      async (p) => (p === 'src/s.ts' ? secret : (files[p] ?? null)),
      { exclude: new Set(), ignored: (p) => p === 'src/util.ts' },
    );
    expect(r.map((i) => i.path)).toEqual(['src/s.ts']);
    expect(r[0]?.content).toContain('[REDACTED]');
  });

  it('never escapes the repo root', async () => {
    const r = await resolveImports('a.ts', `import '../../etc/x';`, async () => 'secret', {
      exclude: new Set(),
      ignored: none,
    });
    expect(r).toEqual([]);
  });
});
