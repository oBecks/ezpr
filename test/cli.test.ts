import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runInit, simpleDiff, type InitIo } from '../src/cli/init';
import { FREE_TIER_WARNING, MENU_PROVIDERS } from '../src/cli/providers';
import { renderWorkflow, WORKFLOW_PATH } from '../src/cli/workflow';

interface Fake {
  io: InitIo;
  logs: string[];
  files: Map<string, string>;
  secrets: { name: string; value: string; repo?: string }[];
  opened: string[];
  asked: string[];
}

function fake(opts: {
  answers?: string[];
  key?: string;
  gh?: boolean;
  files?: Record<string, string>;
  setOk?: boolean;
}): Fake {
  const logs: string[] = [];
  const files = new Map(Object.entries(opts.files ?? {}));
  const secrets: Fake['secrets'] = [];
  const opened: string[] = [];
  const asked: string[] = [];
  const answers = [...(opts.answers ?? [])];
  const io: InitIo = {
    log: (m) => void logs.push(m),
    ask: async (q) => {
      asked.push(q);
      return answers.shift() ?? '';
    },
    askSecret: async () => opts.key ?? '',
    readFile: (f) => files.get(f.replaceAll('\\', '/')) ?? null,
    writeFile: (f, c) => void files.set(f.replaceAll('\\', '/'), c),
    openUrl: (u) => void opened.push(u),
    ghAvailable: () => opts.gh ?? true,
    setSecret: (name, value, repo) => {
      secrets.push({ name, value, repo });
      return opts.setOk === false ? { ok: false, error: 'not logged in' } : { ok: true };
    },
  };
  return { io, logs, files, secrets, opened, asked };
}

const base = { cwd: 'proj', force: false, noOpen: false };
const FILE = `proj/${WORKFLOW_PATH}`;

