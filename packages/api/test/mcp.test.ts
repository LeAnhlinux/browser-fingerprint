import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client';
import { MAX_COOKIE_FILE_BYTES, TOOL_NAMES, createMcpHandler, readCookieFile, serveStdio } from '../src/mcp';
import { type ApiServer, startApiServer } from '../src/server';
import { COOKIE_SECRET, type FakeCore, TOKEN, fakeCore } from './helpers';

let core: FakeCore;
let server: ApiServer;
let files: Map<string, string>;
let handle: (message: unknown) => Promise<unknown | null>;

beforeEach(async () => {
  core = fakeCore();
  server = await startApiServer({ core, token: TOKEN, port: 0 });
  files = new Map();
  handle = createMcpHandler({
    client: new ApiClient({ token: TOKEN, port: server.port }),
    readFile: async (path) => {
      const data = files.get(path);
      if (data === undefined) throw new Error('ENOENT');
      return data;
    },
    writeNewFile: async (path, data) => {
      if (files.has(path)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      files.set(path, data);
    },
  });
});

afterEach(async () => {
  await server.close();
});

let seq = 0;
const rpc = (method: string, params?: unknown): Promise<any> => handle({ jsonrpc: '2.0', id: ++seq, method, ...(params === undefined ? {} : { params }) });
const call = async (name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean; data: any }> => {
  const res = await rpc('tools/call', { name, arguments: args });
  expect(res.error, JSON.stringify(res.error)).toBeUndefined();
  const text = res.result.content[0].text as string;
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { text, isError: res.result.isError === true, data };
};

describe('MCP: giao thức', () => {
  it('initialize trả phiên bản máy khách yêu cầu nếu biết, không thì bản mới nhất mình biết', async () => {
    const res = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(res).toMatchObject({ jsonrpc: '2.0', id: seq, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'browser-fingerprint' } } });
    expect((await rpc('initialize', { protocolVersion: '2099-01-01' })).result.protocolVersion).toBe('2025-06-18');
    expect((await rpc('initialize')).result.protocolVersion).toBe('2025-06-18');
  });

  it('ping trả đối tượng rỗng; thông báo không được trả lời', async () => {
    expect((await rpc('ping')).result).toEqual({});
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/khong-biet', params: {} })).toBeNull();
    expect(await handle({ jsonrpc: '2.0', id: 9, result: {} })).toBeNull();
  });

  it('phương thức lạ, thông điệp sai dạng và công cụ lạ là lỗi JSON-RPC', async () => {
    expect((await rpc('resources/list')).error).toMatchObject({ code: -32601 });
    expect(await handle({ id: 1, method: 'ping' })).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: -32600 } });
    expect(await handle('xin chào')).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600 } });
    expect(await handle([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).toMatchObject({ id: null, error: { code: -32600 } });
    expect((await rpc('tools/call', { name: 'khong_co', arguments: {} })).error).toMatchObject({ code: -32602 });
    expect((await rpc('tools/call', { arguments: {} })).error).toMatchObject({ code: -32602 });
  });

  it('tools/list liệt kê đủ công cụ, mỗi công cụ có mô tả và inputSchema kiểu object', async () => {
    const { tools } = (await rpc('tools/list')).result;
    expect(tools.map((t: { name: string }) => t.name)).toEqual(TOOL_NAMES);
    expect(TOOL_NAMES).toEqual([
      'list_profiles', 'get_profile', 'create_profile', 'update_profile', 'delete_profile', 'start_profile',
      'stop_profile', 'import_cookies', 'export_cookies', 'list_groups', 'list_proxies', 'check_proxy',
    ]);
    for (const t of tools) {
      expect(typeof t.description, t.name).toBe('string');
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.inputSchema, t.name).toMatchObject({ type: 'object' });
      for (const required of t.inputSchema.required ?? []) expect(Object.keys(t.inputSchema.properties), t.name).toContain(required);
    }
    expect(tools.find((t: { name: string }) => t.name === 'delete_profile').annotations).toMatchObject({ destructiveHint: true });
    expect(tools.find((t: { name: string }) => t.name === 'list_profiles').annotations).toMatchObject({ readOnlyHint: true });
  });
});

