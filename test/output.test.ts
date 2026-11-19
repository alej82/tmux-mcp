import { describe, expect, it } from 'vitest';

import {
  FIELD_SEPARATOR,
  capText,
  extractMarkedOutput,
  isSupportedShell,
  parseSessionListOutput,
  statusVariableFor,
  stripAnsi,
} from '../src/output.js';

function sessionLine(fields: {
  id: string;
  name: string;
  attached?: string;
  windows?: string;
  activity?: string;
  cwd?: string;
  owned?: string;
  cmd?: string;
  preview?: string;
}): string {
  return [
    fields.id,
    fields.name,
    fields.attached ?? '0',
    fields.windows ?? '1',
    fields.activity ?? '1700000000',
    fields.cwd ?? '/home/areche',
    fields.owned ?? '',
    fields.cmd ?? 'fish',
    fields.preview ?? '',
  ].join(FIELD_SEPARATOR);
}

describe('parseSessionListOutput', () => {
  it('parses sessions with ownership and preview', () => {
    const sessions = parseSessionListOutput(
      sessionLine({
        id: '$0',
        name: '0',
        attached: '1',
        cwd: '/home/areche/dev/core_fct_api',
        owned: '1',
        preview: "areche@host ~/d/core [124]>",
      }),
      { preview: true },
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      name: '0',
      id: '$0',
      owned: true,
      attached: 1,
      windows: 1,
      cwd: '/home/areche/dev/core_fct_api',
      cmd: 'fish',
      preview: 'areche@host ~/d/core [124]>',
      attach_cmd: "tmux attach -t '0'",
    });
    expect(sessions[0]?.activity).toBe('2023-11-14T22:13:20.000Z');
  });

  it('returns an empty list for empty output', () => {
    expect(parseSessionListOutput('', { preview: true })).toEqual([]);
  });

  it('omits the preview when disabled', () => {
    const sessions = parseSessionListOutput(
      sessionLine({ id: '$1', name: '1', preview: 'secret-token' }),
      { preview: false },
    );

    expect(sessions[0]?.preview).toBeNull();
  });

  it('strips ANSI from the preview', () => {
    const sessions = parseSessionListOutput(
      sessionLine({ id: '$1', name: '1', preview: '\u001b[31mred\u001b[0m' }),
      { preview: true },
    );

    expect(sessions[0]?.preview).toBe('red');
  });

  it('ignores malformed lines', () => {
    expect(parseSessionListOutput('garbage\n', { preview: true })).toEqual([]);
  });
});

describe('extractMarkedOutput', () => {
  const nonce = 'n1';

  it('extracts between the markers and reads the exit code', () => {
    const raw = [
      'echo wrapper',
      `__TMUX_MCP_START_${nonce}__`,
      'hello',
      '',
      `__TMUX_MCP_DONE_${nonce}__ rc=7`,
      'prompt>',
    ].join('\n');

    const result = extractMarkedOutput(raw, nonce);
    expect(result.output).toBe('hello');
    expect(result.exitCode).toBe(7);
    expect(result.foundStart).toBe(true);
    expect(result.foundEnd).toBe(true);
  });

  it('ignores markers from a different nonce', () => {
    const raw = [
      '__TMUX_MCP_START_other__',
      'noise',
      `__TMUX_MCP_START_${nonce}__`,
      'real',
      `__TMUX_MCP_DONE_${nonce}__ rc=0`,
    ].join('\n');

    expect(extractMarkedOutput(raw, nonce).output).toBe('real');
  });

  it('returns the tail when the start marker scrolled away', () => {
    const raw = ['old', 'output', `__TMUX_MCP_DONE_${nonce}__ rc=0`].join('\n');
    const result = extractMarkedOutput(raw, nonce);

    expect(result.output).toBe('old\noutput');
    expect(result.exitCode).toBe(0);
    expect(result.foundStart).toBe(false);
  });

  it('returns partial output when the command did not finish', () => {
    const raw = [`__TMUX_MCP_START_${nonce}__`, 'still running'].join('\n');
    const result = extractMarkedOutput(raw, nonce);

    expect(result.output).toBe('still running');
    expect(result.exitCode).toBeNull();
    expect(result.foundEnd).toBe(false);
  });

  it('handles CRLF and ANSI output', () => {
    const raw = [
      `__TMUX_MCP_START_${nonce}__\r`,
      '\u001b[32mgreen\u001b[0m\r',
      `__TMUX_MCP_DONE_${nonce}__ rc=0\r`,
    ].join('\n');

    expect(extractMarkedOutput(raw, nonce).output).toBe('green');
  });
});

describe('capText', () => {
  it('keeps the last lines and flags truncation', () => {
    const result = capText('a\nb\nc\nd\ne', 3, 65_536);

    expect(result.text).toBe('c\nd\ne');
    expect(result.truncated).toBe(true);
  });

  it('keeps the last bytes and flags truncation', () => {
    const result = capText('aaaa\nbbbb', 10, 6);

    expect(result.text).toBe('bbbb');
    expect(result.truncated).toBe(true);
  });

  it('does not flag small output', () => {
    const result = capText('one\ntwo', 10, 65_536);

    expect(result.text).toBe('one\ntwo');
    expect(result.truncated).toBe(false);
  });
});

describe('shell helpers', () => {
  it('maps fish to its own status variable', () => {
    expect(statusVariableFor('fish')).toBe('$status');
    expect(statusVariableFor('/usr/bin/fish')).toBe('$status');
  });

  it('maps POSIX shells to the exit status', () => {
    expect(statusVariableFor('bash')).toBe('$?');
    expect(statusVariableFor('/usr/bin/zsh')).toBe('$?');
  });

  it('recognizes supported shells', () => {
    expect(isSupportedShell('/usr/bin/bash')).toBe(true);
    expect(isSupportedShell('fish')).toBe(true);
    expect(isSupportedShell('vim')).toBe(false);
  });

  it('strips ANSI escapes', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red');
  });
});
