import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import {
  CUSTOM_MAX_INPUT_TOKENS,
  GROQ_BASE_URL,
  OPENROUTER_BASE_URL,
  PROVIDER_ORDER,
  type ProviderDefaults,
  type ProviderId,
} from '../config';
import { aiSdkBrain } from './ai-sdk';
import type { Brain } from './types';

export type Env = Record<string, string | undefined>;

function read(env: Env, key: string): string {
  return (env[key] ?? '').trim();
}

function languageModel(
  id: ProviderId,
  apiKey: string,
  model: string,
  baseURL?: string,
): LanguageModel {
  switch (id) {
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey })(model);
    case 'anthropic':
      return createAnthropic({ apiKey })(model);
    case 'openai':
      return createOpenAI({ apiKey })(model);
    case 'groq':
      return createOpenAICompatible({
        name: 'groq',
        baseURL: GROQ_BASE_URL,
        apiKey,
        supportsStructuredOutputs: true,
      })(model);
    case 'openrouter':
      return createOpenAICompatible({
        name: 'openrouter',
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
        supportsStructuredOutputs: false,
      })(model);
    case 'custom':
      return createOpenAICompatible({
        name: 'custom',
        baseURL: baseURL ?? '',
        apiKey: apiKey || undefined,
        supportsStructuredOutputs: false,
      })(model);
  }
}

function fromDefaults(env: Env, def: ProviderDefaults): Brain | null {
  const apiKey = read(env, def.envKey);
  if (!apiKey) return null;
  const model = read(env, `EZPR_${def.id.toUpperCase()}_MODEL`) || def.model;
  return aiSdkBrain({
    provider: def.id,
    modelName: model,
    maxInputTokens: def.maxInputTokens,
    model: languageModel(def.id, apiKey, model),
  });
}

/** The custom OpenAI-compatible endpoint (Ollama, LM Studio, ...). The key is optional. */
function customBrain(env: Env): Brain | null {
  const baseURL = read(env, 'EZPR_BASE_URL');
  const model = read(env, 'EZPR_MODEL');
  if (!baseURL || !model) return null;
  const max = Number.parseInt(read(env, 'EZPR_MAX_INPUT_TOKENS'), 10);
  return aiSdkBrain({
    provider: 'custom',
    modelName: model,
    maxInputTokens: Number.isFinite(max) && max > 0 ? max : CUSTOM_MAX_INPUT_TOKENS,
    model: languageModel('custom', read(env, 'EZPR_API_KEY'), model, baseURL),
  });
}

/** Builds the fallback chain from whichever credentials exist, in the default order. */
export function buildBrains(env: Env): Brain[] {
  const brains = PROVIDER_ORDER.map((def) => fromDefaults(env, def));
  brains.push(customBrain(env));
  return brains.filter((b): b is Brain => b !== null);
}
