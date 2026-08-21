# Changelog

All notable changes to AIditor are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [1.0.6] - 2026-08-22

### Changed
- Updated the quiz generation system prompt to ask easier free-text questions and move technical details to MCQs, focusing on review verification rather than mastery.

## [1.0.5] - 2026-08-19

### Fixed
- Fixed JSON extraction failing on reasoning models (e.g. DeepSeek R1, o1) by stripping out `<think>` tags.
- Set explicit max token limits to 4096 for BYOK providers to prevent verbose reasoning responses from truncating before producing JSON.

## [1.0.4] - 2026-08-19

### Added
- BYOK support for Google (Gemini) and Groq.

### Changed
- "Set BYOK API Key" is now a 3-step wizard: provider, then key, then model.

## [1.0.3] - 2026-08-16

### Changed
- Review panel now opens instantly with a loading state.

### Fixed
- Fixed pre-commit hook hanging `git commit` indefinitely.

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
