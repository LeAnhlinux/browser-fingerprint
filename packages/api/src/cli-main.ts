#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { runCli, writePrivateFile } from './cli';
import { clientFromEnv } from './client';

async function main(): Promise<number> {
  let client;
  try {
    client = clientFromEnv();
  } catch (e) {
    console.error(`Lỗi: ${e instanceof Error ? e.message : 'không rõ'}`);
    return 2;
  }
  return runCli(process.argv.slice(2), {
    client,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    readFile: (path) => readFile(path, 'utf8'),
    // File cookie chứa phiên đăng nhập: luôn 0600, kể cả khi ghi đè file cũ.
    writeFile: writePrivateFile,
  });
}

void main().then((code) => {
  process.exitCode = code;
});
