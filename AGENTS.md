# AGENTS.md

Guidance for AI coding agents working in this repository. Read `README.md`
first for the user-facing description; this file covers the rules that keep
the server correct and safe.

## What this project is

A local MCP stdio server (`@areche/tmux-mcp`) that lists and drives tmux/byobu
sessions. It is designed for the case where the MCP client runs inside a
container and tmux runs on the host.

The behavior contract lives in
`openspec/changes/add-tmux-mcp-server/specs/`. The implementation decisions and
their rationale live in `design.md`. When behavior changes, update the spec
delta as part of the change, not after the fact.

## Commands

```sh
npm run typecheck
npm test                    # unit tests; integration suite is skipped
npm run test:integration    # requires host-spawn + tmux on the host
npm run build               # emits dist/ (gitignored)
openspec validate add-tmux-mcp-server --type change --strict
```

Integration tests start an isolated `tmux -L tmux-mcp-itest` server. They must
never touch the user's real tmux sessions or socket.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/index.ts` | stdio entry point, startup diagnostics |
| `src/server.ts` | MCP tool registration, schemas, result mapping |
| `src/config.ts` | environment parsing, transport detection, defaults |
| `src/transport.ts` | builds host/direct command specs (`env -i`, `-S`) |
| `src/executor.ts` | spawns processes, collects output, enforces limits |
| `src/tmux.ts` | session list/inspect/create/kill/send/capture, ownership |
| `src/guards.ts` | self-pane, agent-pane and force policy (pure) |
| `src/exec.ts` | one-shot exec engine, mutex, audit, target resolution |
| `src/output.ts` | markers, ANSI, caps, list parsing, shell helpers |
| `src/audit.ts` | JSON audit trail with `0600` permissions |

Data flow: MCP handler → `SessionEngine` → guards/mutex → `TmuxClient` →
`Transport` → `ProcessRunner` → `host-spawn` → host tmux.

## Hard invariants — do not break these

1. **Never invoke a host login or interactive shell.** `bash -lc` sources the
   host `.profile`, which runs `byobu-launch` and creates a byobu session.
   Use absolute binaries, `/bin/sh -c` scripts with positional arguments, and a
   sanitized environment.
2. **Do not run host binaries inside the container.** The container lacks
   `libutempter`/`libevent` and has no tmux client. Every host interaction goes
   through `host-spawn` when `TMUX_MCP_HOST_EXEC` selects host mode.
3. **Do not host the MCP server itself through `host-spawn`.** It does not
   forward stdin EOF, so the stdio transport would hang. The server runs in the
   container and calls `host-spawn` per tool call.
4. **Never write to the pane named by `TMUX_PANE`, or to a pane whose
   foreground command is in the protected set.** These refusals are absolute
   and `force` must not override them. Read the variables; never hardcode the
   pane id (it changes between launches).
5. **Foreign, attached, or non-shell targets require `force: true`.** Refusals
   must name the failed condition and be audited.
6. **Subscribe to the `wait-for` channel before injecting the command.**
   tmux's signal is edge-triggered; a waiter started after a fast command never
   sees it.
7. **Only write to explicitly named sessions.** The default is the owned
   `mcp` session; never infer "the current session".
8. **Every write appends an audit record.** If the audit cannot be written,
   the write fails closed.

## Known tmux quirks (learned the hard way)

- `display-message -p -t '=missing:'` exits **0** and prints empty fields for a
  missing session. Treat an empty `session_name`/`session_id` as "not found";
  do not rely on the exit code.
- Pane-target commands need `=name:` (with the trailing colon). `=name` alone
  is parsed as a pane name and fails. Session names cannot contain `:` or `.`.
- `capture-pane` returns the whole visible pane, padded with blank lines. Never
  use `tail` to find output; use marker-bounded extraction or the last
  non-empty line.
- `tmux -L <name>` started from inside the container inherits `TMUX` and emits
  "sessions should be nested with care". Test helpers must strip `TMUX` and
  `TMUX_PANE`.
- `host-spawn` does not forward stdin EOF. Do not use `load-buffer -` or any
  host command that reads until EOF. Send text with `set-buffer -- <text>` and
  `paste-buffer -p`.
- GNU `timeout` accepts fractional seconds (`0.55s`), which is how the exec
  timeout is enforced without extending it by a whole second.
- `send-keys -l -- <text>` and `set-buffer -- <text>` handle leading dashes;
  keep the `--`.
- `new-session`'s command argument is executed through a shell; quote the
  shell path and flags, and never interpolate user input into it.

## Conventions

- TypeScript, Node 20, `module: NodeNext`. Source imports use `.js` specifiers.
- Zod schemas live in `toolSchemas` in `src/server.ts`; test them with
  `z.object(toolSchemas.<name>)`.
- Throw `ToolError` with a machine-readable `reason` for anything the model
  should see. Handlers map it to `error [reason]: message` with `isError: true`.
- Writes go through `guards` and the per-session mutex, then audit. Reads
  (`list_sessions`, `capture`) do not write and do not need force.
- Output returned to the model is ANSI-stripped by default, trimmed, and capped
  by `maxLines`/`maxBytes` with a `truncated` flag.
- Keep tool output readable: metadata as JSON, then `--- output ---`, then the
  raw text.
- Prefer extending the existing modules over adding parallel abstractions.

## Testing rules

- Unit tests must not spawn tmux. Use `FakeRunner` / a stub client and assert
  argv, parsing, guards, caps, and engine behavior.
- Integration tests are opt-in via `TMUX_MCP_INTEGRATION=1` and use
  `tmux -L tmux-mcp-itest` (socket
  `/tmp/tmux-<uid>/tmux-mcp-itest`). Never point them at the default socket.
- The audit test writes to `/tmp`; clean it up in `afterAll`.
- If you add a new tmux interaction, cover it in the isolated suite and add a
  unit test for the argument construction when the command is security
  relevant.

## OpenSpec workflow

- The active change is `openspec/changes/add-tmux-mcp-server/`.
- Behavior belongs in `specs/<capability>/spec.md` (SHALL/MUST, scenarios with
  four `#` headings). Implementation details belong in `design.md`.
- When adding or changing behavior, update the spec delta and the tasks list
  together, then run `openspec validate add-tmux-mcp-server --type change
  --strict`.
- Keep tasks small and check them off as you finish; do not mark a task done
  because the code compiles.

## Do not

- Push to a remote, create a GitHub repository, or publish to npm without
  explicit user approval. The npm name `tmux-mcp` is taken; the package is
  `@areche/tmux-mcp`.
- Run as root, add `sudo`, or execute commands under another uid.
- Change global tmux options, key bindings, or `default-shell`.
- Add window/pane/split management or a GNU screen backend to v1; those are
  explicit non-goals.
- Auto-interrupt a command on timeout. Return the partial output and let the
  caller send `C-c` (with `force` when the pane is no longer a shell).
- Weaken a guard to make a test pass. Fix the test or the target selection.
