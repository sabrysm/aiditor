# Changelog

All notable changes to AIditor are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-08-16

### Added
- Setting a BYOK API key automatically switches aiditor.provider to byok.

## [1.0.0] - 2026-08-16

### Added
- Initial release.
- Generates a 3-4 question comprehension quiz (multiple choice + free-text) from `git diff --staged`.
- Two LLM backends: VS Code's built-in Language Model API (`vscode-lm`) and bring-your-own-key
  Anthropic/OpenAI (`byok`).
- Themed Webview quiz UI with progress tracking and pass/fail summary.
- Manual review command (`AIditor: Review Staged Changes`) and Source Control panel button.
- Optional `pre-commit` git hook for hard enforcement, bridged to the running editor via a local
  HTTP server so it works with either LLM backend.
