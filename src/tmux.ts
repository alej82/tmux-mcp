import { randomBytes } from 'node:crypto';

import { commandBasename, shellQuote, type Config } from './config.js';
import { ToolError } from './errors.js';
import {
  FIELD_SEPARATOR,
  SESSION_LIST_FORMAT,
  SESSION_LIST_SCRIPT,
  parseSessionListOutput,
  stripAnsi,
} from './output.js';
import type { Transport } from './transport.js';
import type { ExecResult, Managed, Runner, SessionSummary, Target } from './types.js';

const QUERY_TIMEOUT_MS = 15_000;
const SESSION_FORMAT = [
  '#{session_name}',
  '#{session_id}',
  '#{session_attached}',
  '#{@tmux_mcp_owned}',
  '#{pane_id}',
  '#{pane_current_command}',
  '#{session_path}',
].join(FIELD_SEPARATOR);

export interface CreatedSession {
  session: SessionSummary;
  initialCommandSent: boolean;
}

export class TmuxClient {
  constructor(
    private readonly config: Config,
    private readonly transport: Transport,
    private readonly runner: Runner,
  ) {}

  async listSessions(): Promise<SessionSummary[]> {
    const spec = this.transport.shell(SESSION_LIST_SCRIPT, [
      this.config.tmuxBin,
      this.config.socket,
      SESSION_LIST_FORMAT,
      this.config.preview ? '1' : '0',
    ]);
    const result = await this.runner.run(spec, 30_000);
    if (result.code !== 0) {
      this.fail(result, 'list sessions');
    }
    if (!result.stdout.trim()) return [];
    return parseSessionListOutput(result.stdout, { preview: this.config.preview });
  }

  async findSession(name: string): Promise<Target | null> {
    const result = await this.run([
      'display-message',
      '-p',
      '-t',
      `=${name}:`,
      SESSION_FORMAT,
    ]);
    if (result.code !== 0) {
      const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
      if (
        text.includes("can't find session") ||
        text.includes('no such session') ||
        text.includes('session not found') ||
        text.includes('no current target')
      ) {
        return null;
      }
      this.fail(result, `inspect session '${name}'`);
    }

    const line = result.stdout.split('\n')[0] ?? '';
    const parts = line.split(FIELD_SEPARATOR);
    if (parts.length < 7) {
      if (!line.trim()) return null;
      throw new ToolError('tmux_error', `could not parse session information for '${name}'`);
    }

    const [session, id, attached, owned, paneId, paneCommand, cwd] = parts.map((value) =>
      value.trim(),
    );
    if (!session || !id) {
      // tmux answers with empty fields when the exact target does not exist.
      return null;
    }
    if (!paneId) {
      throw new ToolError('tmux_error', `session '${name}' has no active pane`);
    }

    return {
      session,
      id,
      paneId,
      paneCommand: paneCommand ?? '',
      attached: Number(attached) || 0,
      owned: owned === '1',
      cwd: cwd ?? '',
    };
  }

  async createSession(options: {
    name: string;
    cwd?: string;
    shell?: string;
    command?: string;
  }): Promise<CreatedSession> {
    this.assertValidOwnedName(options.name);

    const existing = await this.findSession(options.name);
    if (existing) {
      if (existing.owned) {
        const summary = (await this.listSessions()).find((item) => item.name === existing.session);
        if (summary) {
          return { session: summary, initialCommandSent: false };
        }
      }
      throw new ToolError(
        'name_collision',
        `session '${options.name}' already exists and is not owned by tmux-mcp`,
      );
    }

    const cwd = options.cwd?.trim() || this.config.hostHome;
    if (!cwd.startsWith('/')) {
      throw new ToolError('invalid_argument', 'cwd must be an absolute path');
    }

    const shell = options.shell?.trim() || this.config.shell;
    if (!shell.startsWith('/')) {
      throw new ToolError('invalid_argument', 'shell must be an absolute path');
    }

    const shellCommand =
      commandBasename(shell) === 'bash'
        ? `${shellQuote(shell)} --noprofile --norc`
        : shellQuote(shell);

    const created = await this.run(
      ['new-session', '-d', '-s', options.name, '-c', cwd, shellCommand],
      20_000,
    );
    if (created.code !== 0) {
      this.fail(created, `create session '${options.name}'`);
    }

    try {
      await this.requireOk(
        ['set-option', '-t', `=${options.name}:`, '@tmux_mcp_owned', '1'],
        `mark session '${options.name}' as owned`,
      );
    } catch (error) {
      await this.run(['kill-session', '-t', `=${options.name}:`]).catch(() => undefined);
      throw error;
    }

    let initialCommandSent = false;
    if (options.command?.trim()) {
      await this.sendText(options.name, options.command, true);
      initialCommandSent = true;
    }

    const summary = (await this.listSessions()).find((item) => item.name === options.name);
    if (!summary) {
      throw new ToolError('tmux_error', `session '${options.name}' was created but cannot be read back`);
    }

    return { session: summary, initialCommandSent };
  }

