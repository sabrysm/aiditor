# AIditor

AIditor is a VS Code extension designed to catch the "blind commit" problem. Before you commit, it reads your staged changes and quizzes you on the logic, edge cases, and consequences of the code. 

If you're using AI assistants to write code, AIditor ensures you actually understand what you are committing before it reaches the repository.

## Features

- **Context-Aware Quizzes:** Reads `git diff --staged` to generate comprehension questions (not trivia). Trivial diffs like formatting or version bumps are automatically detected and skipped.
- **Dynamic Formats:** Uses a mix of multiple-choice and LLM-graded free-text questions. You can't beat the quiz just by pattern-matching.
- **Native VS Code UI:** Renders a clean, themed Webview panel right next to your code, complete with progress tracking and inline feedback.
- **Hard Enforcement:** Installs a real git `pre-commit` hook. The quiz is enforced whether you commit via the terminal, the VS Code Source Control panel, or a third-party Git GUI.
- **Flexible LLM Backends:** Use VS Code's built-in Language Model API (via extensions like Copilot) or bring your own API key for Anthropic/OpenAI.

## How the Pre-Commit Hook Works

Git hooks are background shell scripts that can't natively talk to the VS Code extension API. To solve this, AIditor runs a lightweight, local-only (`127.0.0.1`) HTTP server in the background while VS Code is open. 

When you trigger a commit, the `pre-commit` hook pauses the commit process, calls this local server, and triggers the UI inside your editor. The commit is blocked until you pass the quiz. 

> **Note:** VS Code must be open on the repository for the hook to work. Like any standard client-side hook, you can bypass it in an emergency using `git commit --no-verify`.

---

## Usage

### 1. Choose your LLM Backend
- **`vscode-lm` (Default):** Uses VS Code's built-in Language Model API. Requires a provider extension (like GitHub Copilot) to be installed and signed in.
- **`byok` (Bring Your Own Key):** Calls Anthropic or OpenAI directly. Set this up by running **AIditor: Set BYOK API Key** in the Command Palette, then set `aiditor.provider` to `"byok"` in your settings. Keys are securely stored in VS Code's encrypted Secret Storage.

### 2. Commands
Access these via the VS Code Command Palette (`Cmd/Ctrl + Shift + P`):
- **AIditor: Review Staged Changes** — Run the quiz manually (also available as a button in the Source Control panel).
- **AIditor: Install Pre-Commit Hook (Hard Enforcement)** — Installs the hook into `.git/hooks/pre-commit`. Automatically chains with existing hooks if present.
- **AIditor: Uninstall Pre-Commit Hook** — Removes the hook and restores your previous setup.
- **AIditor: Set BYOK API Key** — stores your Anthropic/OpenAI key in Secret Storage and switches
  `aiditor.provider` to `byok` automatically.
  
### 3. Settings

| Setting | Default | Description |
|---|---|---|
| `aiditor.provider` | `vscode-lm` | `vscode-lm` or `byok` |
| `aiditor.byokProvider` | `anthropic` | `anthropic` or `openai` (used when provider is `byok`) |
| `aiditor.byokModel` | `claude-sonnet-4-6` | Model name for BYOK calls |
| `aiditor.vscodeLmFamily` | `gpt-4o` | Model family requested via `vscode.lm` |
| `aiditor.questionCount` | `3` | Questions generated per review (2-6) |
| `aiditor.allowShortAnswer` | `true` | Include LLM-graded free-text questions |
| `aiditor.passThreshold` | `0.75` | Fraction of correct answers required to pass |
| `aiditor.bridgePort` | `43117` | Localhost port used for the git hook bridge |
| `aiditor.failClosedOnError` | `false` | If `true`, internal extension errors will block the commit entirely. |

---

## Extension Development Guide

We welcome community contributions! If you want to modify AIditor, add new models, or improve the UI, here is how to get started.

### Prerequisites
- Node.js installed
- VS Code installed

### Local Setup
1. Clone the repository and navigate to the project folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile the TypeScript code:
   ```bash
   npm run compile
   ```
4. **Launch the Extension Development Host:** 
   Open the project in VS Code and press **F5**. This will open a new, sandboxed VS Code window with your local version of AIditor loaded.
5. Open any Git repository in that new window, stage some changes, and run the `AIditor: Review Staged Changes` command to test your modifications.

### Architecture Overview
If you are contributing, here are the main areas of the codebase to look at:
- **`src/extension.ts`**: The entry point. Handles command registration and lifecycle events.
- **`src/server.ts`**: The localhost HTTP server that acts as a bridge between the `.git/hooks/pre-commit` bash script and the VS Code extension.
- **`src/llm/`**: Contains the logic for parsing `git diff`, formatting prompts, and connecting to the `vscode-lm` and `byok` backends.
- **`src/webview/`**: Contains the HTML/CSS/JS for the quiz interface. It is styled using standard `var(--vscode-*)` CSS variables so it automatically adapts to the user's active color theme.

## Known Limitations
- Currently assumes a single-root workspace. Multi-root workspaces are not fully supported yet.
- Only one VS Code window per repository should run the bridge at a time (managed via the `<repo>/.git/aiditor.port` handshake file).

## License
[MIT](./LICENSE)