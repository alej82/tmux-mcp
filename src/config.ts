import { statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { ConfigError } from './errors.js';

export interface Config {
  socket: string;
  tmuxBin: string;
  hostExec: string | null;
  hostHome: string;
  hostPath: string;
  lang: string;
  protectedCommands: string[];
  timeoutMs: number;
  preview: boolean;
  auditFile: string;
  maxLines: number;
  maxBytes: number;
  defaultSession: string;
  shell: string;
  waitBin: string | null;
}

export type Env = Record<string, string | undefined>;

const DEFAULT_PROTECTED = ['opencode', 'claude', 'codex', 'cursor-agent', 'aider'];
const DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin';

function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function whichSync(name: string, pathEnv: string): string | null {
  for (const dir of pathEnv.split(':')) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function currentUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return 'user';
  }
}

function parseInteger(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseBoolean(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

export function loadConfig(env: Env = process.env): Config {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const pathEnv = env.TMUX_MCP_HOST_PATH?.trim() || DEFAULT_PATH;

  const configuredTmux = env.TMUX_MCP_TMUX_BIN?.trim();
  const tmuxBin = configuredTmux || whichSync('tmux', pathEnv) || '/usr/bin/tmux';

  const explicitHost = env.TMUX_MCP_HOST_EXEC;
  const hostExec =
    explicitHost !== undefined
      ? explicitHost.trim() === ''
        ? null
        : explicitHost.trim()
      : isExecutableFile(tmuxBin)
        ? null
        : 'host-spawn';

  const hostHome =
    env.TMUX_MCP_HOST_HOME?.trim() ||
    (hostExec ? `/home/${currentUsername()}` : env.HOME?.trim() || homedir());

  const extraProtected = (env.TMUX_MCP_PROTECTED ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const defaultSession = env.TMUX_MCP_DEFAULT_SESSION?.trim() || 'mcp';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(defaultSession)) {
    throw new ConfigError('TMUX_MCP_DEFAULT_SESSION must match [A-Za-z0-9][A-Za-z0-9_-]*');
  }

  const waitBin = isExecutableFile('/usr/bin/timeout')
    ? '/usr/bin/timeout'
    : isExecutableFile('/bin/timeout')
      ? '/bin/timeout'
      : null;

  return {
    socket: env.TMUX_MCP_SOCKET?.trim() || `/tmp/tmux-${uid}/default`,
    tmuxBin,
    hostExec,
    hostHome,
    hostPath: pathEnv,
    lang: env.TMUX_MCP_LANG?.trim() || 'C.UTF-8',
    protectedCommands: [...new Set([...DEFAULT_PROTECTED, ...extraProtected])],
    timeoutMs: parseInteger(env, 'TMUX_MCP_TIMEOUT_MS', 30_000, 100, 300_000),
    preview: parseBoolean(env, 'TMUX_MCP_PREVIEW', true),
    auditFile:
      env.TMUX_MCP_AUDIT_FILE?.trim() ||
      join(env.HOME?.trim() || homedir(), '.local/state/tmux-mcp/audit.log'),
    maxLines: parseInteger(env, 'TMUX_MCP_MAX_LINES', 1_000, 1, 10_000),
    maxBytes: parseInteger(env, 'TMUX_MCP_MAX_BYTES', 65_536, 1_024, 1_048_576),
    defaultSession,
    shell: env.TMUX_MCP_SHELL?.trim() || '/usr/bin/bash',
    waitBin,
  };
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function commandBasename(command: string): string {
  return basename(command).replace(/^-/, '').toLowerCase();
}
