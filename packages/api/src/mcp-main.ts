#!/usr/bin/env node
import { clientFromEnv } from './client';
import { createMcpHandler, serveStdio } from './mcp';
import { mcpFilesDir } from './token';

// stdout chỉ dành cho giao thức; mọi thông báo khác ra stderr.
async function main(): Promise<void> {
  const handler = createMcpHandler({ client: clientFromEnv(), filesDir: mcpFilesDir() });
  await serveStdio(handler, process.stdin, process.stdout);
}

main().catch((err: unknown) => {
  console.error(`browser-fingerprint MCP: ${err instanceof Error ? err.message : 'lỗi không rõ'}`);
  process.exitCode = 1;
});
