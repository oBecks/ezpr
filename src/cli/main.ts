import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { runInit, type InitIo } from './init';

const HELP = `ezpr - set up the EzPR pull request reviewer

Usage:
  npx @obecks/ezpr init [--force] [--repo owner/name] [--no-open] [--ref v1]

init writes .github/workflows/ai-review.yml, opens the page where you create an API key,
and saves the key as a repository secret with the GitHub CLI (gh).

Options:
  --force        overwrite an existing workflow file
  --repo <slug>  repository for the secret (default: the current directory's)
  --no-open      do not open the key page in a browser
  --ref <ref>    release of the action to pin (default: v1)
`;

function systemIo(): InitIo {
  let muted = false;
  const out = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output: out, terminal: process.stdin.isTTY });

  // Lines are queued as they arrive: piped input delivers them all at once, before the next
  // question is asked. At end of input every question gets an empty answer (the default).
  const lines: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let closed = false;
  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    closed = true;
    for (const next of waiting.splice(0)) next('');
  });
  const nextLine = (): Promise<string> => {
    const line = lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (closed) return Promise.resolve('');
    return new Promise((resolve) => waiting.push(resolve));
  };

  return {
    log: (message) => console.log(message),
    ask(question) {
      rl.setPrompt(question);
      rl.prompt();
      return nextLine();
    },
    async askSecret(question) {
      process.stdout.write(question);
      muted = true;
      try {
        rl.setPrompt('');
        rl.prompt();
        return await nextLine();
      } finally {
        muted = false;
        process.stdout.write('\n');
      }
    },
    readFile(file) {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    },
    writeFile(file, content) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    },
    openUrl(url) {
      // Only URLs from the provider menu reach here, never user input.
      const [cmd, args]: [string, string[]] =
        process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
      try {
        spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
      } catch {
        // The URL is printed anyway.
      }
    },
    ghAvailable: () => spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0,
    setSecret(name, value, repo) {
      const args = ['secret', 'set', name, ...(repo ? ['--repo', repo] : [])];
      const run = spawnSync('gh', args, { input: value, encoding: 'utf8' });
      return run.status === 0
        ? { ok: true }
        : { ok: false, error: (run.stderr || run.error?.message || '').trim() };
    },
  };
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'init') {
    console.log(HELP);
    return command === undefined || command === '--help' || command === '-h' ? 0 : 1;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(HELP);
    return 0;
  }
  const io = systemIo();
  try {
    return await runInit(
      {
        cwd: process.cwd(),
        force: rest.includes('--force'),
        noOpen: rest.includes('--no-open'),
        repo: option(rest, '--repo'),
        ref: option(rest, '--ref'),
      },
      io,
    );
  } finally {
    process.stdin.pause();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
