import * as vscode from 'vscode';
import { getConfig, getApiKey } from './config';
import {
  LLMProvider,
  VscodeLmProvider,
  AnthropicProvider,
  OpenAiProvider,
  GoogleProvider,
  GroqProvider,
} from './llmProvider';

/** Used when aiditor.byokModel is left blank, since a sensible default differs per provider. */
export const DEFAULT_BYOK_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  google: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
};

export async function getProvider(context: vscode.ExtensionContext): Promise<LLMProvider> {
  const cfg = getConfig();

  if (cfg.provider === 'vscode-lm') {
    return new VscodeLmProvider(cfg.vscodeLmFamily);
  }

  const key = await getApiKey(context);
  if (!key) {
    throw new Error('No BYOK API key set. Run "AIditor: Set BYOK API Key" from the Command Palette first.');
  }

  const model = cfg.byokModel || DEFAULT_BYOK_MODELS[cfg.byokProvider] || DEFAULT_BYOK_MODELS.anthropic;

  switch (cfg.byokProvider) {
    case 'openai':
      return new OpenAiProvider(key, model);
    case 'google':
      return new GoogleProvider(key, model);
    case 'groq':
      return new GroqProvider(key, model);
    case 'anthropic':
    default:
      return new AnthropicProvider(key, model);
  }
}
