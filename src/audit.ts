import { appendFile, chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { ToolError } from './errors.js';

export interface AuditRecord {
  tool: string;
  session: string;
  forced: boolean;
  outcome: 'ok' | 'refused' | 'timeout' | 'error';
  reason?: string;
  command?: string;
  exitCode?: number | null;
}

function truncate(value: string, limit = 300): string {
  const singleLine = value.replace(/\r?\n/g, '\\n');
  return singleLine.length > limit ? `${singleLine.slice(0, limit)}...` : singleLine;
}

export class AuditLog {
  constructor(private readonly file: string) {}

  async append(record: AuditRecord): Promise<void> {
    const line = `${JSON.stringify({
      ts: new Date().toISOString(),
      tool: record.tool,
      session: record.session,
      forced: record.forced,
      outcome: record.outcome,
      reason: record.reason,
      command: record.command === undefined ? undefined : truncate(record.command),
      exitCode: record.exitCode,
    })}\n`;

    try {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      await appendFile(this.file, line, { encoding: 'utf8', mode: 0o600 });
      await chmod(this.file, 0o600);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ToolError('audit_unavailable', `could not write audit log ${this.file}: ${message}`);
    }
  }
}
