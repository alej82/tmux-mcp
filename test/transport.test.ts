import { describe, expect, it } from 'vitest';

import { Transport } from '../src/transport.js';
import { makeConfig } from './helpers.js';

describe('Transport (host mode)', () => {
  const transport = new Transport(makeConfig());

  it('invokes the host executor with a sanitized env and explicit socket', () => {
    const spec = transport.tmux(['list-sessions']);

    expect(spec.file).toBe('host-spawn');
    expect(spec.args).toEqual([
      '/usr/bin/env',
      '-i',
      'HOME=/home/areche',
      'PATH=/usr/local/bin:/usr/bin:/bin',
      'LANG=C.UTF-8',
      '/usr/bin/tmux',
      '-S',
      '/tmp/tmux-1000/default',
      'list-sessions',
    ]);
  });

  it('never uses a login or interactive shell', () => {
    const spec = transport.shell('echo ok', ['arg']);

    expect(spec.args).toEqual([
      '/usr/bin/env',
      '-i',
      'HOME=/home/areche',
      'PATH=/usr/local/bin:/usr/bin:/bin',
      'LANG=C.UTF-8',
      '/bin/sh',
      '-c',
      'echo ok',
      'sh',
      'arg',
    ]);
    expect(spec.args).not.toContain('-l');
    expect(spec.args).not.toContain('-lc');
    expect(spec.args).not.toContain('bash');
  });

  it('passes a hostile session name as a single argument', () => {
    const hostile = '=a; rm -rf / #';
    const spec = transport.tmux(['set-option', '-t', hostile, '@x', '1']);

    expect(spec.args.filter((value) => value === hostile)).toHaveLength(1);
    expect(spec.args).not.toContain('rm');
  });

  it('builds a bounded wait command', () => {
    const spec = transport.wait('abc123', 1.25);

    expect(spec.args).toEqual([
      '/usr/bin/env',
      '-i',
      'HOME=/home/areche',
      'PATH=/usr/local/bin:/usr/bin:/bin',
      'LANG=C.UTF-8',
      '/usr/bin/timeout',
      '1.25s',
      '/usr/bin/tmux',
      '-S',
      '/tmp/tmux-1000/default',
      'wait-for',
      'abc123',
    ]);
  });

  it('describes the transport for diagnostics', () => {
    expect(transport.describe()).toContain('mode=host');
    expect(transport.describe()).toContain('executor=host-spawn');
    expect(transport.describe()).toContain('/tmp/tmux-1000/default');
  });
});

describe('Transport (direct mode)', () => {
  const config = makeConfig({ hostExec: null, hostHome: '/home/areche' });
  const transport = new Transport(config);

  it('invokes tmux directly with a sanitized environment', () => {
    const spec = transport.tmux(['list-sessions']);

    expect(spec.file).toBe('/usr/bin/tmux');
    expect(spec.args).toEqual(['-S', '/tmp/tmux-1000/default', 'list-sessions']);
    expect(spec.env).toEqual({
      HOME: '/home/areche',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'C.UTF-8',
    });
    expect(spec.env).not.toHaveProperty('TMUX');
    expect(spec.env).not.toHaveProperty('TMUX_PANE');
  });

  it('falls back to a direct wait when timeout is unavailable', () => {
    const noTimeout = new Transport(makeConfig({ hostExec: null, waitBin: null }));
    const spec = noTimeout.wait('n1', 1);

    expect(spec.file).toBe('/usr/bin/tmux');
    expect(spec.args).toEqual([
      '-S',
      '/tmp/tmux-1000/default',
      'wait-for',
      'n1',
    ]);
  });
});
