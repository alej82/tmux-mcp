export interface CommandSpec {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  stdin?: string;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface Managed {
  done: Promise<ExecResult>;
  kill: () => void;
}

export interface Runner {
  run(spec: CommandSpec, timeoutMs?: number): Promise<ExecResult>;
  start(spec: CommandSpec, timeoutMs?: number): Managed;
}

export interface SessionSummary {
  name: string;
  id: string;
  owned: boolean;
  attached: number;
  windows: number;
  cwd: string;
  cmd: string;
  activity: string | null;
  preview: string | null;
  attach_cmd: string;
}

export interface Target {
  session: string;
  id: string;
  paneId: string;
  paneCommand: string;
  attached: number;
  owned: boolean;
  cwd: string;
}

export interface ExecOptions {
  command: string;
  session?: string;
  timeoutMs?: number;
  force: boolean;
}

export interface ExecOutcome {
  session: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
  duration_ms: number;
  output: string;
  recreated: boolean;
}

export interface SendKeysOptions {
  session?: string;
  keys?: string[];
  text?: string;
  enter: boolean;
  force: boolean;
}

export interface CaptureOptions {
  session?: string;
  lines: number;
  ansi: boolean;
}

export interface NewSessionOptions {
  name: string;
  cwd?: string;
  shell?: string;
  command?: string;
}
