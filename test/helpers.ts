import type { Config } from '../src/config.js';

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    socket: '/tmp/tmux-1000/default',
    tmuxBin: '/usr/bin/tmux',
    hostExec: 'host-spawn',
    hostHome: '/home/areche',
    hostPath: '/usr/local/bin:/usr/bin:/bin',
    lang: 'C.UTF-8',
    protectedCommands: ['opencode', 'claude', 'codex'],
    timeoutMs: 30_000,
    preview: true,
    auditFile: '/tmp/tmux-mcp-test-audit.log',
    maxLines: 1_000,
    maxBytes: 65_536,
    defaultSession: 'mcp',
    shell: '/usr/bin/bash',
    waitBin: '/usr/bin/timeout',
    ...overrides,
  };
}
