import { readFileSync } from 'node:fs';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ToolError } from './errors.js';
import type { SessionEngine } from './exec.js';

export const SERVER_NAME = 'tmux-mcp';

function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const SERVER_VERSION = packageVersion();

export const toolSchemas = {
  listSessions: {},
  newSession: {
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
      .describe('Session name (letters, digits, dash, underscore)'),
    cwd: z.string().optional().describe('Absolute working directory (default: host home)'),
    shell: z.string().optional().describe('Absolute shell path (default: /usr/bin/bash)'),
    command: z.string().max(20_000).optional().describe('Optional command to type after creation'),
  },
  killSession: {
    session: z.string().min(1).describe('Session name'),
    force: z.boolean().optional().describe('Allow killing a foreign session'),
  },
  exec: {
    command: z.string().min(1).max(20_000).describe('Shell command to run'),
    session: z.string().optional().describe('Target session (default: owned session "mcp")'),
    timeout_ms: z
      .number()
      .int()
      .min(100)
      .max(300_000)
      .optional()
      .describe('Wait timeout in milliseconds (default: 30000)'),
    force: z
      .boolean()
      .optional()
      .describe('Allow writing to a foreign, attached, or non-shell target'),
  },
  sendKeys: {
    session: z.string().optional().describe('Target session (default: owned session "mcp")'),
    keys: z.array(z.string().min(1)).min(1).optional().describe('Named keys, e.g. ["C-c"]'),
    text: z.string().max(20_000).optional().describe('Literal text to insert'),
    enter: z.boolean().optional().describe('Press Enter after literal text'),
    force: z
      .boolean()
      .optional()
      .describe('Allow writing to a foreign, attached, or non-shell target'),
  },
  capture: {
    session: z.string().optional().describe('Target session (default: owned session "mcp")'),
    lines: z.number().int().min(1).max(5_000).optional().describe('Maximum lines (default: 200)'),
    ansi: z.boolean().optional().describe('Preserve ANSI escape sequences'),
  },
};

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function jsonResult(value: unknown): ToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

function errorResult(error: unknown): ToolResult {
  if (error instanceof ToolError) {
    return {
      isError: true,
      content: [{ type: 'text', text: `error [${error.reason}]: ${error.message}` }],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text', text: `error [internal]: ${message}` }],
  };
}

function metaResult(meta: Record<string, unknown>, output: string): ToolResult {
  return textResult(`${JSON.stringify(meta, null, 2)}\n--- output ---\n${output}`);
}

export function createServer(engine: SessionEngine): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'list_sessions',
    {
      title: 'List tmux sessions',
      description:
        'List every tmux/byobu session on the configured socket with its working directory, foreground command, attached clients, last activity, and a one-line preview. Read-only.',
      inputSchema: toolSchemas.listSessions,
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return jsonResult({ sessions: await engine.listSessions() });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'new_session',
    {
      title: 'Create an owned tmux session',
      description:
        'Create a detached session owned by tmux-mcp, with an optional working directory, shell, and initial command. If an owned session with that name exists it is returned unchanged; a foreign session with that name is never modified.',
      inputSchema: toolSchemas.newSession,
    },
    async (args) => {
      try {
        return jsonResult(await engine.newSession(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'kill_session',
    {
      title: 'Kill a tmux session',
      description:
        'Kill a session. Only sessions owned by tmux-mcp can be killed without force; the pane hosting this container and agent panes are always protected.',
      inputSchema: toolSchemas.killSession,
      annotations: { destructiveHint: true },
    },
    async (args) => {
      try {
        return jsonResult(await engine.killSession(args.session, args.force ?? false));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'exec',
    {
      title: 'Execute a command in a tmux session',
      description:
        'Type a command into a session, wait for it to finish (bounded by timeout_ms), and return the exit code and cleaned output. Defaults to the owned session "mcp". Foreign, attached, or non-shell targets require force: true. The default timeout is 30 seconds; on timeout the command is left running and the partial output is returned.',
      inputSchema: toolSchemas.exec,
    },
    async (args) => {
      try {
        const result = await engine.exec({
          command: args.command,
          session: args.session,
          timeoutMs: args.timeout_ms,
          force: args.force ?? false,
        });
        return metaResult(
          {
            session: result.session,
            exit_code: result.exit_code,
            timed_out: result.timed_out,
            truncated: result.truncated,
            duration_ms: result.duration_ms,
            recreated: result.recreated,
          },
          result.output,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'send_keys',
    {
      title: 'Send keys or literal text',
      description:
        'Send named tmux keys (C-c, Escape, Up, ...) or literal text to a session without shell interpretation. Enter is only pressed for literal text when enter is true. Defaults to the owned session "mcp"; other targets require force: true.',
      inputSchema: toolSchemas.sendKeys,
    },
    async (args) => {
      try {
        if (!args.keys?.length && args.text === undefined) {
          throw new ToolError('invalid_argument', 'provide keys or text');
        }
        if (args.keys?.length && args.text !== undefined) {
          throw new ToolError('invalid_argument', 'provide keys or text, not both');
        }
        return jsonResult(
          await engine.sendKeys({
            session: args.session,
            keys: args.keys,
            text: args.text,
            enter: args.enter ?? false,
            force: args.force ?? false,
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'capture',
    {
      title: 'Capture pane output',
      description:
        'Return the last lines of a session pane, with optional ANSI escapes. Read-only. Defaults to the owned session "mcp" if it exists.',
      inputSchema: toolSchemas.capture,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const result = await engine.capture({
          session: args.session,
          lines: args.lines ?? 200,
          ansi: args.ansi ?? false,
        });
        return metaResult(
          { session: result.session, truncated: result.truncated },
          result.output,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
