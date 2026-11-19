import { describe, expect, it } from 'vitest';

import { evaluateWrite, type GuardOptions } from '../src/guards.js';
import type { Target } from '../src/types.js';

const target: Target = {
  session: 'mcp',
  id: '$1',
  paneId: '%5',
  paneCommand: 'bash',
  attached: 0,
  owned: true,
  cwd: '/home/areche',
};

const base: GuardOptions = {
  force: false,
  tool: 'exec',
  selfPane: '%12',
  protectedCommands: ['opencode', 'claude', 'codex'],
};

describe('evaluateWrite', () => {
  it('allows an owned, detached shell session', () => {
    expect(evaluateWrite(target, base)).toEqual({ allowed: true, forced: false });
  });

  it('always refuses the pane hosting the container, even with force', () => {
    const result = evaluateWrite(
      { ...target, paneId: '%12' },
      { ...base, force: true },
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('protected_pane');
  });

  it('always refuses an agent pane, even with force', () => {
    const result = evaluateWrite(
      { ...target, paneCommand: 'opencode' },
      { ...base, force: true },
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('protected_agent');
  });

  it('matches protected commands case-insensitively', () => {
    const result = evaluateWrite(
      { ...target, paneCommand: '/usr/bin/OpenCode' },
      { ...base, force: true },
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('protected_agent');
  });

  it('requires force for a foreign session', () => {
    const foreign = { ...target, owned: false };
    const refused = evaluateWrite(foreign, base);
    const forced = evaluateWrite(foreign, { ...base, force: true });

    expect(refused.allowed).toBe(false);
    expect(refused.reason).toBe('not_owned');
    expect(forced.allowed).toBe(true);
    expect(forced.forced).toBe(true);
  });

  it('requires force for an attached session', () => {
    const result = evaluateWrite({ ...target, attached: 1 }, base);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('attached');
    expect(result.message).toContain('attached');
  });

  it('requires force for a non-shell foreground', () => {
    const result = evaluateWrite({ ...target, paneCommand: 'vim' }, base);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('not_shell');
  });

  it('fails closed when the foreground command is unknown', () => {
    const result = evaluateWrite({ ...target, paneCommand: '' }, { ...base, force: true });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('not_shell');
  });

  it('reports every failed condition in the refusal message', () => {
    const result = evaluateWrite(
      { ...target, owned: false, attached: 1, paneCommand: 'vim' },
      base,
    );

    expect(result.message).toContain('not owned');
    expect(result.message).toContain('attached');
    expect(result.message).toContain('not a supported shell');
  });

  it('applies the kill policy: owned always, foreign only with force', () => {
    const kill = { ...base, tool: 'kill' as const };

    expect(evaluateWrite(target, kill).allowed).toBe(true);
    expect(evaluateWrite({ ...target, attached: 4 }, kill).allowed).toBe(true);
    expect(evaluateWrite({ ...target, owned: false }, kill).allowed).toBe(false);
    expect(evaluateWrite({ ...target, owned: false }, { ...kill, force: true }).allowed).toBe(
      true,
    );
  });

  it('protects the self pane and agent panes from kill too', () => {
    const kill = { ...base, tool: 'kill' as const, force: true };

    expect(evaluateWrite({ ...target, paneId: '%12' }, kill).reason).toBe('protected_pane');
    expect(evaluateWrite({ ...target, paneCommand: 'claude' }, kill).reason).toBe(
      'protected_agent',
    );
  });
});
