## Why

The agent runs inside a distrobox container while the user's terminal multiplexer — byobu 6.14 on tmux 3.7c — runs on the host. No existing MCP server crosses that boundary: `nickgnd/tmux-mcp` (MIT, 307 stars) assumes the server shares the host with tmux, exposes a non-blocking `execute-command` + poll model, and has no ownership or self-pane guards. The user has twelve byobu sessions and wants an agent to list them and run commands either in a dedicated session or, explicitly, in an existing one.

## What Changes

- Add a TypeScript/Node 20 stdio MCP server published as `@areche/tmux-mcp` (repo `tmux-mcp`, MIT).
- Add a **host transport**: every tmux interaction is one `host-spawn` call with a sanitized environment and an explicit socket, falling back to a direct `tmux` invocation when the server already runs on the tmux host.
- Add six tools: `list_sessions`, `exec`, `send_keys`, `capture`, `new_session`, `kill_session`.
- Add **session ownership**: the tool creates and marks its own session (`mcp` by default); foreign sessions are read-only unless `force: true`.
- Add **one-shot execution**: `exec` injects a marker-wrapped command, blocks on a `tmux wait-for` channel, and returns exit code plus cleaned output within a timeout.
- Add **fail-closed guards**: never target the pane named by `$TMUX_PANE` or a pane whose foreground command is an agent, and reject non-shell foregrounds unless forced.
- Add configuration via environment (`TMUX_MCP_SOCKET`, `TMUX_MCP_TMUX_BIN`, `TMUX_MCP_HOST_EXEC`, `TMUX_MCP_PROTECTED`, `TMUX_MCP_TIMEOUT_MS`).
- Add a minimal MCP entry for opencode and a test suite that runs against a scratch tmux server, never the user's sessions.

## Capabilities

### New Capabilities

- `host-transport`: how the server reaches a tmux server that may live in another namespace (host-spawn vs direct), including environment hygiene and socket selection.
- `tmux-sessions`: listing sessions with previews, creating owned sessions, and killing them under an ownership policy.
- `tmux-exec`: injecting text/keys, capturing pane output, and executing a command with a bounded wait and an exit status.
- `safety-guards`: the rules that decide whether a target session/pane may be written to, including self-pane and agent-pane protection.

### Modified Capabilities

None. This is a new repository with no pre-existing specs.

## Non-goals

- Window, pane, and layout management (splits, moves, resizes).
- MCP resources or subscriptions (`tmux://sessions`, `tmux://pane/{id}`).
- A GNU screen backend.
- Multi-user, remote SSH, or cross-host orchestration.
- Attaching an interactive TUI; `list_sessions` returns an `attach_cmd` for the human instead.
- Privilege escalation, `sudo` handling, or secret redaction beyond output limits.
- Full feature parity with `nickgnd/tmux-mcp`.

## Impact

- **New code**: repository skeleton, `src/` (server, tmux adapter, guards), `test/`.
- **Runtime dependency**: `host-spawn` in the container and tmux 3.7c on the host; the container must not be asked to run host binaries.
- **Configuration**: one new `mcp` entry in the opencode config pointing at `dist/index.js`.
- **Distribution**: npm scope `@areche/tmux-mcp` because the unscoped name is taken; MIT license with attribution notes for prior-art ideas.

### Prior art

`nickgnd/tmux-mcp` already offers session/window/pane listing, capture, execution, and splits. This change deliberately differs in four points: a host transport for the container boundary, a blocking exec that returns in one call, guards that fail closed, and byobu-aware previews. Its MIT-licensed ideas (marker wrapping, `--shell-type`) are reused with attribution; its tool surface is not cloned.
