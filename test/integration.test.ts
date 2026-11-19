import { spawn } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditLog } from '../src/audit.js';
import { loadConfig } from '../src/config.js';
import { ProcessRunner } from '../src/executor.js';
import { SessionEngine } from '../src/exec.js';
import { TmuxClient } from '../src/tmux.js';
import { Transport } from '../src/transport.js';
import type { ExecResult } from '../src/types.js';

const enabled = process.env.TMUX_MCP_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;

const socketName = 'tmux-mcp-itest';
const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
const socketPath = `/tmp/tmux-${uid}/${socketName}`;
const hostHome = process.env.TMUX_MCP_HOST_HOME ?? join('/home', userInfo().username);
const auditFile = `/tmp/tmux-mcp-itest-audit-${process.pid}.log`;

function host(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(
      'host-spawn',
      [
        '/usr/bin/env',
        '-i',
        `HOME=${hostHome}`,
        'PATH=/usr/local/bin:/usr/bin:/bin',
        'LANG=C.UTF-8',
        '/usr/bin/tmux',
        '-L',
        socketName,
        ...args,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ code: 127, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function makeEngine(): SessionEngine {
  const config = loadConfig({
    HOME: process.env.HOME,
    TMUX_MCP_SOCKET: socketPath,
    TMUX_MCP_TMUX_BIN: '/usr/bin/tmux',
    TMUX_MCP_HOST_EXEC: 'host-spawn',
    TMUX_MCP_HOST_HOME: hostHome,
    TMUX_MCP_AUDIT_FILE: auditFile,
    TMUX_MCP_PREVIEW: '1',
    TMUX_MCP_TIMEOUT_MS: '5000',
  });

  const transport = new Transport(config);
  const runner = new ProcessRunner();
  const client = new TmuxClient(config, transport, runner);
  return new SessionEngine(config, client, new AuditLog(config.auditFile));
}

suite('tmux-mcp integration (isolated socket)', () => {
  let engine: SessionEngine;

  beforeAll(async () => {
    await host(['kill-server']).catch(() => undefined);
    await rm(auditFile, { force: true });

    const created = await host([
      'new-session',
      '-d',
      '-s',
      'base',
      '-c',
      hostHome,
      "'/usr/bin/bash' --noprofile --norc",
    ]);
    expect(created.code).toBe(0);

    engine = makeEngine();
    const probe = await engine.listSessions();
    expect(probe.map((session) => session.name)).toContain('base');
  }, 30_000);

  afterAll(async () => {
    await host(['kill-server']).catch(() => undefined);
    await rm(auditFile, { force: true });
  }, 30_000);

  it('lists sessions without creating or modifying any', async () => {
    const before = await engine.listSessions();
    const again = await engine.listSessions();

    expect(again.map((session) => session.name)).toEqual(before.map((session) => session.name));
    expect(again.every((session) => session.owned === false)).toBe(true);
  });

  it('creates an owned session once and reports idempotency', async () => {
    const first = await engine.newSession({ name: 'itest' });
    expect(first.session.owned).toBe(true);
    expect(first.initial_command_sent).toBe(false);
    expect(await engine.newSession({ name: 'itest' })).toMatchObject({
      initial_command_sent: false,
    });
  });

  it('runs a command and returns its output and exit code', async () => {
    const ok = await engine.exec({ command: 'printf hello', session: 'itest', force: false });
    expect(ok.exit_code).toBe(0);
    expect(ok.timed_out).toBe(false);
    expect(ok.output).toContain('hello');

    const failed = await engine.exec({ command: 'false', session: 'itest', force: false });
    expect(failed.exit_code).toBe(1);
    expect(failed.timed_out).toBe(false);
  });

  it('preserves shell state between calls', async () => {
    await engine.exec({ command: 'cd /tmp', session: 'itest', force: false });
    const result = await engine.exec({ command: 'pwd', session: 'itest', force: false });
    expect(result.output.trim()).toBe('/tmp');
  });

  it('returns partial output on timeout and leaves the command running', async () => {
    const started = Date.now();
    const result = await engine.exec({
      command: 'sleep 5',
      session: 'itest',
      timeoutMs: 300,
      force: false,
    });
    const elapsed = Date.now() - started;

    expect(result.timed_out).toBe(true);
    expect(result.exit_code).toBeNull();
    expect(elapsed).toBeLessThan(4_000);

    await engine.sendKeys({ session: 'itest', keys: ['C-c'], force: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it('sends literal text and captures the result', async () => {
    await engine.sendKeys({
      session: 'itest',
      text: 'echo SENT_OK',
      enter: true,
      force: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const captured = await engine.capture({ session: 'itest', lines: 100, ansi: false });
    expect(captured.output).toContain('SENT_OK');
  });

  it('runs the initial command on creation', async () => {
    const created = await engine.newSession({
      name: 'itest-init',
      command: 'echo INIT_OK',
    });
    expect(created.initial_command_sent).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const captured = await engine.capture({ session: 'itest-init', lines: 100, ansi: false });
    expect(captured.output).toContain('INIT_OK');
    await engine.killSession('itest-init', false);
  });

  it('uses the fish status variable for exit codes', async () => {
    await engine.newSession({ name: 'itest-fish', shell: '/usr/bin/fish' });
    const failed = await engine.exec({ command: 'false', session: 'itest-fish', force: false });
    expect(failed.exit_code).toBe(1);

    const ok = await engine.exec({ command: 'printf fish-ok', session: 'itest-fish', force: false });
    expect(ok.exit_code).toBe(0);
    expect(ok.output).toContain('fish-ok');
  });

  it('refuses to kill a foreign session without force', async () => {
    await expect(engine.killSession('base', false)).rejects.toMatchObject({
      reason: 'not_owned',
    });
    expect((await engine.listSessions()).map((session) => session.name)).toContain('base');
  });

  it('kills owned sessions', async () => {
    await engine.killSession('itest', false);
    await engine.killSession('itest-fish', false);
    const names = (await engine.listSessions()).map((session) => session.name);

    expect(names).not.toContain('itest');
    expect(names).not.toContain('itest-fish');
  });

  it('writes an audit trail with owner-only permissions', async () => {
    const info = await stat(auditFile);
    expect(info.mode & 0o777).toBe(0o600);

    const lines = (await readFile(auditFile, 'utf8')).trim().split('\n');
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.some((record) => record.tool === 'exec')).toBe(true);
    expect(records.some((record) => record.tool === 'kill_session')).toBe(true);
  });
});
