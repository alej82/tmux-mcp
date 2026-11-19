# host-transport Specification

## Purpose

Defines how the server reaches a tmux server that may live in a different process namespace, keeping every host invocation isolated and reproducible.

## Requirements

### Requirement: Transport selection

The server SHALL select a transport before the first tmux interaction: a host executor when running where tmux is unavailable (default `host-spawn` inside a container), or direct execution when tmux is available locally. The selection MUST be overridable by configuration and MUST be reported in diagnostics.

#### Scenario: Container default

- **WHEN** the server runs inside the distrobox container and `host-spawn` is available while tmux is not
- **THEN** every tmux interaction is performed through `host-spawn`

#### Scenario: Co-located default

- **WHEN** tmux is available locally and no host executor is configured
- **THEN** the server invokes the configured tmux binary directly

#### Scenario: Explicit override

- **WHEN** `TMUX_MCP_HOST_EXEC` is set
- **THEN** that executor is used regardless of automatic detection

### Requirement: Argument-safe invocation

The server SHALL invoke the transport with an argument vector, never by interpolating values into a shell string, so that session names, paths, and commands cannot alter the invocation.

#### Scenario: Hostile session name

- **WHEN** a session name contains quotes, semicolons, or command substitution syntax
- **THEN** it is passed as a single argument and no additional command executes

### Requirement: No login shell

The server MUST NOT invoke login or interactive shells on the host. Where a shell is required, it SHALL be non-interactive with a sanitized environment, and `bash -lc` MUST NOT be used.

#### Scenario: Listing does not launch byobu

- **WHEN** the server lists sessions through the host executor
- **THEN** the host profile is not sourced and no new byobu session is created

### Requirement: Sanitized environment and explicit socket

When invoking tmux, the server SHALL clear inherited multiplexer and byobu variables, set `HOME`, `PATH`, and a UTF-8 locale explicitly, and address the server with an explicit socket path instead of relying on `TMUX`.

#### Scenario: Unrelated inherited multiplexer

- **WHEN** the server process inherits `TMUX` or `TMUX_PANE` pointing at another socket or pane
- **THEN** the tmux server contacted is still the configured socket

### Requirement: Reachability diagnostics

The server SHALL verify that the configured socket is reachable and SHALL return an actionable error naming the socket, executor, and tmux binary when it is not.

#### Scenario: Missing host executor

- **WHEN** the configured host executor does not exist
- **THEN** the call fails with an error that names the executor and explains the container/host topology, and no write is attempted

### Requirement: Per-call isolation

Every tool call SHALL perform its host interaction in a fresh executor process. The server MUST NOT keep a persistent host shell between calls.

#### Scenario: No shared host state

- **WHEN** two tool calls run sequentially
- **THEN** each uses its own executor process and no shell state is carried over

### Requirement: Safe defaults

The transport SHALL default to read-only behaviour when configuration is absent or invalid, and a configuration error MUST NOT cause writes to an unintended session.

#### Scenario: Invalid socket configuration

- **WHEN** the configured socket path is invalid
- **THEN** read tools return an error and write tools refuse without contacting any session
