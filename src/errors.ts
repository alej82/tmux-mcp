export type ToolErrorReason =
  | 'invalid_argument'
  | 'not_found'
  | 'not_owned'
  | 'attached'
  | 'not_shell'
  | 'protected_pane'
  | 'protected_agent'
  | 'busy'
  | 'unreachable'
  | 'name_collision'
  | 'audit_unavailable'
  | 'tmux_error';

export class ToolError extends Error {
  readonly reason: ToolErrorReason;

  constructor(reason: ToolErrorReason, message: string) {
    super(message);
    this.name = 'ToolError';
    this.reason = reason;
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
