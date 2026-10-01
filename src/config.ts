export type ProviderId = 'gemini' | 'openrouter' | 'groq' | 'anthropic' | 'openai' | 'custom';

export interface ProviderDefaults {
  id: ProviderId;
  /** Environment variable holding the API key. */
  envKey: string;
  /** Model used when EZPR_<ID>_MODEL is not set. Names change often: keep them here only. */
  model: string;
  /** Approximate input token budget for the whole prompt. */
  maxInputTokens: number;
}

/** Default fallback order. Free tiers first, paid next, user-supplied endpoint last. */
export const PROVIDER_ORDER: ProviderDefaults[] = [
  {
    id: 'gemini',
    envKey: 'GEMINI_API_KEY',
    model: 'gemini-3.5-flash-lite',
    maxInputTokens: 100_000,
  },
  {
    id: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    model: 'openrouter/free',
    maxInputTokens: 50_000,
  },
  { id: 'groq', envKey: 'GROQ_API_KEY', model: 'openai/gpt-oss-120b', maxInputTokens: 100_000 },
  {
    id: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    model: 'claude-sonnet-5-5',
    maxInputTokens: 150_000,
  },
  { id: 'openai', envKey: 'OPENAI_API_KEY', model: 'gpt-6.1-sol', maxInputTokens: 150_000 },
];

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Used when the custom endpoint does not set EZPR_MAX_INPUT_TOKENS. */
export const CUSTOM_MAX_INPUT_TOKENS = 32_000;

/** Prefix every sticky Summary starts with; a review also records its commit SHA and time in it. */
export const SUMMARY_MARKER_PREFIX = '<!-- ezpr:summary';
/** Marker for Summary comments that are not a Review (Setup and error comments): no SHA recorded. */
export const SUMMARY_MARKER = `${SUMMARY_MARKER_PREFIX} -->`;
/** Hidden marker on every inline comment EzPR posts. */
export const INLINE_MARKER = '<!-- ezpr:inline -->';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];
/** Findings at least this severe become inline comments; the rest stay in the Summary. */
export const INLINE_MIN_SEVERITY: Severity = 'medium';
/** Earlier reviews kept in the collapsed history; older ones are dropped to stay under the comment size limit. */
export const MAX_HISTORY = 10;
