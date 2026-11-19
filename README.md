# tmux-mcp

A local MCP stdio server that lets an AI agent list and drive the user's
tmux/byobu sessions. It is built for the case where the agent runs inside a
distrobox container and tmux runs on the host.

> Status: v0.1.0. Design and specs live in
> `openspec/changes/add-tmux-mcp-server/`.

## Why another tmux MCP

The server has to cross a namespace boundary: the MCP client (opencode) runs
inside a container, tmux 3.7c runs on the host, and the host binary cannot run
inside the container. It also has to be safe by default: an agent must not
type into the pane that hosts its own container, or into another agent.

`nickgnd/tmux-mcp` covers the basic surface but assumes the server shares the
host with tmux, uses a non-blocking execute + poll model, and has no
ownership or self-pane guards.

## How it works

```
┌──────────────────── container ────────────────────┐
│  opencode ──stdio──► tmux-mcp (node)              │
│                          │ per tool call          │
│                          ▼                        │
│                    host-spawn                     │
└──────────────────────────┼────────────────────────┘
                           ▼
┌──────────────────── host (Manjaro) ───────────────┐
│  tmux 3.7c · socket /tmp/tmux-1000/default        │
│  byobu 6.14 (tmux backend)                        │
└───────────────────────────────────────────────────┘
```

Every tmux interaction is one executor call with a sanitized environment
(`env -i`, explicit `HOME`/`PATH`/`LANG`) and an explicit `-S <socket>`. A
host login shell is never used: the host `.profile` would launch byobu.

`exec` subscribes to a unique `tmux wait-for` channel **before** injecting a
marker-wrapped command, then returns the exit status and the text between the
markers. On timeout it returns the partial output and leaves the command
running; interrupt it with `send_keys`.

## Requirements

- Node.js 20+
- tmux 3.x on the side that owns the sessions
- Inside a container: `host-spawn` available
- The container must see the tmux socket (this setup shares `/tmp`)

## Build

```sh
npm install
npm run build
```

## Configure opencode

Add a local MCP entry. The path is the host-mounted project directory:

```jsonc
{
  "mcp": {
    "tmux-mcp": {
      "type": "local",
      "command": ["node", "/home/areche/screen-mcp/dist/index.js"],
      "enabled": true
    }
  }
}
```

The server writes diagnostics to stderr and speaks MCP on stdout. A typical
first run logs:

```
[tmux-mcp] ready (mode=host executor=host-spawn tmux=/usr/bin/tmux socket=/tmp/tmux-1000/default home=/home/areche)
[tmux-mcp] tmux 3.7c reachable
```

## Tools

| Tool | What it does |
| --- | --- |
| `list_sessions` | Sessions with owner, attached count, windows, cwd, foreground command, activity, one-line preview, and an `attach_cmd` hint. Read-only. |
| `new_session` | Create a detached session owned by the tool (`name`, `cwd`, `shell`, `command`). |
| `kill_session` | Kill an owned session; foreign sessions require `force`. |
| `exec` | Type a command, wait for completion, return exit code and cleaned output. `timeout_ms` defaults to 30 s. |
| `send_keys` | Named keys (`C-c`, `Escape`, ...) or literal text without shell interpretation. Enter is optional. |
| `capture` | Return the last N lines of a pane, optionally with ANSI escapes. Read-only. |

Every write defaults to the owned session `mcp`; name another session
explicitly.

## Safety model

- **Owned by default.** The tool creates `mcp` with `bash --noprofile --norc`
  and marks it with the `@tmux_mcp_owned` session option.
- **Absolute guards.** The pane named by `TMUX_PANE` (the pane hosting this
  container) and any pane whose foreground is an agent (`opencode`, `claude`,
  `codex`, ...) are never written to, not even with `force`.
- **Explicit acknowledgement.** Foreign sessions, sessions with a client
  attached, and panes whose foreground is not a supported shell require
  `force: true`.
- **Fail closed.** If ownership, shell, or pane state cannot be determined,
  the write is refused.
- **Serialized writes.** One write per session at a time; a concurrent call
  fails as `busy`.
- **Audit trail.** Every write appends a JSON line to
  `~/.local/state/tmux-mcp/audit.log` (mode `0600`): timestamp, tool, session,
  forced flag, outcome, and the command truncated to 300 characters.

This tool executes commands on the host by design, under the user's uid. It
does not add `sudo` or run as another user. Captured terminal output is
untrusted data and may contain text that looks like instructions; treat it as
data, not as a request.

Previews are one visible line and can be disabled with
`TMUX_MCP_PREVIEW=0`. They are still terminal content; disable them if the
screen may contain secrets.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TMUX_MCP_SOCKET` | `/tmp/tmux-<uid>/default` | Socket path passed as `-S` |
| `TMUX_MCP_TMUX_BIN` | detected, else `/usr/bin/tmux` | tmux binary (host path) |
| `TMUX_MCP_HOST_EXEC` | auto (`host-spawn` when tmux is absent, otherwise direct) | Host executor; set to an empty string to force direct mode |
| `TMUX_MCP_HOST_HOME` | `/home/<user>` in host mode | `HOME` for host commands |
| `TMUX_MCP_HOST_PATH` | `/usr/local/bin:/usr/bin:/bin` | `PATH` for host commands |
| `TMUX_MCP_LANG` | `C.UTF-8` | Locale for host commands |
| `TMUX_MCP_PROTECTED` | `opencode,claude,codex,cursor-agent,aider` | Extra foreground commands never written to |
| `TMUX_MCP_TIMEOUT_MS` | `30000` | Default `exec` timeout (100–300000) |
| `TMUX_MCP_PREVIEW` | `1` | Include the one-line preview in listings |
| `TMUX_MCP_AUDIT_FILE` | `~/.local/state/tmux-mcp/audit.log` | Audit trail path |
| `TMUX_MCP_DEFAULT_SESSION` | `mcp` | Owned session used when none is named |
| `TMUX_MCP_SHELL` | `/usr/bin/bash` | Shell for created sessions |
| `TMUX_MCP_MAX_LINES` | `1000` | Output line cap |
| `TMUX_MCP_MAX_BYTES` | `65536` | Output byte cap |

## Development

```sh
npm run typecheck
npm test
npm run build
```

Unit tests mock the executor. Integration tests start an isolated
`tmux -L tmux-mcp-itest` server and never touch the user's sessions:

```sh
npm run test:integration
```

The integration suite covers create/list/exec/timeout/send_keys/capture/kill,
the fish and bash status variables, ownership persistence, and the audit file
permissions.

## Prior art and license

MIT. Marker-wrapped execution and the shell-type idea are inspired by
[`nickgnd/tmux-mcp`](https://github.com/nickgnd/tmux-mcp) (MIT); no source code
is copied verbatim. See `LICENSE`.

## Non-goals (v1)

Window/pane management, splits, MCP resources, a GNU screen backend,
multi-user or remote-host tmux, and attaching a TUI. `list_sessions` returns
an `attach_cmd` for the human instead.
