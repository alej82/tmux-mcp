import { describe, expect, it } from 'vitest';

import { loadConfig, shellQuote } from '../src/config.js';
import { ConfigError } from '../src/errors.js';

const baseEnv = {
  HOME: '/home/areche/distrobox_home',
  TMUX_MCP_HOST_EXEC: 'host-spawn',
  TMUX_MCP_HOST_HOME: '/home/areche',
};

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig(baseEnv);

    expect(config.hostExec).toBe('host-spawn');
    expect(config.hostHome).toBe('/home/areche');
    expect(config.timeoutMs).toBe(30_000);
    expect(config.preview).toBe(true);
    expect(config.defaultSession).toBe('mcp');
    expect(config.shell).toBe('/usr/bin/bash');
    expect(config.socket).toMatch(/^\/tmp\/tmux-\d+\/default$/);
    expect(config.protectedCommands).toEqual(
      expect.arrayContaining(['opencode', 'claude', 'codex']),
    );
  });

  it('merges extra protected commands without duplicates', () => {
    const config = loadConfig({
      ...baseEnv,
      TMUX_MCP_PROTECTED: 'aider, MY-AGENT ,opencode',
    });

    expect(config.protectedCommands).toContain('aider');
    expect(config.protectedCommands).toContain('my-agent');
    expect(
      config.protectedCommands.filter((value) => value === 'opencode'),
    ).toHaveLength(1);
  });

  it('treats an empty host executor as direct mode', () => {
    const config = loadConfig({ ...baseEnv, TMUX_MCP_HOST_EXEC: '' });
    expect(config.hostExec).toBeNull();
  });

  it('rejects an invalid timeout', () => {
    expect(() => loadConfig({ ...baseEnv, TMUX_MCP_TIMEOUT_MS: 'nope' })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ ...baseEnv, TMUX_MCP_TIMEOUT_MS: '5' })).toThrow(
      ConfigError,
    );
  });

  it('rejects an invalid default session name', () => {
    expect(() =>
      loadConfig({ ...baseEnv, TMUX_MCP_DEFAULT_SESSION: 'bad name' }),
    ).toThrow(ConfigError);
  });

  it('parses preview booleans', () => {
    expect(loadConfig({ ...baseEnv, TMUX_MCP_PREVIEW: '0' }).preview).toBe(false);
    expect(loadConfig({ ...baseEnv, TMUX_MCP_PREVIEW: 'false' }).preview).toBe(false);
    expect(loadConfig({ ...baseEnv, TMUX_MCP_PREVIEW: '1' }).preview).toBe(true);
  });
});

describe('shellQuote', () => {
  it('quotes spaces and embedded single quotes', () => {
    expect(shellQuote('/usr/bin/bash')).toBe("'/usr/bin/bash'");
    expect(shellQuote("a b'c")).toBe("'a b'\\''c'");
  });
});
