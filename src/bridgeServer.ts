import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { getStagedDiff } from './git';
import { getProvider } from './providerFactory';
import { generateQuiz, Question } from './quiz';
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

        const diffPromise = getStagedDiff(cwd);
        const providerPromise = getProvider(context);

        // Start LLM quiz generation concurrently while the webview panel is created instantly
        const quizPromise = (async () => {
          const diff = await diffPromise;
          if (!diff.trim()) {
            return [] as Question[];
          }
          const liveCfg = getConfig();
          const provider = await providerPromise;
          const quiz = await generateQuiz(diff, provider, {
            questionCount: liveCfg.questionCount,
            allowShortAnswer: liveCfg.allowShortAnswer,
          });
          if (quiz.trivial || quiz.questions.length === 0) {
            return [] as Question[];
          }
          return quiz.questions;
        })();

        const result = await runQuizUI(quizPromise, diffPromise, providerPromise);

        if (result.aborted) {
          outputChannel.appendLine(`[bridge] Review aborted by user.`);
          res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
          res.end(JSON.stringify({ passed: false, reason: 'review aborted' }));
          return;
        }

        const diff = await diffPromise;
        if (!diff.trim()) {
          res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
          res.end(JSON.stringify({ passed: true, reason: 'no staged changes' }));
          return;
        }

        if (result.total === 0) {
          outputChannel.appendLine(`[bridge] Trivial diff, allowing commit.`);
          res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
          res.end(JSON.stringify({ passed: true, reason: 'trivial diff' }));
          return;
        }

        const liveCfg = getConfig();
        const fraction = result.correct / result.total;
        const passed = fraction >= liveCfg.passThreshold;

        outputChannel.appendLine(
          `[bridge] Result: ${result.correct}/${result.total}, passed=${passed}`
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

        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ passed, correct: result.correct, total: result.total }));
      } catch (err: any) {
        outputChannel.appendLine(`[bridge] Error: ${err.message}`);
        const failClosed = getConfig().failClosedOnError;
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
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
