#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { AuditLog } from './audit.js';
import { loadConfig } from './config.js';
import { ProcessRunner } from './executor.js';
import { SessionEngine } from './exec.js';
import { createServer } from './server.js';
import { TmuxClient } from './tmux.js';
import { Transport } from './transport.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const transport = new Transport(config);
  const runner = new ProcessRunner();
  const client = new TmuxClient(config, transport, runner);
  const audit = new AuditLog(config.auditFile);
  const engine = new SessionEngine(config, client, audit);
  const server = createServer(engine);

  await server.connect(new StdioServerTransport());
  console.error(`[tmux-mcp] ready (${transport.describe()})`);

  void client
    .assertReachable()
    .then((version) => {
      console.error(`[tmux-mcp] tmux ${version} reachable`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[tmux-mcp] warning: ${message}`);
    });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[tmux-mcp] fatal: ${message}`);
  process.exit(1);
});
