import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { getStagedDiff } from './git';
import { getProvider } from './providerFactory';
import { runQuizUI } from './ui';
import { getConfig } from './config';

let server: http.Server | undefined;
let portFilePath: string | undefined;

/**
 * Starts a localhost-only HTTP server that the pre-commit hook script calls into.
 * This is what lets a plain shell git hook trigger an in-editor quiz (including
 * via vscode.lm, which only works inside the extension host).
 */
export function startBridgeServer(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  repoRoot: string
) {
  const cfg = getConfig();

  if (server) {
    server.close();
  }

  server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/review') {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const cwd: string = payload.cwd;
        if (!cwd) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'missing cwd' }));
          return;
        }

        outputChannel.appendLine(`[bridge] Review requested for ${cwd}`);

        const diff = await getStagedDiff(cwd);
        if (!diff.trim()) {
          res.writeHead(200);
          res.end(JSON.stringify({ passed: true, reason: 'no staged changes' }));
          return;
        }

        const provider = await getProvider(context);

        // Deliberately not awaited: a plain info toast with no action items
        // can sit undismissed indefinitely, which would block this whole
        // handler (and therefore the waiting `curl` call, and therefore
        // `git commit` itself) on the user manually closing a notification.
        vscode.window.showInformationMessage(
          'AIditor: review your staged changes before this commit goes through.'
        );

        // Panel opens immediately inside runQuizUI now, with quiz generation
        // happening in the background behind its own loading state.
        const result = await runQuizUI(diff, provider);

        if (result.trivial) {
          outputChannel.appendLine('[bridge] Result: trivial diff, no questions asked');
          res.writeHead(200);
          res.end(JSON.stringify({ passed: true, reason: 'trivial diff' }));
          return;
        }

        const liveCfg = getConfig();
        const fraction = result.total === 0 ? 1 : result.correct / result.total;
        const passed = !result.aborted && fraction >= liveCfg.passThreshold;

        outputChannel.appendLine(
          `[bridge] Result: ${result.correct}/${result.total}, passed=${passed}, aborted=${result.aborted}`
        );

        if (!passed) {
          vscode.window.showErrorMessage(
            `AIditor: commit blocked — scored ${result.correct}/${result.total}.`
          );
        } else {
          vscode.window.showInformationMessage(
            `AIditor: passed (${result.correct}/${result.total}). Commit allowed.`
          );
        }

        res.writeHead(200);
        res.end(JSON.stringify({ passed, correct: result.correct, total: result.total }));
      } catch (err: any) {
        outputChannel.appendLine(`[bridge] Error: ${err.message}`);
        const failClosed = getConfig().failClosedOnError;
        res.writeHead(200);
        res.end(JSON.stringify({ passed: !failClosed, error: err.message }));
      }
    });
  });

  server.listen(cfg.bridgePort, '127.0.0.1', () => {
    outputChannel.appendLine(`[bridge] Listening on http://127.0.0.1:${cfg.bridgePort}`);
    try {
      portFilePath = path.join(repoRoot, '.git', 'aiditor.port');
      fs.writeFileSync(portFilePath, String(cfg.bridgePort), 'utf8');
    } catch (e: any) {
      outputChannel.appendLine(`[bridge] Could not write port file: ${e.message}`);
    }
  });

  context.subscriptions.push({ dispose: () => stopBridgeServer() });
}

export function stopBridgeServer() {
  if (server) {
    server.close();
    server = undefined;
  }
  if (portFilePath && fs.existsSync(portFilePath)) {
    try {
      fs.unlinkSync(portFilePath);
    } catch {
      // best effort cleanup
    }
  }
}