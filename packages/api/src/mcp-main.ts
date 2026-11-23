#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { clientFromEnv } from './client';
import { createMcpHandler, serveStdio } from './mcp';

// stdout chỉ dành cho giao thức; mọi thông báo khác ra stderr.
async function main(): Promise<void> {
  const handler = createMcpHandler({
    client: clientFromEnv(),
    readFile: (path) => readFile(path, 'utf8'),
    // 'wx': thất bại nếu file đã có. 0600: file cookie chỉ chủ máy đọc được.
    writeNewFile: (path, data) => writeFile(path, data, { flag: 'wx', mode: 0o600 }),
  });
  await serveStdio(handler, process.stdin, process.stdout);
}

main().catch((err: unknown) => {
  console.error(`browser-fingerprint MCP: ${err instanceof Error ? err.message : 'lỗi không rõ'}`);
  process.exitCode = 1;
});
