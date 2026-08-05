# amazon-operator-stack — notes for Claude Code

This repo is an MCP server for Amazon SP-API. If you are helping a user set it
up, debug it, or modify it, these facts override anything you think you know.

## MCP registration — ground truth

- MCP server definitions live in `~/.claude.json` (user scope) and are managed
  with the `claude mcp` CLI. **`~/.claude/settings.json` does NOT load an
  `mcpServers` block** — entries written there are silently ignored (or shown
  as unapproved ghosts, depending on version). Never write MCP entries into
  settings.json, and never advise the user to.
- Registration is done by `npm run wire-claude` — use it rather than editing
  any config file by hand. It also migrates broken v1.0.0 installs.
- `npm run wire-claude` executed from inside a Claude Code session can be
  undone when that session exits. If you run it as a tool call, tell the user
  to fully quit Claude Code afterwards and run `npm run doctor` in a fresh
  terminal.

## Credentials — hard rules

- All credentials live in `.env` at the repo root (mode 0600), and only there.
  The Claude Code MCP entry must contain **no `env` block**.
- Never print, cat, echo, or paste the contents of `.env`, and never run
  commands that would echo credentials (`claude mcp get` is safe only because
  the entry carries no env; keep it that way).
- Never commit `.env`, `.env.bak.*`, or any Claude Code config file.

## Debugging order

1. `npm run doctor` — four layers (registered → spawnable → credentials →
   Amazon), stops at the first failure with the fix. Start here, always.
2. `npm run smoke-test` — per-endpoint SP-API role probe, for when doctor's
   layer 4 fails.
3. `claude mcp list | grep amazon-operator-stack` — what Claude Code actually
   loaded (requires restart after wiring).

## Gotchas that have burned people before

- A 400 from SP-API means the role IS granted (bad params). A 403 means it is
  NOT granted. Do not tell users to re-request roles on a 400.
- Sales & Traffic is rate-limited (1 req/45s) and delayed 24-48h.
- Finances fees arrive as negative numbers.
- The repo must not live in iCloud/Dropbox/OneDrive — file eviction kills the
  server at random later. Recommend `~/code/`.