describe('MCP: công cụ', () => {
  it('tạo, liệt kê, xem, sửa, khởi động, dừng, xoá hồ sơ', async () => {
    const created = await call('create_profile', { name: 'IG-01', groupId: 'g1', timezone: 'Asia/Tokyo' });
    expect(created.data).toMatchObject({ id: 'p1', name: 'IG-01' });
    expect(core.calls[0]).toEqual(['createProfile', { name: 'IG-01', groupId: 'g1', timezone: 'Asia/Tokyo' }]);
    expect((await call('list_profiles')).data).toHaveLength(1);
    expect((await call('list_profiles', { search: 'khong-khop' })).data).toEqual([]);
    expect((await call('get_profile', { id: 'p1' })).data).toMatchObject({ name: 'IG-01' });
    expect((await call('update_profile', { id: 'p1', name: 'IG-02', proxyId: null })).data).toMatchObject({ name: 'IG-02' });
    expect(core.calls.at(-1)).toEqual(['updateProfile', 'p1', { name: 'IG-02', proxyId: null }]);
    const started = await call('start_profile', { id: 'p1', headless: true });
    expect(started.data).toMatchObject({ cdpUrl: 'ws://127.0.0.1:9333/devtools/browser/abc', headless: true });
    expect((await call('stop_profile', { id: 'p1' })).data).toEqual({ ok: true });
    expect((await call('delete_profile', { id: 'p1' })).data).toEqual({ ok: true });
  });

  it('lỗi của app và tham số thiếu là kết quả isError, không phải lỗi giao thức', async () => {
    const missing = await call('get_profile', { id: 'zz' });
    expect(missing).toMatchObject({ isError: true, text: 'Không tìm thấy hồ sơ' });
    expect(await call('get_profile')).toMatchObject({ isError: true, text: 'Thiếu tham số: id' });
    expect(await call('create_profile', { name: 5 })).toMatchObject({ isError: true, text: 'Thiếu tham số: name' });
    expect(await call('start_profile', { id: 'zz', headless: 'có' })).toMatchObject({ isError: true, text: 'Tham số headless phải là true hoặc false' });
    expect(await call('create_profile', { name: 'a', seed: 1 })).toMatchObject({ isError: true, text: 'Tham số không được hỗ trợ: seed' });
  });

  it('lỗi lập trình không lộ chi tiết trong kết quả', async () => {
    const leaky = createMcpHandler({
      client: { listGroups: () => { throw new Error('chi tiết nội bộ bí mật'); } } as unknown as ApiClient,
      readFile: async () => '',
      writeNewFile: async () => {},
    });
    const res: any = await leaky({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_groups' } });
    expect(res.result).toMatchObject({ isError: true, content: [{ text: 'Lỗi nội bộ của MCP server' }] });
  });

  it('export_cookies ghi ra file và không trả giá trị cookie về cho mô hình', async () => {
    await call('create_profile', { name: 'a' });
    const res = await call('export_cookies', { id: 'p1', filePath: '/tmp/out.json' });
    expect(res.data).toEqual({ count: 1, filePath: '/tmp/out.json' });
    expect(res.text).not.toContain(COOKIE_SECRET);
    expect(files.get('/tmp/out.json')).toContain(COOKIE_SECRET);
    expect(await call('export_cookies', { id: 'p1', filePath: '/tmp/out.json' })).toMatchObject({ isError: true, text: 'File đã tồn tại, hãy chọn đường dẫn khác: /tmp/out.json' });
    expect(await call('export_cookies', { id: 'p1', filePath: 'tuong-doi.json' })).toMatchObject({ isError: true, text: 'filePath phải là đường dẫn tuyệt đối' });
    expect(await call('export_cookies', { id: 'p1' })).toMatchObject({ isError: true, text: 'Thiếu tham số: filePath' });
  });

  it('import_cookies đọc từ file; kết quả không chứa nội dung file', async () => {
    await call('create_profile', { name: 'a' });
    files.set('/tmp/in.json', `[{"name":"sid","value":"${COOKIE_SECRET}"}]`);
    const res = await call('import_cookies', { id: 'p1', filePath: '/tmp/in.json' });
    expect(res.data).toMatchObject({ imported: 1, failed: 0 });
    expect(res.text).not.toContain(COOKIE_SECRET);
    expect(core.lastCookieText).toContain(COOKIE_SECRET);
    expect(await call('import_cookies', { id: 'p1', filePath: '/tmp/khong-co.json' })).toMatchObject({ isError: true, text: 'Không đọc được file: /tmp/khong-co.json' });
    expect(await call('import_cookies', { id: 'p1', filePath: 'in.json' })).toMatchObject({ isError: true, text: 'filePath phải là đường dẫn tuyệt đối' });
  });

  it('nhóm, proxy, kiểm tra proxy', async () => {
    expect((await call('list_groups')).data).toEqual([{ id: 'g1', name: 'airdrop' }]);
    expect((await call('list_proxies')).data[0]).toMatchObject({ id: 'x1', hasPassword: true });
    expect((await call('check_proxy', { id: 'x1' })).data).toMatchObject({ lastStatus: 'ok' });
    expect(await call('check_proxy', { id: 'zz' })).toMatchObject({ isError: true, text: 'Không tìm thấy proxy' });
  });

  it('app không mở: công cụ báo lỗi có hướng dẫn, server vẫn sống', async () => {
    await server.close();
    const res = await call('list_profiles');
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Hãy mở Browser Fingerprint trước');
    expect((await rpc('ping')).result).toEqual({});
    server = await startApiServer({ core, token: TOKEN, port: 0 });
  });
});

describe('MCP: stdio', () => {
  it('mỗi dòng vào là một thông điệp, mỗi phản hồi một dòng ra, đúng thứ tự', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on('data', (chunk: Buffer) => lines.push(...chunk.toString('utf8').split('\n').filter(Boolean)));
    const done = serveStdio(handle, input, output);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    input.write('\n');
    input.write('đây không phải JSON\n');
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\r\n`);
    input.end();
    await done;
    const replies = lines.map((l) => JSON.parse(l));
    expect(replies.map((r) => r.id)).toEqual([1, null, 2]);
    expect(replies[1].error).toMatchObject({ code: -32700 });
    expect(replies[2].result.tools).toHaveLength(12);
    expect(lines.every((l) => !l.includes('\n'))).toBe(true);
  });
});

describe('readCookieFile: đường dẫn do mô hình chỉ định', () => {
  const posix = process.platform !== 'win32';
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bf-mcp-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('đọc file thường nhỏ, kể cả file đúng bằng giới hạn', async () => {
    writeFileSync(join(dir, 'a.json'), '[{"name":"sid"}]');
    expect(await readCookieFile(join(dir, 'a.json'))).toBe('[{"name":"sid"}]');
    truncateSync(join(dir, 'a.json'), MAX_COOKIE_FILE_BYTES);
    expect((await readCookieFile(join(dir, 'a.json'))).length).toBe(MAX_COOKIE_FILE_BYTES);
  });

  it('từ chối thư mục, file không tồn tại và file quá giới hạn', async () => {
    mkdirSync(join(dir, 'd'));
    await expect(readCookieFile(join(dir, 'd'))).rejects.toThrow();
    await expect(readCookieFile(join(dir, 'khong-co'))).rejects.toThrow();
    writeFileSync(join(dir, 'big.json'), '');
    truncateSync(join(dir, 'big.json'), MAX_COOKIE_FILE_BYTES + 1);
    await expect(readCookieFile(join(dir, 'big.json'))).rejects.toThrow();
  });

  it.skipIf(!posix)('từ chối thiết bị ký tự và FIFO ngay lập tức thay vì treo', { timeout: 3000 }, async () => {
    await expect(readCookieFile('/dev/zero')).rejects.toThrow();
    let fifo = true;
    try {
      execFileSync('mkfifo', [join(dir, 'f')]);
    } catch {
      fifo = false;
    }
    if (fifo) await expect(readCookieFile(join(dir, 'f'))).rejects.toThrow();
  });

  it('import_cookies báo lỗi cố định khi đường dẫn không đọc được', async () => {
    const real = createMcpHandler({ client: {} as ApiClient, readFile: readCookieFile, writeNewFile: async () => {} });
    const res: any = await real({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'import_cookies', arguments: { id: 'p1', filePath: dir } } });
    expect(res.result).toMatchObject({ isError: true, content: [{ text: `Không đọc được file: ${dir}` }] });
  });
});
