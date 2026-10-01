import { PROVIDER_ORDER, type ProviderId } from '../config';

export interface MenuProvider {
  id: ProviderId;
  label: string;
  /** Repository secret that holds the key. */
  secret: string;
  /** Where to create a key. */
  url: string;
  /** Free tiers may handle submitted code differently from paid ones: `init` warns first. */
  free: boolean;
  /** Said after the general free-tier warning, for terms that are worse than usual. */
  extraWarning?: string;
}

const MENU: Record<string, Omit<MenuProvider, 'id' | 'secret'>> = {
  gemini: {
    label: 'Gemini (free key, recommended)',
    url: 'https://aistudio.google.com/apikey',
    free: true,
  },
  openrouter: { label: 'OpenRouter (free models)', url: 'https://openrouter.ai/keys', free: true },
  groq: { label: 'Groq (free tier)', url: 'https://console.groq.com/keys', free: true },
  mistral: {
    label: 'Mistral (free tier, generous limits)',
    url: 'https://console.mistral.ai/api-keys',
    free: true,
    extraWarning:
      "Mistral's free tier requires you to opt in to your data being used for training.",
  },
  anthropic: {
    label: 'Anthropic (paid)',
    url: 'https://console.anthropic.com/settings/keys',
    free: false,
  },
  openai: { label: 'OpenAI (paid)', url: 'https://platform.openai.com/api-keys', free: false },
};

/**
 * The providers `init` offers, Gemini first. The custom endpoint is left out: it needs three
 * values and is set up by hand (see the README).
 */
export const MENU_PROVIDERS: MenuProvider[] = PROVIDER_ORDER.flatMap((p) => {
  const entry = MENU[p.id];
  return entry ? [{ id: p.id, secret: p.envKey, ...entry }] : [];
});

export const FREE_TIER_WARNING = [
  'Free API tiers can treat your data differently from paid ones: some providers may use',
  'submitted prompts to improve their models. EzPR sends the diff and the changed files of',
  'each pull request to the provider you pick (secret-like files are skipped, common secret',
  "formats are redacted). For a private repository, check the provider's terms first.",
].join('\n');
