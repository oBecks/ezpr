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

const KNOWN_KEYS = ['brains', 'strictness', 'ignore'];
const PROVIDER_IDS: ProviderId[] = [...PROVIDER_ORDER.map((p) => p.id), 'custom'];

const strictnessSchema = z.enum(STRICTNESS_LEVELS);
const brainsSchema = z
  .array(
    z.custom<ProviderId>((v) => typeof v === 'string' && PROVIDER_IDS.includes(v as ProviderId)),
  )
  .min(1);
const ignoreSchema = z.array(z.string());

const empty = (problems: string[] = []): SettingsSource => ({ ignore: [], problems });

/** Parses `.ezpr.yml`. A bad key is skipped and named; the other keys still apply. */
export function parseConfigFile(text: string | null): SettingsSource {
  if (text === null || !text.trim()) return empty();
  if (text.length > MAX_CONFIG_CHARS) {
    return empty([
      `\`${CONFIG_PATH}\` is larger than ${MAX_CONFIG_CHARS} characters and was ignored.`,
    ]);
  }
  let data: unknown;
  try {
    data = parse(text);
  } catch (err) {
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    return empty([`\`${CONFIG_PATH}\` is not valid YAML (${first}); defaults were used.`]);
  }
  if (data === null || data === undefined) return empty();
  if (typeof data !== 'object' || Array.isArray(data)) {
    return empty([`\`${CONFIG_PATH}\` must be a mapping of keys; defaults were used.`]);
  }
  const obj = data as Record<string, unknown>;
  const out = empty();
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.includes(key)) out.problems.push(`Unknown key \`${key}\` was ignored.`);
  }
  if ('strictness' in obj) {
    const r = strictnessSchema.safeParse(obj.strictness);
    if (r.success) out.strictness = r.data;
    else out.problems.push(`\`strictness\` must be one of ${STRICTNESS_LEVELS.join(', ')}.`);
  }
  if ('brains' in obj) {
    const r = brainsSchema.safeParse(obj.brains);
    if (r.success) out.brains = [...new Set(r.data)];
    else out.problems.push(`\`brains\` must be a list of: ${PROVIDER_IDS.join(', ')}.`);
  }
  if ('ignore' in obj) {
    const r = ignoreSchema.safeParse(obj.ignore);
    if (r.success) out.ignore = r.data.map((g) => g.trim()).filter(Boolean);
    else out.problems.push('`ignore` must be a list of path globs.');
  }
  return out;
}

/** Reads the Action's own inputs the same way (`brains` is newline- or comma-separated). */
export function parseInputs(raw: {
  ignore: string;
  strictness: string;
  brains: string;
}): SettingsSource {
  const out = empty();
  out.ignore = parseIgnore(raw.ignore);
  const strictness = raw.strictness.trim();
  if (strictness) {
    const r = strictnessSchema.safeParse(strictness);
    if (r.success) out.strictness = r.data;
    else {
      out.problems.push(
        `Action input \`strictness\` must be one of ${STRICTNESS_LEVELS.join(', ')}.`,
      );
    }
  }
  const ids = raw.brains
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length) {
    const r = brainsSchema.safeParse(ids);
    if (r.success) out.brains = [...new Set(r.data)];
    else out.problems.push(`Action input \`brains\` must list only: ${PROVIDER_IDS.join(', ')}.`);
  }
  return out;
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
