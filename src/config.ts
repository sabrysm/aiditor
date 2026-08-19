import * as vscode from 'vscode';

export type ProviderMode = 'vscode-lm' | 'byok';
export type ByokProvider = 'anthropic' | 'openai' | 'google' | 'groq';

export interface AIditorConfig {
  provider: ProviderMode;
  byokProvider: ByokProvider;
  byokModel: string;
  vscodeLmFamily: string;
  questionCount: number;
  allowShortAnswer: boolean;
  passThreshold: number;
  bridgePort: number;
  failClosedOnError: boolean;
}

export function getConfig(): AIditorConfig {
  const cfg = vscode.workspace.getConfiguration('aiditor');
  return {
    provider: cfg.get<ProviderMode>('provider', 'vscode-lm'),
    byokProvider: cfg.get<ByokProvider>('byokProvider', 'anthropic'),
    byokModel: cfg.get<string>('byokModel', ''),
    vscodeLmFamily: cfg.get<string>('vscodeLmFamily', 'gpt-4o'),
    questionCount: cfg.get<number>('questionCount', 3),
    allowShortAnswer: cfg.get<boolean>('allowShortAnswer', true),
    passThreshold: cfg.get<number>('passThreshold', 0.75),
    bridgePort: cfg.get<number>('bridgePort', 43117),
    failClosedOnError: cfg.get<boolean>('failClosedOnError', false),
  };
}

const SECRET_KEY = 'aiditor.apiKey';

export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(SECRET_KEY);
}

export async function setApiKey(context: vscode.ExtensionContext, key: string): Promise<void> {
  await context.secrets.store(SECRET_KEY, key);
}