  async killSession(name: string): Promise<void> {
    await this.requireOk(['kill-session', '-t', `=${name}:`], `kill session '${name}'`);
  }

  async sendText(name: string, text: string, enter: boolean): Promise<void> {
    const buffer = `tmux-mcp-${randomBytes(4).toString('hex')}`;
    try {
      await this.requireOk(
        ['set-buffer', '-b', buffer, '--', text],
        'load command buffer',
      );
      await this.requireOk(
        ['paste-buffer', '-p', '-b', buffer, '-t', `=${name}:`],
        `paste into session '${name}'`,
      );
      if (enter) {
        await this.requireOk(['send-keys', '-t', `=${name}:`, 'Enter'], 'submit command');
      }
    } finally {
      await this.run(['delete-buffer', '-b', buffer], 5_000).catch(() => undefined);
    }
  }

  async sendNamedKeys(name: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.requireOk(['send-keys', '-t', `=${name}:`, '--', key], `send key '${key}'`);
    }
  }

  async sendLiteral(name: string, text: string, enter: boolean): Promise<void> {
    await this.requireOk(
      ['send-keys', '-l', '-t', `=${name}:`, '--', text],
      'send literal text',
    );
    if (enter) {
      await this.requireOk(['send-keys', '-t', `=${name}:`, 'Enter'], 'submit literal text');
    }
  }

  async capture(name: string, lines: number, ansi: boolean): Promise<string> {
    const args = ['capture-pane', '-p', '-J', '-t', `=${name}:`, '-S', `-${lines}`];
    if (ansi) args.splice(3, 0, '-e');

    const result = await this.requireOk(args, `capture session '${name}'`, 30_000);
    const text = result.stdout.replace(/\r/g, '');
    const tail = text.split('\n').slice(-lines).join('\n');
    return ansi ? tail : stripAnsi(tail);
  }

  startWait(nonce: string, seconds: number): Managed {
    return this.runner.start(this.transport.wait(nonce, seconds), (seconds + 10) * 1_000);
  }

  async assertReachable(): Promise<string> {
    const result = await this.run(['display-message', '-p', '#{version}'], 10_000);
    if (result.code !== 0) {
      this.fail(result, 'contact tmux');
    }
    return result.stdout.trim();
  }

  private assertValidOwnedName(name: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) {
      throw new ToolError(
        'invalid_argument',
        'session names created by tmux-mcp must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}',
      );
    }
  }

  private async run(args: string[], timeoutMs = QUERY_TIMEOUT_MS): Promise<ExecResult> {
    return this.runner.run(this.transport.tmux(args), timeoutMs);
  }

  private async requireOk(
    args: string[],
    action: string,
    timeoutMs = QUERY_TIMEOUT_MS,
  ): Promise<ExecResult> {
    const result = await this.run(args, timeoutMs);
    if (result.code !== 0) {
      this.fail(result, action);
    }
    return result;
  }

  private fail(result: ExecResult, action: string): never {
    const detail = result.stderr.trim() || result.stdout.trim() || 'no output';
    const text = detail.toLowerCase();
    const socketProblem =
      text.includes('no server running') ||
      text.includes('error connecting') ||
      text.includes('connection refused') ||
      (text.includes('no such file') && detail.includes(this.config.socket));
    if (socketProblem || text.includes('not found')) {
      throw new ToolError(
        'unreachable',
        `cannot ${action}: ${detail} [${this.transport.describe()}]`,
      );
    }
    throw new ToolError('tmux_error', `${action} failed (${result.code ?? 'killed'}): ${detail}`);
  }
}
