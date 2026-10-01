import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { JSON_SHAPE_INSTRUCTION } from '../src/prompt/schema';
import { aiSdkBrain } from '../src/providers/ai-sdk';

function mock() {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: '{"summary":"ok","findings":[]}' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

const systemText = (model: MockLanguageModelV4): string => {
  const first = model.doGenerateCalls[0]?.prompt[0];
  return first?.role === 'system' ? first.content : '';
};

describe('aiSdkBrain', () => {
  const base = { provider: 'openrouter' as const, modelName: 'm', maxInputTokens: 1000 };

  it('describes the JSON shape in the system prompt when the provider cannot enforce a schema', async () => {
    const model = mock();
    await aiSdkBrain({ ...base, model, structuredOutputs: false }).review('SYSTEM', 'prompt');
    expect(systemText(model)).toContain('SYSTEM');
    expect(systemText(model)).toContain(JSON_SHAPE_INSTRUCTION);
  });

  it('leaves the system prompt alone when the provider enforces the schema', async () => {
    const model = mock();
    await aiSdkBrain({ ...base, model }).review('SYSTEM', 'prompt');
    expect(systemText(model)).not.toContain(JSON_SHAPE_INSTRUCTION);
  });
});
