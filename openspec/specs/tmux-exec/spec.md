# tmux-exec Specification

## Purpose

Defines how the agent types into a session and obtains a bounded, cleaned result from a command, without polling.

## Requirements

### Requirement: One-call execution

`exec` SHALL inject the command into the target session, wait for completion up to a caller-supplied timeout, and return the exit status, duration, and cleaned output in the same call. The client MUST NOT need a follow-up request to obtain the result.

#### Scenario: Successful command

- **WHEN** the caller executes a command that exits successfully
- **THEN** the result contains exit code `0`, the command output, and a duration

#### Scenario: Failing command

- **WHEN** the caller executes a command that exits with a non-zero status
- **THEN** the result contains that exit code and the output produced before it failed

#### Scenario: Timeout

- **WHEN** the command does not finish within the timeout
- **THEN** the result contains the partial output, an empty exit code, and `timed_out: true`

### Requirement: Subscribe before inject

The server SHALL establish its completion subscription before injecting the command, and completion SHALL be signalled by a channel unique to that call. Completion MUST NOT be inferred from a fixed delay.

#### Scenario: Fast command

- **WHEN** the command finishes almost immediately
- **THEN** the completion signal is still observed and the result is not reported as timed out

#### Scenario: Marker-like output

- **WHEN** the command output contains text resembling the wrapper markers
- **THEN** extraction still uses the unique per-call markers and returns the correct output

### Requirement: Shell-aware exit status

The injected wrapper SHALL use the target shell's own status variable. The server SHALL determine the shell from the active pane's foreground command and MUST refuse execution when it cannot.

#### Scenario: Fish session

- **WHEN** the target pane runs fish
- **THEN** the exit status is read from fish's status variable

#### Scenario: POSIX shell session

- **WHEN** the target pane runs bash, zsh, or sh
- **THEN** the exit status is read from `$?`

#### Scenario: Unknown shell

- **WHEN** the foreground command is not a supported shell and `force` is not set
- **THEN** execution is refused with an explanation

### Requirement: Clean, bounded output

Returned output MUST exclude the echoed wrapper, the start and end markers, and ANSI escapes by default. Trailing blank lines SHALL be trimmed, and output SHALL be bounded by line and byte limits with a truncation flag.

#### Scenario: Long output

- **WHEN** a command produces more output than the configured limit
- **THEN** the result is truncated and reports `truncated: true`

#### Scenario: Coloured output

- **WHEN** a command emits ANSI colour sequences
- **THEN** the default result contains plain text

### Requirement: Multiline commands

A command containing newlines SHALL be delivered as a single bracketed paste and submitted once, so that its lines are not executed separately.

#### Scenario: Loop

- **WHEN** the caller executes a multi-line loop
- **THEN** the shell receives it as one unit and executes it without intermediate prompts

### Requirement: Timeout does not interrupt

On timeout the server SHALL leave the running command untouched. It MUST NOT send an interrupt unless the caller explicitly asks for it.

#### Scenario: Long-running command

- **WHEN** a command outlives the timeout
- **THEN** it keeps running and the caller can interrupt it with a separate key send

### Requirement: Send keys

`send_keys` SHALL send named keys or literal text to the active pane without pressing Enter unless requested. Literal text MUST NOT be interpreted by a shell.

#### Scenario: Interrupt

- **WHEN** the caller sends the interrupt key
- **THEN** the foreground process receives it

#### Scenario: Literal text

- **WHEN** the caller sends text containing `$` or backticks as literal text
- **THEN** the text is inserted without shell expansion

### Requirement: Capture

`capture` SHALL return at most the requested number of lines from the pane, with ANSI preservation optional, bounded by the configured limits and flagged when truncated. It MUST be read-only.

#### Scenario: Tail

- **WHEN** the caller captures the last lines of a pane
- **THEN** the result contains at most that many lines and no control characters by default

#### Scenario: Scrollback bound

- **WHEN** the requested range exceeds the configured limit
- **THEN** the result is cut to the limit and marked as truncated

### Requirement: State persistence and recovery

Commands SHALL run in the session's own shell so that state persists between calls. If an owned session's shell exits, the next `exec` SHALL recreate the session and report that it did.

#### Scenario: Working directory persists

- **WHEN** a command changes the working directory and a later command reads it
- **THEN** the later command observes the changed directory

#### Scenario: Shell exited

- **WHEN** the owned session no longer exists before an `exec` call
- **THEN** a fresh owned session is created and the result reports it was recreated
