import { describe, expect, it } from 'vitest';
import { buildBrains, orderBrains } from '../src/providers/registry';

describe('buildBrains', () => {
  it('returns nothing without credentials, ignoring empty secrets', () => {
    expect(buildBrains({})).toEqual([]);
    expect(buildBrains({ GEMINI_API_KEY: '', OPENAI_API_KEY: '  ' })).toEqual([]);
  });

  it('builds the chain in the default order from whichever keys exist', () => {
    const brains = buildBrains({
      OPENAI_API_KEY: 'o',
      GROQ_API_KEY: 'g',
      GEMINI_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'a',
      OPENROUTER_API_KEY: 'r',
      MISTRAL_API_KEY: 'm',
    });
    expect(brains.map((b) => b.provider)).toEqual([
      'gemini',
      'openrouter',
      'groq',
      'mistral',
      'anthropic',
      'openai',
    ]);
  });

  it('puts the custom endpoint last and requires base URL and model', () => {
    expect(buildBrains({ EZPR_BASE_URL: 'http://localhost:11434/v1' })).toEqual([]);
    const brains = buildBrains({
      GEMINI_API_KEY: 'k',
      EZPR_BASE_URL: 'http://localhost:11434/v1',
      EZPR_MODEL: 'llama3',
      EZPR_MAX_INPUT_TOKENS: '8000',
    });
    expect(brains.map((b) => b.id)).toEqual(['gemini/gemini-3.5-flash-lite', 'custom/llama3']);
    expect(brains[1]?.maxInputTokens).toBe(8000);
  });

  it('lets EZPR_<PROVIDER>_MODEL override the default model name', () => {
    const [b] = buildBrains({ GROQ_API_KEY: 'g', EZPR_GROQ_MODEL: 'other/model' });
    expect(b?.id).toBe('groq/other/model');
  });

  it('does not repeat the provider name when the model already has it', () => {
    const [b] = buildBrains({ OPENROUTER_API_KEY: 'r' });
    expect(b?.id).toBe('openrouter/free');
  });
});

describe('orderBrains', () => {
  const brains = buildBrains({ GEMINI_API_KEY: 'k', GROQ_API_KEY: 'g', OPENAI_API_KEY: 'o' });

  it('keeps the default chain when nothing is listed', () => {
    expect(orderBrains(brains, undefined)).toEqual({ brains, missing: [] });
  });

  it('reorders, drops unlisted providers and reports listed ones without a key', () => {
    const got = orderBrains(brains, ['openai', 'anthropic', 'gemini']);
    expect(got.brains.map((b) => b.provider)).toEqual(['openai', 'gemini']);
    expect(got.missing).toEqual(['anthropic']);
  });
});
