import { describe, expect, it } from 'vitest';

import type { AuditLog } from '../src/audit.js';
import { SessionEngine } from '../src/exec.js';
import type { TmuxClient } from '../src/tmux.js';
import type { ExecResult, SessionSummary, Target } from '../src/types.js';
import { makeConfig } from './helpers.js';

const target: Target = {
  session: 'mcp',
  id: '$1',
  paneId: '%5',
  paneCommand: 'bash',
  attached: 0,
  owned: true,
  cwd: '/home/areche',
};

const summary: SessionSummary = {
  name: 'mcp',
  id: '$1',
  owned: true,
  attached: 0,
  windows: 1,
  cwd: '/home/areche',
  cmd: 'bash',
  activity: null,
  preview: null,
  attach_cmd: "tmux attach -t 'mcp'",
};

function nonceFrom(wrapper: string): string {
  const match = /__TMUX_MCP_START_([a-f0-9]+)__/.exec(wrapper);
  if (!match?.[1]) throw new Error('wrapper has no nonce');
  return match[1];
}

class FakeClient {
  created = 0;
  raw = '';
  gate: Promise<void> | null = null;
  releaseGate: (() => void) | null = null;

  async findSession(name: string): Promise<Target | null> {
    if (this.created === 0) return null;
    return { ...target, session: name };
  }

  async createSession(options: { name: string }): Promise<{ session: SessionSummary }> {
    this.created += 1;
    return { session: { ...summary, name: options.name } };
  }

  startWait(): { done: Promise<ExecResult>; kill: () => void } {
    return {
      done: Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      kill: () => undefined,
    };
  }

  async sendText(_name: string, wrapper: string): Promise<void> {
    const nonce = nonceFrom(wrapper);
    if (this.gate) await this.gate;
    this.raw = [
      `__TMUX_MCP_START_${nonce}__`,
      'ok',
      `__TMUX_MCP_DONE_${nonce}__ rc=0`,
    ].join('\n');
  }

  async capture(): Promise<string> {
    return this.raw;
  }

  async sendNamedKeys(): Promise<void> {}

  async sendLiteral(): Promise<void> {}

  async killSession(): Promise<void> {}
}

function makeEngine(client: FakeClient, auditRecords: Array<Record<string, unknown>> = []) {
  const audit = {
    append: async (record: Record<string, unknown>) => {
      auditRecords.push(record);
    },
  } as unknown as AuditLog;

  return {
    engine: new SessionEngine(makeConfig(), client as unknown as TmuxClient, audit),
    auditRecords,
  };
}

describe('SessionEngine.exec', () => {
  it('recreates a missing owned session and reports it', async () => {
    const client = new FakeClient();
    const { engine } = makeEngine(client);

    const result = await engine.exec({ command: 'printf ok', force: false });

    expect(client.created).toBe(1);
    expect(result.recreated).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(result.output).toBe('ok');
    expect(result.timed_out).toBe(false);
  });

  it('rejects a concurrent write to the same session as busy', async () => {
    const client = new FakeClient();
    client.created = 1;
    client.gate = new Promise<void>((resolve) => {
      client.releaseGate = resolve;
    });

    const { engine, auditRecords } = makeEngine(client);
    const first = engine.exec({ command: 'sleep 1', force: false });

    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(engine.exec({ command: 'echo second', force: false })).rejects.toMatchObject({
      reason: 'busy',
    });

    client.releaseGate?.();
    await expect(first).resolves.toMatchObject({ exit_code: 0 });
    expect(auditRecords.some((record) => record.reason === 'busy')).toBe(true);
  });
});
