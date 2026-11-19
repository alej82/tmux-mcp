import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type { CommandSpec, ExecResult, Managed, Runner } from './types.js';

const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export class ProcessRunner implements Runner {
  run(spec: CommandSpec, timeoutMs?: number): Promise<ExecResult> {
    return this.start(spec, timeoutMs).done;
  }

  start(spec: CommandSpec, timeoutMs?: number): Managed {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(spec.file, spec.args, {
        env: spec.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        done: Promise.resolve({ code: 127, stdout: '', stderr: message }),
        kill: () => {},
      };
    }

    let settled = false;
    let timedOut = false;
    let killedForSize = false;
    let stdout = '';
    let stderr = '';

    let resolveDone: (result: ExecResult) => void;
    const done = new Promise<ExecResult>((resolve) => {
      resolveDone = resolve;
    });

    const finish = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveDone(result);
    };

    const kill = () => {
      if (!child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    };

    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            kill();
          }, timeoutMs)
        : null;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES) {
        killedForSize = true;
        kill();
      }
    });

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT_BYTES) {
        killedForSize = true;
        kill();
      }
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      const message = error.code === 'ENOENT' ? `${spec.file}: not found` : error.message;
      finish({ code: error.code === 'ENOENT' ? 127 : null, stdout, stderr: message });
    });

    child.on('close', (code) => {
      const note = killedForSize ? 'output limit exceeded' : '';
      finish({
        code: timedOut ? 124 : code,
        stdout,
        stderr: [stderr, note].filter(Boolean).join('\n'),
        timedOut,
      });
    });

    if (spec.stdin !== undefined) {
      child.stdin.end(spec.stdin);
    } else {
      child.stdin.end();
    }

    return { done, kill };
  }
}
