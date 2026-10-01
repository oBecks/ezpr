import { parse } from 'yaml';
import { z } from 'zod';
import { PROVIDER_ORDER, STRICTNESS_LEVELS, type ProviderId, type Strictness } from '../config';
import { parseIgnore } from './ignore';

/** The file is small by nature; a huge one is a mistake or an attack, not a config. */
export const MAX_CONFIG_CHARS = 20_000;

export const CONFIG_PATH = '.ezpr.yml';

export interface Settings {
  /** Providers to use, in order; every provider with a key when unset. */
  brains?: ProviderId[];
  strictness: Strictness;
  ignore: string[];
  /** What was wrong with the Config file or the Action inputs; reported in the Summary. */
  problems: string[];
}

/** Settings from one source: only what that source set, plus what was wrong with it. */
export interface SettingsSource {
  brains?: ProviderId[];
  strictness?: Strictness;
  ignore: string[];
  problems: string[];
}

const PROVIDER_IDS: ProviderId[] = [...PROVIDER_ORDER.map((p) => p.id), 'custom'];

const strictnessSchema = z.enum(STRICTNESS_LEVELS);
const brainsSchema = z
  .array(
    z.custom<ProviderId>((v) => typeof v === 'string' && PROVIDER_IDS.includes(v as ProviderId)),
  )
  .min(1);
const ignoreSchema = z.array(z.string());

const empty = (problems: string[] = []): SettingsSource => ({ ignore: [], problems });

/** Reads one key into `out`; a bad value is skipped and named in `out.problems`. */
type KeyReader = (value: unknown, out: SettingsSource, where: string) => void;

const readStrictness: KeyReader = (value, out, where) => {
  const r = strictnessSchema.safeParse(value);
  if (r.success) out.strictness = r.data;
  else out.problems.push(`${where}\`strictness\` must be one of ${STRICTNESS_LEVELS.join(', ')}.`);
};

const readBrains: KeyReader = (value, out, where) => {
  const r = brainsSchema.safeParse(value);
  if (r.success) out.brains = [...new Set(r.data)];
  else out.problems.push(`${where}\`brains\` must be a list of: ${PROVIDER_IDS.join(', ')}.`);
};

const readIgnore: KeyReader = (value, out, where) => {
  const r = ignoreSchema.safeParse(value);
  if (r.success) out.ignore = r.data.map((g) => g.trim()).filter(Boolean);
  else out.problems.push(`${where}\`ignore\` must be a list of path globs.`);
};

const READERS: Record<string, KeyReader> = {
  brains: readBrains,
  strictness: readStrictness,
  ignore: readIgnore,
};

/** Reads every known key present in `values`; unknown keys are named when `warnUnknown`. */
function readKeys(
  values: Record<string, unknown>,
  where: string,
  warnUnknown: boolean,
): SettingsSource {
  const out = empty();
  for (const [key, value] of Object.entries(values)) {
    const read = READERS[key];
    if (read) read(value, out, where);
    else if (warnUnknown) out.problems.push(`Unknown key \`${key}\` was ignored.`);
  }
  return out;
}

/** The YAML text as a mapping, or what is wrong with it. */
function parseMapping(text: string): { data?: Record<string, unknown>; problem?: string } {
  if (text.length > MAX_CONFIG_CHARS) {
    return {
      problem: `\`${CONFIG_PATH}\` is larger than ${MAX_CONFIG_CHARS} characters and was ignored.`,
    };
  }
  let data: unknown;
  try {
    data = parse(text);
  } catch (err) {
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    return { problem: `\`${CONFIG_PATH}\` is not valid YAML (${first}); defaults were used.` };
  }
  if (data === null || data === undefined) return {};
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { problem: `\`${CONFIG_PATH}\` must be a mapping of keys; defaults were used.` };
  }
  return { data: data as Record<string, unknown> };
}

/** Parses `.ezpr.yml`. A bad key is skipped and named; the other keys still apply. */
export function parseConfigFile(text: string | null): SettingsSource {
  if (text === null || !text.trim()) return empty();
  const { data, problem } = parseMapping(text);
  if (problem) return empty([problem]);
  return data ? readKeys(data, '', true) : empty();
}

/** Reads the Action's own inputs the same way (`brains` is newline- or comma-separated). */
export function parseInputs(raw: {
  ignore: string;
  strictness: string;
  brains: string;
}): SettingsSource {
  const brains = raw.brains.split(/[\s,]+/).filter(Boolean);
  const set: Record<string, unknown> = { ignore: parseIgnore(raw.ignore) };
  if (raw.strictness.trim()) set.strictness = raw.strictness.trim();
  if (brains.length) set.brains = brains;
  return readKeys(set, 'Action input ', false);
}

/** The Ignore list is the union; for the rest, the Action input wins over the Config file. */
export function mergeSettings(file: SettingsSource, input: SettingsSource): Settings {
  return {
    brains: input.brains ?? file.brains,
    strictness: input.strictness ?? file.strictness ?? 'balanced',
    ignore: [...new Set([...file.ignore, ...input.ignore])],
    problems: [...file.problems, ...input.problems],
  };
}
