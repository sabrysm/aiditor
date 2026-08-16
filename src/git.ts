import { execFile } from 'child_process';
import * as util from 'util';

const execFileAsync = util.promisify(execFile);

/** Returns the staged diff (`git diff --staged`) for the repo at cwd. */
export async function getStagedDiff(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--staged', '--no-color'], {
      cwd,
      maxBuffer: 1024 * 1024 * 20, // 20MB, generous for large diffs
    });
    return stdout;
  } catch (err: any) {
    throw new Error(`Failed to run "git diff --staged": ${err.message}`);
  }
}

/** Returns the list of staged file paths. */
export async function getStagedFileList(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['diff', '--staged', '--name-only'], { cwd });
  return stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Returns the absolute path to the repo root containing cwd. Throws if cwd isn't inside a git repo. */
export async function getRepoRoot(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
  return stdout.trim();
}
