import * as vscode from 'vscode';
import * as https from 'https';

export interface LLMProvider {
  /** Sends a system + user prompt and returns the raw text response. */
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

/**
 * Uses VS Code's built-in Language Model API. Requires a model provider
 * extension (e.g. GitHub Copilot) to be installed and signed in.
 */
export class VscodeLmProvider implements LLMProvider {
  constructor(private family: string) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const models = await vscode.lm.selectChatModels({ family: this.family });
    if (!models || models.length === 0) {
      throw new Error(
        `No language model available for family "${this.family}". Install/sign in to a model provider ` +
          `(e.g. GitHub Copilot), or switch "aiditor.provider" to "byok" in settings.`
      );
    }
    const model = models[0];
    const messages = [vscode.LanguageModelChatMessage.User(`${systemPrompt}\n\n${userPrompt}`)];

    const cts = new vscode.CancellationTokenSource();
    try {
      const request = await model.sendRequest(
        messages,
        { justification: 'Generating a comprehension quiz for your staged code changes.' },
        cts.token
      );
      let result = '';
      for await (const fragment of request.text) {
        result += fragment;
      }
      return result;
    } finally {
      cts.dispose();
    }
  }
}

function httpsPostJson(
  hostname: string,
  reqPath: string,
  headers: Record<string, string>,
  body: unknown
): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path: reqPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} from ${hostname}: ${raw}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Failed to parse response from ${hostname}: ${raw}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** Bring-your-own-key provider for Anthropic's Messages API. */
export class AnthropicProvider implements LLMProvider {
  constructor(private apiKey: string, private model: string) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await httpsPostJson(
      'api.anthropic.com',
      '/v1/messages',
      {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model: this.model,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }
    );
    const textBlock = response.content?.find((c: any) => c.type === 'text');
    if (!textBlock) {
      throw new Error('Anthropic response contained no text block.');
    }
    return textBlock.text;
  }
}

/** Bring-your-own-key provider for OpenAI's Chat Completions API. */
export class OpenAiProvider implements LLMProvider {
  constructor(private apiKey: string, private model: string) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await httpsPostJson(
      'api.openai.com',
      '/v1/chat/completions',
      { Authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }
    );
    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI response contained no message content.');
    }
    return content;
  }
}
