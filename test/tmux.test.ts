import { describe, expect, it } from 'vitest';

import { FIELD_SEPARATOR } from '../src/output.js';
import { TmuxClient } from '../src/tmux.js';
import { Transport } from '../src/transport.js';
import type { CommandSpec, ExecResult, Managed, Runner } from '../src/types.js';
import { makeConfig } from './helpers.js';

class FakeRunner implements Runner {
  readonly calls: CommandSpec[] = [];

  constructor(private readonly responses: ExecResult[]) {}

  async run(spec: CommandSpec): Promise<ExecResult> {
    this.calls.push(spec);
    return this.responses.shift() ?? { code: 0, stdout: '', stderr: '' };
  }

  start(): Managed {
    throw new Error('start is not expected in these tests');
  }
}

function makeClient(responses: ExecResult[]) {
  const config = makeConfig();
  const runner = new FakeRunner(responses);
  return {
    client: new TmuxClient(config, new Transport(config), runner),
    runner,
    config,
  };
}

function listLine(fields: {
  id: string;
  name: string;
  owned?: string;
  cwd?: string;
  cmd?: string;
  preview?: string;
}): string {
  return [
    fields.id,
    fields.name,
    '0',
    '1',
    '1700000000',
    fields.cwd ?? '/home/areche',
    fields.owned ?? '',
    fields.cmd ?? 'fish',
    fields.preview ?? '',
  ].join(FIELD_SEPARATOR);
}

describe('TmuxClient.listSessions', () => {
  it('parses the batched output', async () => {
    const { client } = makeClient([
      {
        code: 0,
        stdout: `${listLine({
          id: '$0',
          name: '0',
          owned: '1',
          cwd: '/home/areche/dev',
          preview: 'prompt>',
        })}\n`,
        stderr: '',
      },
    ]);

    const sessions = await client.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      name: '0',
      owned: true,
      cwd: '/home/areche/dev',
      preview: 'prompt>',
    });
  });

  it('returns an empty list when the server reports no sessions', async () => {
    const { client } = makeClient([{ code: 0, stdout: '', stderr: '' }]);
    await expect(client.listSessions()).resolves.toEqual([]);
  });

  it('reports an unreachable socket with the transport description', async () => {
    const { client, config } = makeClient([
      {
        code: 1,
        stdout: '',
        stderr: 'no server running on /tmp/tmux-1000/default',
      },
    ]);

    const error = await client.listSessions().catch((value: unknown) => value);
    expect(error).toMatchObject({ reason: 'unreachable' });
    expect((error as Error).message).toContain(config.socket);
  });
});

describe('TmuxClient.createSession', () => {
  it('refuses to touch a foreign session with the same name', async () => {
    const { client, runner } = makeClient([
      {
        code: 0,
        stdout: ['mcp', '$1', '0', '', '%5', 'bash', '/home/areche'].join(FIELD_SEPARATOR),
        stderr: '',
      },
    ]);

    await expect(client.createSession({ name: 'mcp' })).rejects.toMatchObject({
      reason: 'name_collision',
    });
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args.join(' ')).not.toContain('new-session');
  });

  it('returns an owned session unchanged', async () => {
    const { client } = makeClient([
      {
        code: 0,
        stdout: ['mcp', '$1', '0', '1', '%5', 'bash', '/home/areche'].join(FIELD_SEPARATOR),
        stderr: '',
      },
      {
        code: 0,
        stdout: `${listLine({ id: '$1', name: 'mcp', owned: '1' })}\n`,
        stderr: '',
      },
    ]);

    const created = await client.createSession({ name: 'mcp' });
    expect(created.session.name).toBe('mcp');
    expect(created.session.owned).toBe(true);
    expect(created.initialCommandSent).toBe(false);
  });

  it('rejects names that are not safe to own', async () => {
    const { client, runner } = makeClient([]);

    await expect(client.createSession({ name: 'bad name' })).rejects.toMatchObject({
      reason: 'invalid_argument',
    });
    expect(runner.calls).toHaveLength(0);
  });
});
