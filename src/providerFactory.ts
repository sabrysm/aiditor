import * as vscode from 'vscode';
import { getConfig, getApiKey } from './config';
import { LLMProvider, VscodeLmProvider, AnthropicProvider, OpenAiProvider } from './llmProvider';

export async function getProvider(context: vscode.ExtensionContext): Promise<LLMProvider> {
  const cfg = getConfig();

  if (cfg.provider === 'vscode-lm') {
    return new VscodeLmProvider(cfg.vscodeLmFamily);
  }

  const key = await getApiKey(context);
  if (!key) {
    throw new Error('No BYOK API key set. Run "AIditor: Set BYOK API Key" from the Command Palette first.');
  }

  if (cfg.byokProvider === 'anthropic') {
    return new AnthropicProvider(key, cfg.byokModel);
  }
  return new OpenAiProvider(key, cfg.byokModel);
}
