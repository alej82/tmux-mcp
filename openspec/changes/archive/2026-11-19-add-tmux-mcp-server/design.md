## Context

See `proposal.md` for motivation. The constraints that shape every decision:

- opencode (the MCP client) runs inside a distrobox container; byobu 6.14 on tmux 3.7c runs on the host (Manjaro).
- The tmux socket is `/tmp/tmux-1000/default`. `/tmp` is shared, so the socket is reachable from the container, but the container has no tmux client and the host binary cannot run inside it (missing `libutempter`, `libevent`).
- `host-spawn` executes host commands from the container. It does not propagate stdin EOF, so it cannot host the MCP server itself.
- A host login shell is hostile: the host `.profile` sources `byobu-launch`, so `bash -lc` creates a new byobu session. This was observed while probing.
- The pane hosting this container is named by `TMUX_PANE` (`%12`, foreground `podman`). Session 9 runs another `opencode`. Both must be untouchable.
- Prior art: `nickgnd/tmux-mcp` (MIT). Its marker approach and `--shell-type` idea are reused with attribution; its co-located, poll-based, unguarded architecture is not.

## Goals / Non-Goals

**Goals:**

- One MCP server that works both inside the container (via the host transport) and on the host (direct).
- Session-level API: enough to choose a target and run work, with no window/pane micromanagement.
- Results in one call, with deterministic completion and bounded output.
- Fail-closed targeting: the default is a tool-owned session; everything else is explicit and forced.

**Non-Goals:**

- Replacing byobu or attaching a TUI.
- Window/pane/layout operations, resources, or a screen backend.
- Multi-user or remote-host tmux.
- Redacting command output or protecting the user from their own commands.

## Decisions

### D1. Per-call host executor, not a host-hosted server

Each tool call spawns one `host-spawn` process (or runs tmux directly when co-located). The executor is selected by `TMUX_MCP_HOST_EXEC`, defaulting to `host-spawn` when tmux is absent.

Alternatives rejected:

- **Run the whole server through host-spawn**: stdio EOF is not forwarded; the MCP transport would hang on disconnect.
- **Install tmux in the container and use the shared socket**: container tmux is 3.6a, the host server is 3.7c; the tmux protocol is not compatible across those versions.
- **Build 3.7c in the container**: removes the executor dependency but adds a build/runtime artifact to maintain.
- **SSH to the host**: extra credentials and latency for no benefit on the same machine.

The cost is one process per call. Reads are batched into a single host invocation (see D4) so the list path stays cheap.

### D2. Blocking exec with `wait-for`, subscribed before inject

`exec` starts `timeout <N> tmux wait-for <nonce>` first, then injects a wrapper that ends with `tmux wait-for -S <nonce>`. The signal is edge-triggered, so the ordering is a correctness requirement, not an optimization.

Alternatives rejected:

- **Start + poll** (prior art): two tools, a pending map, and a round trip per poll. Worse for an agent.
- **`pipe-pane` to a log file**: captures the stream but takes over the pane's pipe and can disturb the user's setup.
- **Sleep and tail**: racy for fast and slow commands alike.

On timeout the waiter is killed by `timeout`, the partial capture is returned, and the command is left running. Interrupting is an explicit `send_keys` decision.

### D3. Marker-bounded extraction, shell-aware status

Wrapper shape:

```
printf '\n__START_<nonce>__\n'
<command>
printf '\n__DONE_<nonce>__ rc=%s\n' <status-var>
tmux wait-for -S <nonce>
```

`<status-var>` is `$?` for bash/zsh/sh and `$status` for fish. The shell is read from `#{pane_current_command}`; anything outside the supported set requires `force`. Output is the text between the last exact `__START_<nonce>__` line and the `__DONE_<nonce>__` line, with the echoed wrapper excluded, ANSI stripped by default, trailing blanks trimmed, and caps applied (64 KiB / 1000 lines) with a `truncated` flag.

The nonce makes marker collisions with user output practically impossible. The echoed wrapper is visible in the pane; in the owned session this is invisible in practice, in foreign sessions it pollutes scrollback, which the docs acknowledge.

### D4. Session-level targeting with a single batched read

Tools address sessions, not panes. tmux resolves the active pane internally. `list_sessions` is one host invocation that runs a small `sh -c` loop over the session list, collecting per-session `display-message` fields and a `capture-pane` preview. There is no N+1 process fan-out.

