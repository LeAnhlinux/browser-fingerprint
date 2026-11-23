import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../../src/mcp';
import { type ApiServer, startApiServer } from '../../src/server';
import { COOKIE_SECRET, TOKEN, fakeCore } from '../helpers';

const MCP_MAIN = join(__dirname, '..', '..', 'dist', 'mcp-main.js');

let server: ApiServer;
let client: Client;
let tmp: string;

beforeAll(async () => {
  if (!existsSync(MCP_MAIN)) throw new Error('Chưa build: chạy pnpm --filter @bf/api build trước');
  tmp = mkdtempSync(join(tmpdir(), 'bf-mcp-interop-'));
  const tokenFile = join(tmp, 'api-token');
  writeFileSync(tokenFile, TOKEN);
  server = await startApiServer({ core: fakeCore(), token: TOKEN, port: 0 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_MAIN],
    env: { ...(process.env as Record<string, string>), BF_API_PORT: String(server.port), BF_API_TOKEN_FILE: tokenFile },
  });
  client = new Client({ name: 'bf-interop-test', version: '1.0.0' });
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

const textOf = (result: unknown): string => ((result as { content: { text: string }[] }).content[0]?.text ?? '');

describe('máy khách MCP chính thức nói chuyện được với mcp-main', () => {
  it('bắt tay và liệt kê đủ công cụ', async () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'browser-fingerprint' });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOL_NAMES);
  });

  it('gọi công cụ: tạo hồ sơ, liệt kê, khởi động lấy cdpUrl', async () => {
    const created = JSON.parse(textOf(await client.callTool({ name: 'create_profile', arguments: { name: 'mcp-1' } })));
    expect(created).toMatchObject({ name: 'mcp-1' });
    const listed = JSON.parse(textOf(await client.callTool({ name: 'list_profiles', arguments: {} })));
    expect(listed).toHaveLength(1);
    const started = JSON.parse(textOf(await client.callTool({ name: 'start_profile', arguments: { id: created.id, headless: true } })));
    expect(started.cdpUrl).toMatch(/^ws:\/\//);
  });

  it('lỗi công cụ đến máy khách dưới dạng isError', async () => {
    const result = (await client.callTool({ name: 'get_profile', arguments: { id: 'khong-co' } })) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Không tìm thấy hồ sơ');
  });

  it('export_cookies ghi file và không đưa giá trị cookie qua giao thức', async () => {
    const created = JSON.parse(textOf(await client.callTool({ name: 'create_profile', arguments: { name: 'mcp-2' } })));
    const file = join(tmp, 'out.json');
    const result = await client.callTool({ name: 'export_cookies', arguments: { id: created.id, filePath: file } });
    expect(JSON.parse(textOf(result))).toEqual({ count: 1, filePath: file });
    expect(JSON.stringify(result)).not.toContain(COOKIE_SECRET);
    expect(existsSync(file)).toBe(true);
  });
});
