# Local Changes

## [Unreleased]

### Added

- Added `/provider` for adding and modifying custom providers backed by SQLite, with selectable OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages protocols plus compact `128k` and `1m` model context-size syntax.
- Custom providers now derive reasoning support and `thinkingLevelMap` from the selected API protocol, so `/thinking` offers the matching levels without extra input.
- `/thinking` selections now persist as the default for the current model, so switching away and back restores the chosen level; the thinking selector marks that default.

### Fixed

- Fixed custom provider models being absent from the model selector when `auth.json` held a leftover credential with an empty API key: unusable stored credentials no longer shadow the configured API key.
- Fixed Anthropic Messages custom providers getting `401 missing_api_key` from gateways that only read `Authorization: Bearer`: the provider now sends the Bearer header in addition to the standard `x-api-key` header.
