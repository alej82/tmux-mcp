import { commandBasename } from './config.js';
import type { ToolErrorReason } from './errors.js';
import { isSupportedShell } from './output.js';
import type { Target } from './types.js';

export type WriteTool = 'exec' | 'send_keys' | 'kill';

export interface GuardOptions {
  force: boolean;
  tool: WriteTool;
  selfPane?: string;
  protectedCommands: string[];
}

export interface GuardResult {
  allowed: boolean;
  reason?: ToolErrorReason;
  message?: string;
  forced: boolean;
}

function deny(reason: ToolErrorReason, message: string): GuardResult {
  return { allowed: false, reason, message, forced: false };
}

export function evaluateWrite(target: Target, options: GuardOptions): GuardResult {
  if (!target.session || !target.paneId) {
    return deny('not_shell', 'target session or pane could not be determined; refusing to write');
  }

  if (options.selfPane && target.paneId === options.selfPane) {
    return deny(
      'protected_pane',
      `pane ${target.paneId} hosts this server's container and is always protected`,
    );
  }

  if (!target.paneCommand || target.paneCommand.trim() === '') {
    return deny('not_shell', 'foreground command could not be determined; refusing to write');
  }

  const command = commandBasename(target.paneCommand);
  const protectedSet = new Set(options.protectedCommands.map((value) => value.toLowerCase()));
  if (protectedSet.has(command)) {
    return deny(
      'protected_agent',
      `pane runs '${command}', which is in the protected agent set`,
    );
  }

  if (options.tool === 'kill') {
    if (!target.owned && !options.force) {
      return deny('not_owned', `session '${target.session}' is not owned by tmux-mcp`);
    }
    return { allowed: true, forced: !target.owned && options.force };
  }

  const needs: Array<{ reason: ToolErrorReason; message: string }> = [];
  if (!target.owned) {
    needs.push({ reason: 'not_owned', message: 'session is not owned by tmux-mcp' });
  }
  if (target.attached > 0) {
    needs.push({ reason: 'attached', message: 'a client is attached to the session' });
  }
  if (!isSupportedShell(command)) {
    needs.push({
      reason: 'not_shell',
      message: `foreground command '${command}' is not a supported shell`,
    });
  }

  if (needs.length === 0) {
    return { allowed: true, forced: false };
  }

  if (options.force) {
    return { allowed: true, forced: true };
  }

  const primary = needs[0] as { reason: ToolErrorReason; message: string };
  return deny(
    primary.reason,
    `refusing to write to '${target.session}': ${needs.map((need) => need.message).join('; ')} (use force: true to override)`,
  );
}