Alternatives rejected: exposing pane ids (leaks tmux internals and doubles the API surface); one host call per session (latency without benefit).

### D5. Ownership in tmux, default session on demand

`new_session` sets `@tmux_mcp_owned=1`. Ownership is always read back from tmux, so it survives server restarts. The default session is `mcp`, created with `bash --noprofile --norc`, cwd `$HOME`, detached, and marked on first use. Mutexes are per session and in-memory; a second concurrent write to the same session fails as busy rather than queueing.

Alternatives rejected: remembering owned names in a JSON file (drifts from tmux); using a session-name prefix (fragile and noisy in the status bar); allowing the default to be the focused session (the exact failure mode the guards exist to prevent).

### D6. Three guard layers, two of them absolute

1. `TMUX_PANE` (the pane hosting this container) — absolute.
2. Foreground command in the protected agent set (`opencode`, `claude`, `codex`, configurable) — absolute.
3. Foreign session, attached client, or non-shell foreground — requires `force: true`.

`force` is a single explicit boolean because MCP has no interactive confirmation channel. Absolute guards cannot be overridden. Every write appends an audit record (timestamp, tool, target, forced, outcome, truncated command) to a `0600` file.

Alternatives rejected: requiring the session name twice (ceremony without security); an allowlist of sessions (does not scale and still permits the wrong pane); relying on `TMUX_PANE` alone (does not protect session 9's other agent).

### D7. Multiline via bracketed paste

Commands with newlines go through `set-buffer` + `paste-buffer -p`, then one Enter. `send-keys -l` handles literal text and named keys. This avoids the prior art's documented heredoc failure and prevents line-by-line execution.

### D8. Environment hygiene

Every host invocation uses an argument vector: `host-spawn /usr/bin/env -i HOME=… PATH=… LANG=C.UTF-8 /usr/bin/tmux -S <socket> …`. No login shell, no `TMUX`/`BYOBU_*` inheritance, explicit socket. `TMUX_PANE` is read by the server itself for guard decisions, never forwarded as a target hint.

### D9. Result contract

`exec` returns `{ exit_code, timed_out, duration_ms, output, truncated, recreated }`. `timed_out` implies no exit code. Errors are returned as MCP error results with a machine-readable reason (`not_owned`, `attached`, `not_shell`, `protected_pane`, `busy`, `unreachable`). The server never throws a stack trace at the model.

### D10. Packaging

Repo `tmux-mcp`; npm `@areche/tmux-mcp` (unscoped name taken); MIT. The local checkout directory name is irrelevant. Build with `tsc` to `dist/`; tests with Vitest. The MCP entry points at `dist/index.js`.

## Risks / Trade-offs

- **Keystrokes interleave with a human on attached sessions** → `force` plus an audit record; the tool cannot prevent a collision, only require acknowledgement.
- **Timeout leaves a hung foreground process** → the result is explicit; the caller uses `send_keys` to interrupt. Auto-interrupting a foreign session would be worse.
- **Preview can leak sensitive text into model context** → visible pane only, one truncated line, disableable; never scrollback.
- **host-spawn latency** → batched list read; per-call cost accepted for lifecycle simplicity.
- **Shell detection is a heuristic** → supported set only, otherwise refuse unless forced.
- **Version drift** → the server never ships a tmux client; it always uses the host's binary.
- **Shared `/tmp` assumption** → configurable socket and an actionable unreachable error.
- **The tool is remote code execution by design** → same uid only, no sudo, absolute guards, audit trail, and documentation that says so.
- **Tests touching real sessions** → integration tests use an isolated `tmux -L tmux-mcp-test` socket and never the user's server.

## Migration Plan

Greenfield. No data migration.

1. Publish/install `@areche/tmux-mcp` and build `dist/`.
2. Add the MCP entry to the opencode config: `node /home/areche/screen-mcp/dist/index.js`.
3. Verify with `list_sessions` (read-only) before any write.
4. Rollback: remove the MCP entry; no tmux state was modified except owned sessions, which can be killed with `kill_session` or by hand.

## Open Questions

- Whether to publish the package publicly or keep it a local install.
- Whether v2 should expose MCP resources (`tmux://sessions`) for clients that support them.
- Whether a `screen` backend is worth adding for portability; nothing on this machine requires it today.
