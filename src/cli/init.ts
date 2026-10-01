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

/** Lines only in `a` as `- `, lines only in `b` as `+ `, in order. Enough to eyeball a workflow. */
export function simpleDiff(a: string, b: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  const lcs: number[][] = Array.from({ length: x.length + 1 }, () =>
    new Array<number>(y.length + 1).fill(0),
  );
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push(`- ${x[i++]}`);
    else out.push(`+ ${y[j++]}`);
  }
  while (i < x.length) out.push(`- ${x[i++]}`);
  while (j < y.length) out.push(`+ ${y[j++]}`);
  return out.join('\n');
}

async function chooseProvider(io: InitIo): Promise<MenuProvider | null> {
  io.log('Which model provider do you want to use?');
  MENU_PROVIDERS.forEach((p, n) => io.log(`  ${n + 1}) ${p.label}`));
  for (let tries = 0; tries < 3; tries++) {
    const answer = (await io.ask(`Provider [1-${MENU_PROVIDERS.length}, default 1]: `)).trim();
    const pick = answer === '' ? 1 : Number.parseInt(answer, 10);
    const chosen = MENU_PROVIDERS[pick - 1];
    if (chosen && String(pick) === (answer || '1')) return chosen;
    io.log('Please enter one of the numbers above.');
  }
  return null;
}

const isYes = (answer: string) => answer.trim() === '' || /^y(es)?$/i.test(answer.trim());

/** Manual steps for when `gh` is missing or the secret could not be saved. */
function manualSteps(io: InitIo, p: MenuProvider): void {
  io.log('');
  io.log(`Add your key by hand: repository Settings > Secrets and variables > Actions >`);
  io.log(`New repository secret, named ${p.secret}.`);
}

/** `init`: writes the workflow and stores the provider key as a repository secret. Returns the exit code. */
export async function runInit(opts: InitOptions, io: InitIo): Promise<number> {
  const file = path.join(opts.cwd, WORKFLOW_PATH);
  const workflow = renderWorkflow(opts.ref);
  const existing = io.readFile(file);
  const unchanged = existing === workflow;
  if (existing !== null && !unchanged && !opts.force) {
    io.log(`${WORKFLOW_PATH} already exists and differs from what EzPR would write:`);
    io.log('');
    io.log(simpleDiff(existing, workflow));
    io.log('');
    io.log('Nothing was changed. Run again with --force to overwrite it.');
    return 1;
  }

  const provider = await chooseProvider(io);
  if (!provider) {
    io.log('No provider chosen. Nothing was changed.');
    return 1;
  }
  if (provider.free) {
    io.log('');
    io.log(FREE_TIER_WARNING);
    if (!isYes(await io.ask('Continue? [Y/n] '))) {
      io.log('Nothing was changed.');
      return 1;
    }
  }

  io.log('');
  io.log(`Create a key at ${provider.url}`);
  if (!opts.noOpen) io.openUrl(provider.url);

  const haveGh = io.ghAvailable();
  const key = haveGh
    ? (await io.askSecret(`Paste the key (input is hidden, Enter to skip): `)).trim()
    : '';

  if (!unchanged) {
    io.writeFile(file, workflow);
    io.log(`Wrote ${WORKFLOW_PATH}.`);
  } else {
    io.log(`${WORKFLOW_PATH} is already up to date.`);
  }

  let code = 0;
  if (!haveGh) {
    io.log('The GitHub CLI (gh) was not found, so I cannot save the secret for you.');
    manualSteps(io, provider);
  } else if (key === '') {
    io.log('No key entered, so no secret was saved.');
    manualSteps(io, provider);
  } else {
    const saved = io.setSecret(provider.secret, key, opts.repo);
    if (saved.ok) io.log(`Saved the repository secret ${provider.secret}.`);
    else {
      io.log(`Could not save the secret: ${saved.error ?? 'gh failed'}`);
      manualSteps(io, provider);
      code = 1;
    }
  }

  io.log('');
  io.log('Next: commit and push the workflow, then open a pull request.');
  io.log(
    `Add more providers any time by adding their secrets (${MENU_PROVIDERS.map((p) => p.secret).join(', ')}).`,
  );
  return code;
}
