# safety-guards Specification

## Purpose

Specifies the fail-closed rules that decide whether a session or pane may be written to, and the audit trail that records every write.

## Requirements

### Requirement: Explicit target

Write tools SHALL target an explicitly named session. When no session is named, only the owned default session MAY be used, and it SHALL be created if missing. The server MUST NOT infer a target from the "current" session, the focused window, or the client's environment.

#### Scenario: Default target

- **WHEN** the caller omits the session name
- **THEN** the owned default session is used or created

#### Scenario: No implicit focus

- **WHEN** the caller omits the session name while a different session is attached in the user's terminal
- **THEN** the attached session is not modified

### Requirement: Self-pane protection

The server SHALL read `TMUX_PANE` from its own environment and MUST refuse to write to that pane regardless of `force`. `TMUX` and `TMUX_PANE` MUST NOT influence which socket is contacted.

#### Scenario: Pane hosting the container

- **WHEN** the target resolves to the pane named by `TMUX_PANE`
- **THEN** the write is refused even with `force: true`

#### Scenario: Socket independent of environment

- **WHEN** the inherited `TMUX` points at a different server than the configured socket
- **THEN** the configured socket remains the only target

### Requirement: Agent-pane protection

The server MUST refuse to write to any pane whose foreground command belongs to the protected set, regardless of `force`. The set SHALL include at least `opencode`, `claude`, and `codex`, and SHALL be extendable by configuration.

#### Scenario: Another agent

- **WHEN** the target pane's foreground command is `opencode`
- **THEN** the write is refused even with `force: true`

#### Scenario: Extended set

- **WHEN** configuration adds a command to the protected set
- **THEN** panes running that command are refused as well

### Requirement: Foreign target policy

Writing to a session that is not owned SHALL require `force: true`. Writing to a session with attached clients SHALL require `force: true`. Writing to a pane whose foreground command is not a supported shell SHALL require `force: true`. Every refusal SHALL state which condition failed.

#### Scenario: Foreign session

- **WHEN** the caller writes to a session without the ownership mark and without `force`
- **THEN** the call fails and explains that the session is not owned

#### Scenario: Attached session

- **WHEN** the caller writes to an owned session that has a client attached and `force` is not set
- **THEN** the call fails and explains that a human is attached

#### Scenario: Non-shell foreground

- **WHEN** the active pane runs a full-screen application and `force` is not set
- **THEN** the call fails and names the foreground command

#### Scenario: Forced write

- **WHEN** the caller sets `force: true` and no absolute guard applies
- **THEN** the write proceeds and is recorded in the audit trail

### Requirement: Serialized writes per session

The server SHALL allow at most one write per session at a time. A concurrent write to the same session MUST fail with a busy result instead of interleaving keystrokes. Writes to different sessions MAY proceed concurrently.

#### Scenario: Concurrent exec

- **WHEN** two executions target the same session while the first is still running
- **THEN** the second fails as busy and does not inject anything

#### Scenario: Different sessions

- **WHEN** two executions target different sessions
- **THEN** both proceed independently

### Requirement: Audit trail

Every write SHALL append a record containing timestamp, tool name, target session, whether `force` was used, outcome, and the command truncated to a fixed length. The audit file SHALL be created with owner-only permissions and MUST NOT contain the process environment.

#### Scenario: Forced write recorded

- **WHEN** a write uses `force: true`
- **THEN** the audit record marks it as forced

#### Scenario: Failed guard recorded

- **WHEN** a write is refused by a guard
- **THEN** the refusal is recorded without executing anything

### Requirement: Fail closed

If ownership, shell type, pane identity, or target state cannot be determined, the server MUST refuse the write and explain what could not be determined.

#### Scenario: Tmux query fails

- **WHEN** the server cannot query the target session
- **THEN** the write is refused and no keystrokes are sent
