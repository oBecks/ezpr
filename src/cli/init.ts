import * as path from 'node:path';
import { FREE_TIER_WARNING, MENU_PROVIDERS, type MenuProvider } from './providers';
import { renderWorkflow, WORKFLOW_PATH } from './workflow';

/** Everything `init` touches outside itself, so tests can run it without a terminal or `gh`. */
export interface InitIo {
  log(message: string): void;
  ask(question: string): Promise<string>;
  /** Reads a secret without echoing it. */
  askSecret(question: string): Promise<string>;
  readFile(file: string): string | null;
  writeFile(file: string, content: string): void;
  openUrl(url: string): void;
  ghAvailable(): boolean;
  /** Pipes `value` to `gh secret set`; the value never appears in a command line. */
  setSecret(name: string, value: string, repo?: string): { ok: boolean; error?: string };
}

export interface InitOptions {
  cwd: string;
  force: boolean;
  noOpen: boolean;
  repo?: string;
  ref?: string;
}

/** Longest-common-subsequence lengths of the suffixes of `x` and `y`. */
function suffixLcs(x: string[], y: string[]): number[][] {
  const lcs = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  return lcs;
}

/** Lines only in `a` as `- `, lines only in `b` as `+ `, in order. Enough to eyeball a workflow. */
export function simpleDiff(a: string, b: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  const lcs = suffixLcs(x, y);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(`- ${x[i++]}`);
    } else {
      out.push(`+ ${y[j++]}`);
    }
  }
  out.push(...x.slice(i).map((line) => `- ${line}`), ...y.slice(j).map((line) => `+ ${line}`));
  return out.join('\n');
}

/** An empty answer picks the first provider; anything but a listed number is no choice. */
function parseChoice(answer: string): MenuProvider | undefined {
  const text = answer.trim() || '1';
  return /^\d+$/.test(text) ? MENU_PROVIDERS[Number(text) - 1] : undefined;
}

async function chooseProvider(io: InitIo): Promise<MenuProvider | null> {
  io.log('Which model provider do you want to use?');
  MENU_PROVIDERS.forEach((p, n) => io.log(`  ${n + 1}) ${p.label}`));
  for (let tries = 0; tries < 3; tries++) {
    const chosen = parseChoice(await io.ask(`Provider [1-${MENU_PROVIDERS.length}, default 1]: `));
    if (chosen) return chosen;
    io.log('Please enter one of the numbers above.');
  }
  return null;
}

const isYes = (answer: string) => answer.trim() === '' || /^y(es)?$/i.test(answer.trim());

/** Manual steps for when `gh` is missing or the secret could not be saved. */
function manualSteps(io: InitIo, p: MenuProvider): void {
  io.log('');
  io.log('Add your key by hand: repository Settings > Secrets and variables > Actions >');
  io.log(`New repository secret, named ${p.secret}.`);
}

/** Saves the key as a repository secret, or says how to do it by hand. Returns the exit code. */
function saveKey(
  io: InitIo,
  provider: MenuProvider,
  key: string | null,
  repo: string | undefined,
): number {
  if (key === null) {
    io.log('The GitHub CLI (gh) was not found, so I cannot save the secret for you.');
  } else if (key === '') {
    io.log('No key entered, so no secret was saved.');
  } else {
    const saved = io.setSecret(provider.secret, key, repo);
    if (saved.ok) {
      io.log(`Saved the repository secret ${provider.secret}.`);
      return 0;
    }
    io.log(`Could not save the secret: ${saved.error ?? 'gh failed'}`);
    manualSteps(io, provider);
    return 1;
  }
  manualSteps(io, provider);
  return 0;
}

/** Whether the user accepts the free-tier data-use warning; paid providers need no warning. */
async function acceptsDataUse(io: InitIo, provider: MenuProvider): Promise<boolean> {
  if (!provider.free) return true;
  io.log('');
  io.log(FREE_TIER_WARNING);
  return isYes(await io.ask('Continue? [Y/n] '));
}

/** `init`: writes the workflow and stores the provider key as a repository secret. Returns the exit code. */
export async function runInit(opts: InitOptions, io: InitIo): Promise<number> {
  const file = path.join(opts.cwd, WORKFLOW_PATH);
  const workflow = renderWorkflow(opts.ref);
  const existing = io.readFile(file);
  if (existing !== null && existing !== workflow && !opts.force) {
    io.log(`${WORKFLOW_PATH} already exists and differs from what EzPR would write:`);
    io.log('');
    io.log(simpleDiff(existing, workflow));
    io.log('');
    io.log('Nothing was changed. Run again with --force to overwrite it.');
    return 1;
  }

  const provider = await chooseProvider(io);
  if (!provider || !(await acceptsDataUse(io, provider))) {
    io.log('Nothing was changed.');
    return 1;
  }

  io.log('');
  io.log(`Create a key at ${provider.url}`);
  if (!opts.noOpen) io.openUrl(provider.url);

  // null = no gh, so there is nobody to hand the key to; '' = the user skipped it.
  const key = io.ghAvailable()
    ? (await io.askSecret('Paste the key (input is hidden, Enter to skip): ')).trim()
    : null;

  if (existing === workflow) {
    io.log(`${WORKFLOW_PATH} is already up to date.`);
  } else {
    io.writeFile(file, workflow);
    io.log(`Wrote ${WORKFLOW_PATH}.`);
  }
  const code = saveKey(io, provider, key, opts.repo);

  io.log('');
  io.log('Next: commit and push the workflow, then open a pull request.');
  io.log(
    `Add more providers any time by adding their secrets (${MENU_PROVIDERS.map((p) => p.secret).join(', ')}).`,
  );
  return code;
}
