import { describe, expect, it } from 'vitest';
import {
  MAX_CONFIG_CHARS,
  mergeSettings,
  parseConfigFile,
  parseInputs,
} from '../src/context/settings';

const noInput = parseInputs({ ignore: '', strictness: '', brains: '' });

describe('parseConfigFile', () => {
  it('treats a missing or empty file as no settings', () => {
    for (const text of [null, '', '  \n', '# only a comment']) {
      expect(parseConfigFile(text)).toEqual({ ignore: [], problems: [] });
    }
  });

  it('reads every key', () => {
    const got = parseConfigFile(
      'brains: [groq, gemini]\nstrictness: strict\nignore:\n  - dist/\n  - "**/*.snap"\n',
    );
    expect(got).toEqual({
      brains: ['groq', 'gemini'],
      strictness: 'strict',
      ignore: ['dist/', '**/*.snap'],
      problems: [],
    });
  });

  it('skips a bad key and still applies the rest', () => {
    const got = parseConfigFile('strictness: harsh\nbrains: [gemini, bing]\nignore: [docs/]\n');
    expect(got.strictness).toBeUndefined();
    expect(got.brains).toBeUndefined();
    expect(got.ignore).toEqual(['docs/']);
    expect(got.problems).toHaveLength(2);
    expect(got.problems.join(' ')).toContain('strictness');
    expect(got.problems.join(' ')).toContain('brains');
  });

  it('names unknown keys', () => {
    const got = parseConfigFile('language: he\nstrictness: chill\n');
    expect(got.strictness).toBe('chill');
    expect(got.problems).toEqual(['Unknown key `language` was ignored.']);
  });

  it('falls back to defaults on invalid YAML, a non-mapping, or a huge file', () => {
    expect(parseConfigFile('a: [unclosed').problems[0]).toContain('not valid YAML');
    expect(parseConfigFile('- a\n- b').problems[0]).toContain('must be a mapping');
    expect(parseConfigFile(`ignore: [${'a,'.repeat(MAX_CONFIG_CHARS)}]`).problems[0]).toContain(
      'larger than',
    );
  });

  it('rejects an empty brains list and non-string ignore entries', () => {
    expect(parseConfigFile('brains: []').problems).toHaveLength(1);
    expect(parseConfigFile('ignore: [1, 2]').problems).toHaveLength(1);
  });

  it('de-duplicates brains', () => {
    expect(parseConfigFile('brains: [groq, groq, gemini]').brains).toEqual(['groq', 'gemini']);
  });
});

describe('parseInputs', () => {
  it('parses comma- or newline-separated brains and ignore globs', () => {
    const got = parseInputs({
      ignore: '# c\ndist/\n',
      strictness: 'chill',
      brains: 'groq,\ngemini',
    });
    expect(got).toEqual({
      brains: ['groq', 'gemini'],
      strictness: 'chill',
      ignore: ['dist/'],
      problems: [],
    });
  });

  it('reports invalid values', () => {
    const got = parseInputs({ ignore: '', strictness: 'x', brains: 'nope' });
    expect(got.problems).toHaveLength(2);
  });
});

describe('mergeSettings', () => {
  it('defaults to balanced with every provider', () => {
    expect(mergeSettings(parseConfigFile(null), noInput)).toEqual({
      brains: undefined,
      strictness: 'balanced',
      ignore: [],
      problems: [],
    });
  });

  it('unions the ignore lists and lets the input win for the rest', () => {
    const file = parseConfigFile('strictness: strict\nbrains: [gemini]\nignore: [a/, b/]\n');
    const input = parseInputs({ ignore: 'b/\nc/', strictness: 'chill', brains: 'groq' });
    expect(mergeSettings(file, input)).toEqual({
      brains: ['groq'],
      strictness: 'chill',
      ignore: ['a/', 'b/', 'c/'],
      problems: [],
    });
  });

  it('uses the file when the input sets nothing, and keeps both sets of problems', () => {
    const file = parseConfigFile('strictness: strict\nfoo: 1\n');
    const input = parseInputs({ ignore: '', strictness: 'x', brains: '' });
    const got = mergeSettings(file, input);
    expect(got.strictness).toBe('strict');
    expect(got.problems).toHaveLength(2);
  });
});
