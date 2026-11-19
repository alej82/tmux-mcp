## Purpose

Lets the agent discover the user's tmux/byobu sessions with enough context to choose one, and manage the sessions the tool owns.

## ADDED Requirements

### Requirement: List sessions with context

The server SHALL return, in one call, every session on the configured socket with its name, identifier, ownership, attached client count, window count, active pane working directory, active pane foreground command, last activity, and a one-line preview. The result MUST be produced without writing to any session.

#### Scenario: Several byobu sessions

- **WHEN** the tmux server has multiple sessions, each with one window
- **THEN** the list contains one entry per session with its working directory, foreground command, and attached state

#### Scenario: Empty server

- **WHEN** the tmux server has no sessions
- **THEN** the tool returns an empty list and a success result

#### Scenario: Attach hint

- **WHEN** a session is returned
- **THEN** the entry includes the command the human can run to attach to it

### Requirement: Preview hygiene

The preview SHALL be the last non-empty line of the visible pane, stripped of ANSI escapes, truncated to a fixed length, and derived only from the visible pane rather than the scrollback. Preview generation SHALL be disableable by configuration.

#### Scenario: Full-screen application

- **WHEN** the active pane runs a full-screen application
- **THEN** the preview is a single truncated line and does not dump the screen

#### Scenario: Preview disabled

- **WHEN** previews are disabled by configuration
- **THEN** entries omit the preview field and no capture is performed

### Requirement: Create owned session

`new_session` SHALL create a detached session with the requested name, working directory, shell, and optional initial command, and SHALL mark it as owned through a tmux session option. If an owned session with that name already exists it SHALL be returned unchanged; if a foreign session with that name exists the call MUST fail without modifying it.

#### Scenario: Create

- **WHEN** the caller requests a session named `mcp` with a working directory
- **THEN** a detached session is created there, marked as owned, and returned

#### Scenario: Idempotent create

- **WHEN** the caller requests a session name that already exists and is owned
- **THEN** the existing session is returned and no second session is created

#### Scenario: Foreign collision

- **WHEN** the caller requests a name that belongs to a session the tool does not own
- **THEN** the call fails and the foreign session is untouched

### Requirement: Ownership is persisted in tmux

A session SHALL be considered owned only when its ownership option is set to `1` on the tmux server. Ownership MUST NOT depend on server memory, so it survives a server restart.

#### Scenario: Restart

- **WHEN** the MCP server restarts and lists a session it created earlier
- **THEN** the session is still reported as owned

### Requirement: Kill policy

`kill_session` SHALL kill owned sessions and SHALL refuse foreign sessions unless `force` is true. It MUST refuse any session protected by the safety guards.

#### Scenario: Kill owned

- **WHEN** the caller kills an owned session without `force`
- **THEN** the session is terminated

#### Scenario: Refuse foreign

- **WHEN** the caller kills a foreign session without `force`
- **THEN** the call fails, states that the session is not owned, and leaves it running

#### Scenario: Forced foreign kill

- **WHEN** the caller kills a foreign session with `force: true`
- **THEN** the session is terminated and the action is recorded in the audit trail

### Requirement: No global side effects

The server MUST NOT change global tmux options, key bindings, or the default command while creating or managing sessions.

#### Scenario: Options unchanged

- **WHEN** a session is created and later killed
- **THEN** global tmux options are identical to their previous values
