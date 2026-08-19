import * as vscode from 'vscode';
import { getStagedDiff, getRepoRoot } from './git';
import { getProvider, DEFAULT_BYOK_MODELS } from './providerFactory';
import { runQuizUI } from './ui';
import { getConfig, setApiKey, ByokProvider } from './config';
import { installHook, uninstallHook } from './hookInstaller';
import { startBridgeServer, stopBridgeServer } from './bridgeServer';

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('AIditor');
  context.subscriptions.push(outputChannel);

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    try {
      const repoRoot = await getRepoRoot(folder.uri.fsPath);
      startBridgeServer(context, outputChannel, repoRoot);
    } catch {
      outputChannel.appendLine(
        'No git repository detected in the first workspace folder; hard-enforcement bridge not started.'
      );
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('aiditor.reviewStaged', () => reviewStagedCommand(context)),
    vscode.commands.registerCommand('aiditor.installHook', () => hookCommand(true)),
    vscode.commands.registerCommand('aiditor.uninstallHook', () => hookCommand(false)),
    vscode.commands.registerCommand('aiditor.setApiKey', () => setApiKeyCommand(context))
  );
}

async function reviewStagedCommand(context: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('AIditor: open a folder/workspace first.');
    return;
  }

  try {
    // Only the fast setup steps sit behind this progress toast. The panel
    // itself opens immediately after and shows its own loading state while
    // the quiz is generated, rather than leaving a stale "reading staged
    // changes…" notification up for the whole quiz session.
    const { diff, provider } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'AIditor: reading staged changes…' },
      async () => {
        const diff = await getStagedDiff(folder.uri.fsPath);
        const provider = await getProvider(context);
        return { diff, provider };
      }
    );

    if (!diff.trim()) {
      vscode.window.showInformationMessage('AIditor: no staged changes (run `git add` first).');
      return;
    }

    const result = await runQuizUI(diff, provider);

    if (result.trivial) {
      vscode.window.showInformationMessage('AIditor: this diff looks trivial — nothing to quiz on.');
      return;
    }

    if (result.aborted) {
      vscode.window.showWarningMessage('AIditor: review cancelled.');
      return;
    }

    const cfg = getConfig();
    const fraction = result.total === 0 ? 1 : result.correct / result.total;
    const passed = fraction >= cfg.passThreshold;

    if (passed) {
      vscode.window.showInformationMessage(`AIditor: passed! ${result.correct}/${result.total} correct.`);
    } else {
      vscode.window.showWarningMessage(
        `AIditor: ${result.correct}/${result.total} correct — below the pass threshold. Consider re-reading the diff.`
      );
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`AIditor error: ${err.message}`);
    outputChannel.appendLine(err.stack ?? err.message);
  }
}

async function hookCommand(install: boolean) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('AIditor: open a folder/workspace first.');
    return;
  }
  try {
    if (install) {
      await installHook(folder.uri.fsPath);
    } else {
      await uninstallHook(folder.uri.fsPath);
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`AIditor: ${err.message}`);
  }
}

interface ProviderPick extends vscode.QuickPickItem {
  value: ByokProvider;
}

async function setApiKeyCommand(context: vscode.ExtensionContext) {
  // Step 1 of 3: which provider.
  const providerPick = await vscode.window.showQuickPick<ProviderPick>(
    [
      { label: 'Anthropic', description: 'Claude models', value: 'anthropic' },
      { label: 'OpenAI', description: 'GPT models', value: 'openai' },
      { label: 'Google', description: 'Gemini models', value: 'google' },
      { label: 'Groq', description: 'Fast open-weight model hosting', value: 'groq' },
    ],
    {
      title: 'AIditor: BYOK Setup (1/3) — Provider',
      placeHolder: 'Which provider do you want to use?',
      ignoreFocusOut: true,
    }
  );
  if (!providerPick) {
    return; // cancelled — nothing saved
  }

  // Step 2 of 3: the API key.
  const key = await vscode.window.showInputBox({
    title: `AIditor: BYOK Setup (2/3) — ${providerPick.label} API Key`,
    prompt: `Paste your ${providerPick.label} API key (stored securely in VS Code Secret Storage)`,
    password: true,
    ignoreFocusOut: true,
  });
  if (!key) {
    return; // cancelled — nothing saved
  }

  // Step 3 of 3: the model name, optional.
  const defaultModel = DEFAULT_BYOK_MODELS[providerPick.value];
  const modelInput = await vscode.window.showInputBox({
    title: `AIditor: BYOK Setup (3/3) — ${providerPick.label} Model`,
    prompt: `Model name to use, or leave blank for the default (${defaultModel})`,
    placeHolder: defaultModel,
    ignoreFocusOut: true,
  });
  if (modelInput === undefined) {
    return; // cancelled (Escape) — nothing saved. An empty string, submitted on
    // purpose, is different: that means "use the default", and falls through.
  }

  await setApiKey(context, key);
  const settings = vscode.workspace.getConfiguration('aiditor');
  await settings.update('provider', 'byok', vscode.ConfigurationTarget.Global);
  await settings.update('byokProvider', providerPick.value, vscode.ConfigurationTarget.Global);
  await settings.update('byokModel', modelInput.trim(), vscode.ConfigurationTarget.Global);

  const modelLabel = modelInput.trim() || `${defaultModel} (default)`;
  vscode.window.showInformationMessage(
    `AIditor: configured for ${providerPick.label} (${modelLabel}). Provider switched to BYOK.`
  );
}

export function deactivate() {
  stopBridgeServer();
}
