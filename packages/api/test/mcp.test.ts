import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
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
let tmp: string;
let filesDir: string;
let handle: (message: unknown) => Promise<unknown | null>;

beforeEach(async () => {
  core = fakeCore();
  server = await startApiServer({ core, token: TOKEN, port: 0 });
  tmp = mkdtempSync(join(tmpdir(), 'bf-mcp-files-'));
  filesDir = join(tmp, 'mcp-files');
  handle = createMcpHandler({ client: new ApiClient({ token: TOKEN, port: server.port }), filesDir });
});

afterEach(async () => {
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
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
      'captcha_balance', 'solve_captcha',
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
      filesDir: '/khong/dung/toi',
    });
    const res: any = await leaky({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_groups' } });
    expect(res.result).toMatchObject({ isError: true, content: [{ text: 'Lỗi nội bộ của MCP server' }] });
  });

  const posix = process.platform !== 'win32';
  const cookieCalls = (): unknown[] => core.calls.filter((c) => c[0] === 'exportCookies' || c[0] === 'importCookies');

  it.skipIf(!posix)('thư mục file của MCP được tạo 0700 lần đầu dùng và được siết về 0700 nếu đã có', async () => {
    await call('create_profile', { name: 'a' });
    expect(existsSync(filesDir)).toBe(false);
    await call('export_cookies', { id: 'p1', fileName: 'a.json' });
    expect(statSync(filesDir).mode & 0o777).toBe(0o700);
    chmodSync(filesDir, 0o755);
    await call('export_cookies', { id: 'p1', fileName: 'b.json' });
    expect(statSync(filesDir).mode & 0o777).toBe(0o700);
  });

  it('export_cookies ghi file trong thư mục, trả đường dẫn đầy đủ và không trả giá trị cookie', async () => {
    await call('create_profile', { name: 'a' });
    const target = join(filesDir, 'out.json');
    const res = await call('export_cookies', { id: 'p1', fileName: 'out.json' });
    expect(res.data).toEqual({ count: 1, filePath: target });
    expect(res.text).not.toContain(COOKIE_SECRET);
    expect(readFileSync(target, 'utf8')).toContain(COOKIE_SECRET);
    if (posix) expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(await call('export_cookies', { id: 'p1' })).toMatchObject({ isError: true, text: 'Thiếu tham số: fileName' });
    expect(await call('export_cookies', { id: 'p1', fileName: 5 })).toMatchObject({ isError: true, text: 'Thiếu tham số: fileName' });
  });

  it('export_cookies không ghi đè file đã có và không gọi app khi đích đã bị chiếm', async () => {
    await call('create_profile', { name: 'a' });
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(join(filesDir, 'co-san.json'), 'noi dung cu');
    const res = await call('export_cookies', { id: 'p1', fileName: 'co-san.json' });
    expect(res).toMatchObject({ isError: true, text: `File đã tồn tại, hãy chọn tên khác: ${join(filesDir, 'co-san.json')}` });
    expect(readFileSync(join(filesDir, 'co-san.json'), 'utf8')).toBe('noi dung cu');
    expect(core.calls.filter((c) => c[0] === 'exportCookies')).toEqual([]);
  });

  it.skipIf(!posix)('export_cookies không đi theo liên kết ở thành phần cuối, kể cả liên kết treo', async () => {
    await call('create_profile', { name: 'a' });
    mkdirSync(filesDir, { recursive: true });
    const outside = join(tmp, 'ngoai.json');
    symlinkSync(outside, join(filesDir, 'link.json'));
    expect(await call('export_cookies', { id: 'p1', fileName: 'link.json' })).toMatchObject({ isError: true });
    expect(existsSync(outside)).toBe(false);
    expect(core.calls.filter((c) => c[0] === 'exportCookies')).toEqual([]);
  });

  it('export_cookies lỗi ở app (hồ sơ không có) thì không để lại file', async () => {
    const res = await call('export_cookies', { id: 'khong-co', fileName: 'x.json' });
    expect(res).toMatchObject({ isError: true, text: 'Không tìm thấy hồ sơ' });
    expect(existsSync(join(filesDir, 'x.json'))).toBe(false);
    expect(readdirSync(filesDir)).toEqual([]);
  });

  const BAD_NAMES = [
    '../x.json', 'a/b.json', '/etc/passwd', '/tmp/abs.json', '..', '.', '.an.json', '.', 'a\\b.json', 'C:\\x.json', 'a..\\x',
    'a'.repeat(101), '', 'co khoang.json', 'a\nb.json', 'a\0b.json', 'tên.json', 'a:stream', 'ket-thuc-cham.', 'con', 'NUL.json', 'com1.txt', 'LPT9',
  ];

  it('fileName có dấu phân cách, .., dấu chấm đầu, gạch ngược, đường dẫn tuyệt đối, quá dài hoặc tên thiết bị bị từ chối và app không bị gọi', async () => {
    await call('create_profile', { name: 'a' });
    core.calls.length = 0;
    for (const fileName of BAD_NAMES) {
      for (const tool of ['export_cookies', 'import_cookies']) {
        const res = await call(tool, { id: 'p1', fileName });
        expect(res.isError, `${tool} ${JSON.stringify(fileName)}`).toBe(true);
        expect(res.text, `${tool} ${JSON.stringify(fileName)}`).toMatch(/^(fileName không hợp lệ|Thiếu tham số: fileName)/);
      }
    }
    expect(cookieCalls()).toEqual([]);
    expect(existsSync(filesDir)).toBe(false);
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('fileName hợp lệ ở mức biên được chấp nhận', async () => {
    await call('create_profile', { name: 'a' });
    for (const fileName of ['a', 'a.b-c_d.json', 'x'.repeat(100), 'console.json', 'a..b']) {
      expect((await call('export_cookies', { id: 'p1', fileName })).isError, fileName).toBe(false);
    }
  });

  it('import_cookies đọc file trong thư mục; kết quả không chứa nội dung file', async () => {
    await call('create_profile', { name: 'a' });
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(join(filesDir, 'in.json'), `[{"name":"sid","value":"${COOKIE_SECRET}"}]`);
    const res = await call('import_cookies', { id: 'p1', fileName: 'in.json' });
    expect(res.data).toMatchObject({ imported: 1, failed: 0 });
    expect(res.text).not.toContain(COOKIE_SECRET);
    expect(core.lastCookieText).toContain(COOKIE_SECRET);
    expect(await call('import_cookies', { id: 'p1', fileName: 'khong-co.json' })).toMatchObject({ isError: true, text: `Không đọc được file: ${join(filesDir, 'khong-co.json')}` });
    expect(await call('import_cookies', { id: 'p1' })).toMatchObject({ isError: true, text: 'Thiếu tham số: fileName' });
  });

  it.skipIf(!posix)('import_cookies từ chối liên kết trong thư mục, dù trỏ tới file thật', async () => {
    await call('create_profile', { name: 'a' });
    mkdirSync(filesDir, { recursive: true });
    const outside = join(tmp, 'ngoai.json');
    writeFileSync(outside, `[{"name":"sid","value":"${COOKIE_SECRET}"}]`);
    symlinkSync(outside, join(filesDir, 'link.json'));
    const res = await call('import_cookies', { id: 'p1', fileName: 'link.json' });
    expect(res).toMatchObject({ isError: true, text: `Không đọc được file: ${join(filesDir, 'link.json')}` });
    expect(core.lastCookieText).not.toContain(COOKIE_SECRET);
    expect(core.calls.filter((c) => c[0] === 'importCookies')).toEqual([]);
  });

  it('nhóm, proxy, kiểm tra proxy', async () => {
    expect((await call('list_groups')).data).toEqual([{ id: 'g1', name: 'airdrop' }]);
    expect((await call('list_proxies')).data[0]).toMatchObject({ id: 'x1', hasPassword: true });
    expect((await call('check_proxy', { id: 'x1' })).data).toMatchObject({ lastStatus: 'ok' });
    expect(await call('check_proxy', { id: 'zz' })).toMatchObject({ isError: true, text: 'Không tìm thấy proxy' });
  });

  it('CapMonster: số dư và giải captcha, thời gian đổi sang mili giây', async () => {
    expect((await call('captcha_balance')).data).toEqual({ balance: 4.25 });
    const task = { type: 'TurnstileTask', websiteURL: 'https://a.example', websiteKey: 'k' };
    expect((await call('solve_captcha', { task, timeoutSeconds: 60 })).data).toEqual({ taskId: 9, solution: { token: 'TOKEN-GIAI' }, cost: 0.001 });
    expect(core.calls.at(-1)).toEqual(['solveCaptcha', task, 60_000]);
    expect(await call('solve_captcha', { task: 'x' })).toMatchObject({ isError: true, text: 'Thiếu tham số: task (đối tượng)' });
    expect(await call('solve_captcha', { task, timeoutSeconds: 1.5 })).toMatchObject({ isError: true, text: 'timeoutSeconds phải là số nguyên' });
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
    expect(replies[2].result.tools).toHaveLength(TOOL_NAMES.length);
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

  it('import_cookies báo lỗi cố định khi tên trỏ tới thư mục', async () => {
    mkdirSync(join(dir, 'd'));
    const real = createMcpHandler({ client: {} as ApiClient, filesDir: dir });
    const res: any = await real({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'import_cookies', arguments: { id: 'p1', fileName: 'd' } } });
    expect(res.result).toMatchObject({ isError: true, content: [{ text: `Không đọc được file: ${join(dir, 'd')}` }] });
  });
});
