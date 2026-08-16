import * as vscode from 'vscode';
import { getStagedDiff, getRepoRoot } from './git';
import { getProvider } from './providerFactory';
import { generateQuiz } from './quiz';
import { runQuizUI } from './ui';
import { getConfig, setApiKey } from './config';
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

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'AIditor: reading staged changes…' },
    async () => {
      try {
        const diff = await getStagedDiff(folder.uri.fsPath);
        if (!diff.trim()) {
          vscode.window.showInformationMessage('AIditor: no staged changes (run `git add` first).');
          return;
        }

        const cfg = getConfig();
        const provider = await getProvider(context);
        const quiz = await generateQuiz(diff, provider, {
          questionCount: cfg.questionCount,
          allowShortAnswer: cfg.allowShortAnswer,
        });

        if (quiz.trivial || quiz.questions.length === 0) {
          vscode.window.showInformationMessage('AIditor: this diff looks trivial — nothing to quiz on.');
          return;
        }

        const result = await runQuizUI(quiz.questions, diff, provider);

        if (result.aborted) {
          vscode.window.showWarningMessage('AIditor: review cancelled.');
          return;
        }

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
  );
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

async function setApiKeyCommand(context: vscode.ExtensionContext) {
  const key = await vscode.window.showInputBox({
    title: 'AIditor: BYOK API Key',
    prompt: 'Paste your Anthropic or OpenAI API key (stored securely in VS Code Secret Storage)',
    password: true,
    ignoreFocusOut: true,
  });
  if (key) {
    await setApiKey(context, key);
    vscode.window.showInformationMessage('AIditor: API key saved.');
  }
}

export function deactivate() {
  stopBridgeServer();
}
