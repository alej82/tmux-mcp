import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { toolSchemas } from '../src/server.js';

const exec = z.object(toolSchemas.exec);
const newSession = z.object(toolSchemas.newSession);
const killSession = z.object(toolSchemas.killSession);
const sendKeys = z.object(toolSchemas.sendKeys);
const capture = z.object(toolSchemas.capture);

describe('tool schemas', () => {
  it('registers the six documented tools', () => {
    expect(Object.keys(toolSchemas).sort()).toEqual([
      'capture',
      'exec',
      'killSession',
      'listSessions',
      'newSession',
      'sendKeys',
    ]);
  });

  it('accepts a minimal exec and rejects invalid bounds', () => {
    expect(exec.safeParse({ command: 'ls' }).success).toBe(true);
    expect(exec.safeParse({ command: 'ls', timeout_ms: 30_000, force: true }).success).toBe(
      true,
    );
    expect(exec.safeParse({ command: '' }).success).toBe(false);
    expect(exec.safeParse({ command: 'ls', timeout_ms: 50 }).success).toBe(false);
    expect(exec.safeParse({ command: 'ls', timeout_ms: 300_001 }).success).toBe(false);
  });

  it('restricts owned session names', () => {
    expect(newSession.safeParse({ name: 'mcp-1' }).success).toBe(true);
    expect(newSession.safeParse({ name: '1mcp' }).success).toBe(true);
    expect(newSession.safeParse({ name: 'bad name' }).success).toBe(false);
    expect(newSession.safeParse({ name: '-nope' }).success).toBe(false);
    expect(newSession.safeParse({ name: 'x'.repeat(65) }).success).toBe(false);
  });

  it('requires a session to kill', () => {
    expect(killSession.safeParse({ session: 'mcp' }).success).toBe(true);
    expect(killSession.safeParse({}).success).toBe(false);
  });

  it('accepts keys or text for send_keys', () => {
    expect(sendKeys.safeParse({ keys: ['C-c'] }).success).toBe(true);
    expect(sendKeys.safeParse({ text: 'ls', enter: true }).success).toBe(true);
    expect(sendKeys.safeParse({ keys: [] }).success).toBe(false);
  });

  it('bounds capture lines', () => {
    expect(capture.safeParse({ lines: 200 }).success).toBe(true);
    expect(capture.safeParse({ lines: 0 }).success).toBe(false);
    expect(capture.safeParse({ lines: 5_001 }).success).toBe(false);
  });
});
