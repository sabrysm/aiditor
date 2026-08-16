import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getRepoRoot } from './git';

const MARKER = 'AIDITOR_HOOK_MARKER';

export async function installHook(cwd: string): Promise<void> {
  const repoRoot = await getRepoRoot(cwd);
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-commit');
  const templatePath = path.join(__dirname, '..', 'hooks', 'pre-commit.sh');
  const template = fs.readFileSync(templatePath, 'utf8');

  fs.mkdirSync(path.dirname(hookPath), { recursive: true });

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');

    if (existing.includes(MARKER)) {
      fs.writeFileSync(hookPath, template, { mode: 0o755 });
      vscode.window.showInformationMessage('AIditor: pre-commit hook re-installed (updated).');
      return;
    }

    // Preserve the developer's existing hook and chain it after our check.
    const backupPath = hookPath + '.aiditor-backup';
    fs.writeFileSync(backupPath, existing, { mode: 0o755 });
    const chained = `${template}\n\n# --- chained original pre-commit hook ---\n"$0.aiditor-backup"\n`;
    fs.writeFileSync(hookPath, chained, { mode: 0o755 });
    vscode.window.showInformationMessage(
      'AIditor: pre-commit hook installed. Your previous hook was preserved and chained after this check.'
    );
    return;
  }

  fs.writeFileSync(hookPath, template, { mode: 0o755 });
  vscode.window.showInformationMessage('AIditor: pre-commit hook installed.');
}

export async function uninstallHook(cwd: string): Promise<void> {
  const repoRoot = await getRepoRoot(cwd);
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-commit');
  const backupPath = hookPath + '.aiditor-backup';

  if (!fs.existsSync(hookPath)) {
    vscode.window.showInformationMessage('AIditor: no pre-commit hook installed.');
    return;
  }

  const existing = fs.readFileSync(hookPath, 'utf8');
  if (!existing.includes(MARKER)) {
    vscode.window.showWarningMessage(
      'AIditor: the existing pre-commit hook was not installed by this extension; leaving it alone.'
    );
    return;
  }

  if (fs.existsSync(backupPath)) {
    fs.renameSync(backupPath, hookPath);
    fs.chmodSync(hookPath, 0o755);
    vscode.window.showInformationMessage('AIditor: pre-commit hook removed; restored your previous hook.');
  } else {
    fs.unlinkSync(hookPath);
    vscode.window.showInformationMessage('AIditor: pre-commit hook removed.');
  }
}
