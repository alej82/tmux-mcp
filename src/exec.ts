import { randomBytes } from 'node:crypto';

import type { AuditLog } from './audit.js';
import type { Config } from './config.js';
import { ToolError } from './errors.js';
import { capText, extractMarkedOutput, statusVariableFor } from './output.js';
import { evaluateWrite, type GuardResult, type WriteTool } from './guards.js';
import type { TmuxClient } from './tmux.js';
import type {
  CaptureOptions,
  ExecOptions,
  ExecOutcome,
  NewSessionOptions,
  SendKeysOptions,
  SessionSummary,
  Target,
} from './types.js';
import { shellQuote } from './config.js';

const CAPTURE_WINDOW = 5_000;
const WAIT_REGISTRATION_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CapturedOutput {
  session: string;
  output: string;
  truncated: boolean;
}

export class SessionEngine {
  private readonly busy = new Set<string>();
  private readonly selfPane = process.env.TMUX_PANE?.trim() || undefined;

  constructor(
    private readonly config: Config,
    private readonly client: TmuxClient,
    private readonly audit: AuditLog,
  ) {}

  async listSessions(): Promise<SessionSummary[]> {
    return this.client.listSessions();
  }

  async exec(options: ExecOptions): Promise<ExecOutcome> {
    const command = options.command;
    if (!command.trim()) {
      throw new ToolError('invalid_argument', 'command must not be empty');
    }

    const { target, recreated } = await this.resolveTarget(options.session);
    const guard = this.checkGuards(target, 'exec', options.force);
    if (!guard.allowed) {
      await this.audit.append({
        tool: 'exec',
        session: target.session,
        forced: false,
        outcome: 'refused',
        reason: guard.reason,
        command,
      });
      throw new ToolError(guard.reason ?? 'tmux_error', guard.message ?? 'write refused');
    }

    let release: (() => void) | null = null;
    const nonce = randomBytes(8).toString('hex');
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? this.config.timeoutMs, 100), 300_000);
    const waitSeconds = (timeoutMs + 250) / 1_000;
    const started = Date.now();

    let waiter: ReturnType<TmuxClient['startWait']> | null = null;
    let waiterFinished = false;

    try {
      release = this.acquire(target.session);
      waiter = this.client.startWait(nonce, waitSeconds);
      waiter.done.then(
        () => {
          waiterFinished = true;
        },
        () => {
          waiterFinished = true;
        },
      );

      await delay(WAIT_REGISTRATION_MS);
      await this.client.sendText(target.session, this.wrapper(nonce, command, target.paneCommand), true);

      await waiter.done;
      const raw = await this.client.capture(target.session, CAPTURE_WINDOW, false);
      const extracted = extractMarkedOutput(raw, nonce);
      const finished = extracted.foundEnd && extracted.exitCode !== null;
      const timedOut = !finished;

      const capped = capText(extracted.output, this.config.maxLines, this.config.maxBytes);
      const truncated = !extracted.foundStart || !extracted.foundEnd || capped.truncated;

      const outcome: ExecOutcome = {
        session: target.session,
        exit_code: finished ? extracted.exitCode : null,
        timed_out: timedOut,
        truncated,
        duration_ms: Date.now() - started,
        output: capped.text,
        recreated,
      };

      await this.audit.append({
        tool: 'exec',
        session: target.session,
        forced: guard.forced,
        outcome: timedOut ? 'timeout' : 'ok',
        command,
        exitCode: outcome.exit_code,
      });

      return outcome;
    } catch (error) {
      await this.audit.append({
        tool: 'exec',
        session: target.session,
        forced: guard.forced,
        outcome: 'error',
        reason: error instanceof ToolError ? error.reason : 'error',
        command,
      });
      throw error;
    } finally {
      if (waiter && !waiterFinished) {
        waiter.kill();
      }
      release?.();
    }
  }

  async sendKeys(options: SendKeysOptions): Promise<{ session: string; sent: boolean }> {
    const { target } = await this.resolveTarget(options.session);
    const guard = this.checkGuards(target, 'send_keys', options.force);
    if (!guard.allowed) {
      await this.audit.append({
        tool: 'send_keys',
        session: target.session,
        forced: false,
        outcome: 'refused',
        reason: guard.reason,
        command: options.keys?.join(' ') ?? options.text,
      });
      throw new ToolError(guard.reason ?? 'tmux_error', guard.message ?? 'write refused');
    }

    let release: (() => void) | null = null;
    try {
      release = this.acquire(target.session);
      if (options.keys && options.keys.length > 0) {
        await this.client.sendNamedKeys(target.session, options.keys);
      } else if (options.text !== undefined) {
        await this.client.sendLiteral(target.session, options.text, options.enter);
      } else {
        throw new ToolError('invalid_argument', 'provide keys or text');
      }

      await this.audit.append({
        tool: 'send_keys',
        session: target.session,
        forced: guard.forced,
        outcome: 'ok',
        command: options.keys?.join(' ') ?? options.text,
      });
      return { session: target.session, sent: true };
    } catch (error) {
      await this.audit.append({
        tool: 'send_keys',
        session: target.session,
        forced: guard.forced,
        outcome: 'error',
        reason: error instanceof ToolError ? error.reason : 'error',
        command: options.keys?.join(' ') ?? options.text,
      });
      throw error;
    } finally {
      release?.();
    }
  }

  async capture(options: CaptureOptions): Promise<CapturedOutput> {
    const name = options.session?.trim() || this.config.defaultSession;
    const target = await this.client.findSession(name);
    if (!target) {
      throw new ToolError('not_found', `session '${name}' does not exist`);
    }

    const lines = Math.min(Math.max(options.lines, 1), CAPTURE_WINDOW);
    const raw = await this.client.capture(target.session, lines, options.ansi);
    const capped = capText(raw, this.config.maxLines, this.config.maxBytes);
    return {
      session: target.session,
      output: capped.text,
      truncated: capped.truncated,
    };
  }

  async newSession(options: NewSessionOptions): Promise<{
    session: SessionSummary;
    initial_command_sent: boolean;
  }> {
    try {
      const created = await this.client.createSession(options);
      await this.audit.append({
        tool: 'new_session',
        session: created.session.name,
        forced: false,
        outcome: 'ok',
        command: options.command,
      });
      return {
        session: created.session,
        initial_command_sent: created.initialCommandSent,
      };
    } catch (error) {
      await this.audit
        .append({
          tool: 'new_session',
          session: options.name,
          forced: false,
          outcome: 'error',
          reason: error instanceof ToolError ? error.reason : 'error',
        })
        .catch(() => undefined);
      throw error;
    }
  }

  async killSession(name: string, force: boolean): Promise<{ session: string; killed: boolean }> {
    const target = await this.client.findSession(name);
    if (!target) {
      throw new ToolError('not_found', `session '${name}' does not exist`);
    }

    const guard = this.checkGuards(target, 'kill', force);
    if (!guard.allowed) {
      await this.audit.append({
        tool: 'kill_session',
        session: target.session,
        forced: false,
        outcome: 'refused',
        reason: guard.reason,
      });
      throw new ToolError(guard.reason ?? 'tmux_error', guard.message ?? 'write refused');
    }

    let release: (() => void) | null = null;
    try {
      release = this.acquire(target.session);
      await this.client.killSession(target.session);
      await this.audit.append({
        tool: 'kill_session',
        session: target.session,
        forced: guard.forced,
        outcome: 'ok',
      });
      return { session: target.session, killed: true };
    } catch (error) {
      await this.audit
        .append({
          tool: 'kill_session',
          session: target.session,
          forced: guard.forced,
          outcome: 'error',
          reason: error instanceof ToolError ? error.reason : 'error',
        })
        .catch(() => undefined);
      throw error;
    } finally {
      release?.();
    }
  }

  private async resolveTarget(
    requestedName?: string,
  ): Promise<{ target: Target; recreated: boolean }> {
    const explicit = requestedName?.trim();
    const name = explicit || this.config.defaultSession;

    let target = await this.client.findSession(name);
    let recreated = false;

    if (!target) {
      if (explicit && explicit !== this.config.defaultSession) {
        throw new ToolError('not_found', `session '${name}' does not exist`);
      }
      const created = await this.client.createSession({ name });
      target = await this.client.findSession(created.session.name);
      if (!target) {
        throw new ToolError('tmux_error', `session '${name}' could not be created`);
      }
      recreated = true;
    }

    return { target, recreated };
  }

  private checkGuards(target: Target, tool: WriteTool, force: boolean): GuardResult {
    return evaluateWrite(target, {
      force,
      tool,
      selfPane: this.selfPane,
      protectedCommands: this.config.protectedCommands,
    });
  }

  private acquire(session: string): () => void {
    if (this.busy.has(session)) {
      throw new ToolError(
        'busy',
        `another write is in progress for session '${session}'; retry when it finishes`,
      );
    }
    this.busy.add(session);
    return () => {
      this.busy.delete(session);
    };
  }

  private wrapper(nonce: string, command: string, paneCommand: string): string {
    const status = statusVariableFor(paneCommand);
    return [
      `printf '\\n__TMUX_MCP_START_${nonce}__\\n'`,
      command,
      `printf '\\n__TMUX_MCP_DONE_${nonce}__ rc=%s\\n' "${status}"`,
      `${shellQuote(this.config.tmuxBin)} -S ${shellQuote(this.config.socket)} wait-for -S ${nonce}`,
    ].join('\n');
  }
}
