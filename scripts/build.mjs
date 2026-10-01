import { build } from 'esbuild';

// The Action, committed to dist/ because GitHub runs it straight from the repo.
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/index.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  legalComments: 'none',
});

// The CLI (`npx @obecks/ezpr`), built on publish only; see "prepublishOnly".
await build({
  entryPoints: ['src/cli/main.ts'],
  outfile: 'cli/ezpr.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
});
