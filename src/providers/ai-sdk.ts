import { generateObject, type LanguageModel } from 'ai';
import type { ProviderId } from '../config';
import { ReviewSchema } from '../prompt/schema';
import type { Brain } from './types';

const REQUEST_TIMEOUT_MS = 120_000;

/** Wraps any AI SDK language model as a Brain. Retries are owned by the chain, not the SDK. */
export function aiSdkBrain(opts: {
  provider: ProviderId;
  modelName: string;
  maxInputTokens: number;
  model: LanguageModel;
}): Brain {
  return {
    provider: opts.provider,
    id: `${opts.provider}/${opts.modelName}`,
    maxInputTokens: opts.maxInputTokens,
    async review(system, prompt) {
      const { object } = await generateObject({
        model: opts.model,
        schema: ReviewSchema,
        system,
        prompt,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return object;
    },
  };
}
