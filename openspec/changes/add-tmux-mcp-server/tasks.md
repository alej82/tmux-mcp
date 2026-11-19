## 1. Repository scaffold

- [ ] 1.1 Create `package.json` with name `@areche/tmux-mcp`, `type: module`, Node 20 engines, `bin`, and scripts for `build`, `test`, `typecheck`
- [ ] 1.2 Add dependencies `@modelcontextprotocol/sdk` and `zod`; add dev dependencies `typescript`, `vitest`, `@types/node`
- [ ] 1.3 Add `tsconfig.json` targeting ES2022, `module: NodeNext`, `outDir: dist`, `strict: true`
- [ ] 1.4 Add `.gitignore`, `LICENSE` (MIT, with prior-art attribution note), and a README stub
- [ ] 1.5 Add a `src/index.ts` entry point that starts a stdio MCP server with name `tmux-mcp` and version from `package.json`
- [ ] 1.6 Initialize the git repository with `main` as the default branch and commit the scaffold

## 2. Configuration and host transport

- [ ] 2.1 Implement configuration loading for `TMUX_MCP_SOCKET`, `TMUX_MCP_TMUX_BIN`, `TMUX_MCP_HOST_EXEC`, `TMUX_MCP_PROTECTED`, `TMUX_MCP_TIMEOUT_MS`, `TMUX_MCP_PREVIEW`, with validated defaults
- [ ] 2.2 Implement transport detection: direct tmux when available, `host-spawn` otherwise, explicit override always wins
- [ ] 2.3 Implement argument-vector execution with a sanitized environment (`env -i`, explicit `HOME`, `PATH`, `LANG`) and an explicit `-S <socket>`
- [ ] 2.4 Guarantee no login/interactive shell is ever spawned; add a unit test that inspects the argv passed to the executor
- [ ] 2.5 Implement the unreachable-socket diagnostic with executor, binary, and socket in the message
- [ ] 2.6 Add unit tests for transport selection, override, hostile session names, and environment hygiene

## 3. tmux primitives

- [ ] 3.1 Implement a low-level runner that returns stdout, stderr, and exit status without shell interpolation
- [ ] 3.2 Implement session listing with owner, attached count, window count, cwd, foreground command, and activity
- [ ] 3.3 Implement the batched preview read in one host invocation, including ANSI stripping and truncation
- [ ] 3.4 Implement ownership read/write through the `@tmux_mcp_owned` session option
- [ ] 3.5 Implement `new_session` with name, cwd, shell, and optional initial command, including idempotent and foreign-collision behaviour
- [ ] 3.6 Implement `kill_session` under the ownership and guard policy
- [ ] 3.7 Add unit tests for list parsing, empty servers, preview disabled, ownership persistence, and collision handling

## 4. Safety guards

- [ ] 4.1 Implement explicit-target resolution: owned default `mcp`, no implicit focus, recreate when missing
- [ ] 4.2 Implement the `TMUX_PANE` guard, making it absolute and independent of socket selection
- [ ] 4.3 Implement the protected foreground-command set from configuration plus defaults
- [ ] 4.4 Implement the foreign/attached/non-shell policy with distinct refusal reasons
- [ ] 4.5 Implement the per-session write mutex with a busy result
- [ ] 4.6 Implement the audit trail (timestamp, tool, target, forced, outcome, truncated command) with `0600` permissions
- [ ] 4.7 Add unit tests for each guard, each refusal reason, force behaviour, and fail-closed cases

## 5. Execution engine

- [ ] 5.1 Implement shell detection from the active pane foreground command, mapping bash/zsh/sh to `$?` and fish to `$status`, and refusing unknown shells
- [ ] 5.2 Implement the one-shot `exec` flow: subscribe with `timeout <N> tmux wait-for <nonce>` before injecting
- [ ] 5.3 Implement the injected wrapper with per-call start/end markers and the shell-specific status variable
- [ ] 5.4 Implement multiline delivery through `set-buffer` + `paste-buffer -p` followed by a single Enter
- [ ] 5.5 Implement marker-bounded extraction that excludes the echoed wrapper and strips ANSI by default
- [ ] 5.6 Implement output caps (lines and bytes) with a `truncated` flag
- [ ] 5.7 Implement timeout handling that returns partial output, sets `timed_out`, and does not interrupt
- [ ] 5.8 Implement `send_keys` for named keys and literal text, with Enter optional
- [ ] 5.9 Implement `capture` with line count, optional ANSI, caps, and truncation flag
- [ ] 5.10 Implement session recreation after the owned shell exits, reporting `recreated: true`
- [ ] 5.11 Add unit tests with a fake executor for success, non-zero exit, timeout, marker-like output, multiline, caps, and recreation

## 6. MCP tools

- [ ] 6.1 Register `list_sessions` with its input schema and structured result
- [ ] 6.2 Register `new_session` and `kill_session` with their schemas and refusal errors
- [ ] 6.3 Register `exec` with `command`, `session`, `timeout_ms`, and `force`
- [ ] 6.4 Register `send_keys` and `capture`
- [ ] 6.5 Map guard and transport failures to MCP error results with machine-readable reasons and actionable messages
- [ ] 6.6 Add tool-level tests that the registered schemas reject invalid input and accept documented defaults

## 7. Integration tests

- [ ] 7.1 Add an opt-in integration suite that starts an isolated `tmux -L tmux-mcp-test` server and never touches the user's socket
- [ ] 7.2 Cover create, list, exec, timeout, send_keys, capture, and kill against the isolated server
- [ ] 7.3 Cover the fish and bash exit-status paths against the isolated server
- [ ] 7.4 Add a regression test that listing does not create a byobu session or source the host profile

## 8. Packaging and configuration

- [ ] 8.1 Add the `bin` entry and verify `dist/index.js` runs as a stdio MCP server
- [ ] 8.2 Document installation, environment variables, security model, and the container/host topology in the README
- [ ] 8.3 Document the opencode MCP configuration entry and the read-only first-run check
- [ ] 8.4 Add the prior-art attribution section and third-party notice for reused MIT ideas
- [ ] 8.5 Create the GitHub repository `tmux-mcp` and push `main` (manual step; requires `gh` authentication)

## 9. Verification

- [ ] 9.1 Run `npm run typecheck` and `npm test` clean
- [ ] 9.2 Run the opt-in integration suite against the isolated socket
- [ ] 9.3 Smoke-test `list_sessions` against the real socket in read-only mode and confirm no write occurs
- [ ] 9.4 Smoke-test `exec` and `send_keys` against a tool-created session, then kill it
- [ ] 9.5 Confirm the audit file exists with `0600` permissions and contains the expected records