describe('renderWorkflow', () => {
  it('pins the release and lists every provider secret', () => {
    const w = renderWorkflow('v1');
    expect(w).toContain('uses: oBecks/ezpr@v1');
    for (const p of MENU_PROVIDERS) expect(w).toContain(`${p.secret}: \${{ secrets.${p.secret} }}`);
    expect(renderWorkflow('v2')).toContain('oBecks/ezpr@v2');
  });

  it('listens for commands and keeps them out of the push concurrency group', () => {
    const w = renderWorkflow();
    expect(w).toContain('issue_comment:');
    expect(w).toContain('pull_request_review_comment:');
    expect(w).toContain("format('ezpr-cmd-{0}', github.event.comment.id)");
    expect(w).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it('is exactly the workflow the README shows', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain(renderWorkflow());
  });
});

describe('provider menu', () => {
  it('starts with Gemini and offers the five named providers only', () => {
    expect(MENU_PROVIDERS.map((p) => p.id)).toEqual([
      'gemini',
      'openrouter',
      'groq',
      'mistral',
      'anthropic',
      'openai',
    ]);
  });

  it('marks the free tiers, which are the ones that get the warning', () => {
    const free = MENU_PROVIDERS.filter((p) => p.free).map((p) => p.id);
    expect(free).toEqual(['gemini', 'openrouter', 'groq', 'mistral']);
  });
});

describe('simpleDiff', () => {
  it('marks removed and added lines', () => {
    expect(simpleDiff('a\nb\nc', 'a\nx\nc')).toBe('- b\n+ x');
    expect(simpleDiff('a', 'a')).toBe('');
  });
});

describe('runInit', () => {
  it('writes the workflow, opens the key page and saves the secret from stdin', async () => {
    const f = fake({ answers: ['', ''], key: 'sekret-key' });
    const code = await runInit({ ...base, repo: 'o/r' }, f.io);
    expect(code).toBe(0);
    expect(f.files.get(FILE)).toBe(renderWorkflow());
    expect(f.opened).toEqual(['https://aistudio.google.com/apikey']);
    expect(f.secrets).toEqual([{ name: 'GEMINI_API_KEY', value: 'sekret-key', repo: 'o/r' }]);
  });

  it('never prints the key', async () => {
    const f = fake({ answers: ['', ''], key: 'sekret-key', setOk: false });
    await runInit(base, f.io);
    expect(f.logs.join('\n')).not.toContain('sekret-key');
  });

  it('warns before the key step for a free provider, and stops on no', async () => {
    const f = fake({ answers: ['1', 'n'], key: 'k' });
    expect(await runInit(base, f.io)).toBe(1);
    expect(f.logs.join('\n')).toContain(FREE_TIER_WARNING);
    expect(f.files.size).toBe(0);
    expect(f.secrets).toEqual([]);
    expect(f.opened).toEqual([]);
  });

  it('does not warn for a paid provider', async () => {
    const f = fake({ answers: ['5'], key: 'k' });
    expect(await runInit(base, f.io)).toBe(0);
    expect(f.logs.join('\n')).not.toContain(FREE_TIER_WARNING);
    expect(f.secrets[0]?.name).toBe('ANTHROPIC_API_KEY');
  });

  it('re-asks on a bad choice and gives up after three', async () => {
    const f = fake({ answers: ['9', 'x', '0'] });
    expect(await runInit(base, f.io)).toBe(1);
    expect(f.files.size).toBe(0);
  });

  it('refuses to overwrite a different workflow without --force, showing a diff', async () => {
    const f = fake({ files: { [FILE]: 'name: mine\n' } });
    expect(await runInit(base, f.io)).toBe(1);
    expect(f.files.get(FILE)).toBe('name: mine\n');
    expect(f.logs.join('\n')).toContain('- name: mine');
    expect(f.asked).toEqual([]);
  });

  it('overwrites with --force', async () => {
    const f = fake({ files: { [FILE]: 'name: mine\n' }, answers: ['', ''], key: 'k' });
    expect(await runInit({ ...base, force: true }, f.io)).toBe(0);
    expect(f.files.get(FILE)).toBe(renderWorkflow());
  });

  it('leaves an up-to-date workflow alone', async () => {
    const f = fake({ files: { [FILE]: renderWorkflow() }, answers: ['', ''], key: 'k' });
    expect(await runInit(base, f.io)).toBe(0);
    expect(f.logs.join('\n')).toContain('already up to date');
  });

  it('falls back to manual steps without gh, but still writes the workflow', async () => {
    const f = fake({ answers: ['', ''], gh: false });
    expect(await runInit(base, f.io)).toBe(0);
    expect(f.files.get(FILE)).toBe(renderWorkflow());
    expect(f.secrets).toEqual([]);
    expect(f.logs.join('\n')).toContain('GEMINI_API_KEY');
  });

  it('saves no secret when the key is skipped', async () => {
    const f = fake({ answers: ['', ''], key: '  ' });
    expect(await runInit(base, f.io)).toBe(0);
    expect(f.secrets).toEqual([]);
  });

  it('reports a failed secret save and exits non-zero', async () => {
    const f = fake({ answers: ['', ''], key: 'k', setOk: false });
    expect(await runInit(base, f.io)).toBe(1);
    expect(f.logs.join('\n')).toContain('not logged in');
  });

  it('does not open a browser with --no-open', async () => {
    const f = fake({ answers: ['', ''], key: 'k' });
    await runInit({ ...base, noOpen: true }, f.io);
    expect(f.opened).toEqual([]);
  });
});

describe('Mistral in init', () => {
  it('adds its own warning on top of the free-tier one', async () => {
    const f = fake({ answers: ['4', ''], key: 'k' });
    expect(await runInit(base, f.io)).toBe(0);
    expect(f.logs.join('\n')).toContain('opt in to your data being used for training');
    expect(f.secrets[0]?.name).toBe('MISTRAL_API_KEY');
  });
});
