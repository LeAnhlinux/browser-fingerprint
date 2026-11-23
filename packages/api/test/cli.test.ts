import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CliIo, runCli, writePrivateFile } from '../src/cli';
import { ApiClient } from '../src/client';
import { type ApiServer, startApiServer } from '../src/server';
import { COOKIE_SECRET, type FakeCore, TOKEN, fakeCore } from './helpers';

let core: FakeCore;
let server: ApiServer;
let out: string[];
let err: string[];
let files: Map<string, string>;
let io: CliIo;

beforeEach(async () => {
  core = fakeCore();
  server = await startApiServer({ core, token: TOKEN, port: 0 });
  out = [];
  err = [];
  files = new Map();
  io = {
    client: new ApiClient({ token: TOKEN, port: server.port }),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    readFile: async (path) => {
      const data = files.get(path);
      if (data === undefined) throw new Error(`ENOENT: ${path}`);
      return data;
    },
    writeFile: async (path, data) => {
      files.set(path, data);
    },
  };
});

afterEach(async () => {
  await server.close();
});

const run = async (...argv: string[]): Promise<number> => {
  out.length = 0;
  err.length = 0;
  return runCli(argv, io);
};

describe('bf', () => {
  it('create in mã hồ sơ; list in mỗi hồ sơ một dòng cách nhau bằng tab', async () => {
    expect(await run('create', 'IG-01', '--group', 'g1', '--timezone', 'Asia/Tokyo')).toBe(0);
    expect(out).toEqual(['p1']);
    expect(core.calls[0]).toEqual(['createProfile', { name: 'IG-01', groupId: 'g1', timezone: 'Asia/Tokyo' }]);
    await run('create', 'FB-01', '--group', 'none', '--proxy', 'none');
    expect(core.calls[1]).toEqual(['createProfile', { name: 'FB-01', groupId: null, proxyId: null }]);
    expect(await run('list')).toBe(0);
    expect(out).toEqual(['p1\tIG-01\tsẵn sàng', 'p2\tFB-01\tsẵn sàng']);
    await run('list', '--search', 'FB');
    expect(out).toEqual(['p2\tFB-01\tsẵn sàng']);
    await run('list', '--group', 'none');
    expect(out).toEqual(['p2\tFB-01\tsẵn sàng']);
  });

  it('--json in JSON phân tích lại được', async () => {
    await run('create', 'a');
    expect(await run('list', '--json')).toBe(0);
    expect(JSON.parse(out.join('\n'))).toMatchObject([{ id: 'p1', name: 'a' }]);
    await run('show', 'p1');
    expect(JSON.parse(out.join('\n'))).toMatchObject({ id: 'p1', name: 'a' });
    await run('create', 'b', '--json');
    expect(JSON.parse(out.join('\n'))).toMatchObject({ id: 'p2', name: 'b' });
  });

  it('update chỉ gửi các trường được nêu; delete xoá', async () => {
    await run('create', 'a');
    expect(await run('update', 'p1', '--name', 'b', '--accept-lang', 'en-US,en', '--notes', 'ghi chú')).toBe(0);
    expect(core.calls.at(-1)).toEqual(['updateProfile', 'p1', { name: 'b', acceptLang: 'en-US,en', notes: 'ghi chú' }]);
    expect(await run('update', 'p1')).toBe(2);
    expect(err[0]).toBe('Chưa nêu thay đổi nào');
    expect(await run('delete', 'p1')).toBe(0);
    expect(out).toEqual(['Đã xoá p1']);
    expect(await run('show', 'p1')).toBe(1);
    expect(err).toEqual(['Lỗi: Không tìm thấy hồ sơ']);
  });

  it('start in địa chỉ CDP để script dùng thẳng; stop dừng', async () => {
    await run('create', 'a');
    expect(await run('start', 'p1', '--headless')).toBe(0);
    expect(out).toEqual(['ws://127.0.0.1:9333/devtools/browser/abc']);
    expect(core.calls.at(-1)).toEqual(['launch', 'p1', { headless: true }]);
    await run('list');
    expect(out).toEqual(['p1\ta\tđang chạy ẩn']);
    await run('start', 'p1', '--json');
    expect(JSON.parse(out.join('\n'))).toMatchObject({ profileId: 'p1', cdpPort: 9333 });
    expect(await run('stop', 'p1')).toBe(0);
    expect(out).toEqual(['Đã dừng p1']);
  });

  it('cookies export ra file không in giá trị cookie; không có -o thì in JSON', async () => {
    await run('create', 'a');
    expect(await run('cookies', 'export', 'p1', '-o', '/tmp/c.json')).toBe(0);
    expect(out).toEqual(['Đã lưu 1 cookie vào /tmp/c.json']);
    expect(out.join('')).not.toContain(COOKIE_SECRET);
    expect(JSON.parse(files.get('/tmp/c.json') ?? '')).toEqual([{ domain: '.a.com', name: 'sid', value: COOKIE_SECRET, path: '/' }]);
    await run('cookies', 'export', 'p1');
    expect(JSON.parse(out.join('\n'))).toHaveLength(1);
  });

  it('cookies import đọc file và in kết quả', async () => {
    await run('create', 'a');
    files.set('/tmp/in.txt', '[{"name":"x"}]');
    expect(await run('cookies', 'import', 'p1', '/tmp/in.txt')).toBe(0);
    expect(core.lastCookieText).toBe('[{"name":"x"}]');
    expect(out).toEqual(['Đã nhập 1 cookie; 0 bị từ chối; bỏ qua 0 cookie phiên; 0 lỗi phân tích']);
    expect(await run('cookies', 'import', 'p1', '/tmp/khong-co.txt')).toBe(1);
    expect(err[0]).toBe('Lỗi: Không đọc được file /tmp/khong-co.txt');
  });

  it('groups, proxies, proxy check, info', async () => {
    await run('groups');
    expect(out).toEqual(['g1\tairdrop']);
    await run('proxies');
    expect(out).toEqual(['x1\thttp://proxy.example:8080\tchưa kiểm tra']);
    expect(await run('proxy', 'check', 'x1')).toBe(0);
    expect(out).toEqual(['x1\thttp://proxy.example:8080\tsống · 1.2.3.4 · US · America/Chicago']);
    expect(await run('proxy', 'check', 'zz')).toBe(1);
    expect(err).toEqual(['Lỗi: Không tìm thấy proxy']);
    await run('info');
    expect(out).toEqual(['Nhân: 1.2.3 (đã cài)', 'Hệ điều hành: macos', 'API: v1']);
  });

  it('sai cú pháp: mã thoát 2 kèm hướng dẫn, không gọi app', async () => {
    for (const argv of [[], ['khong-co'], ['create'], ['start'], ['cookies'], ['cookies', 'import', 'p1'], ['list', '--khong-co'], ['proxy', 'check']]) {
      expect(await run(...argv), argv.join(' ')).toBe(2);
      expect(err.join('\n'), argv.join(' ')).toContain('Cách dùng: bf');
    }
    expect(core.calls).toEqual([]);
    expect(await run('--help')).toBe(0);
    expect(out.join('\n')).toContain('Cách dùng: bf');
  });

  it('app không mở: mã thoát 1 với hướng dẫn mở app', async () => {
    await server.close();
    expect(await run('list')).toBe(1);
    expect(err).toEqual(['Lỗi: Không kết nối được tới app. Hãy mở Browser Fingerprint trước (API chỉ chạy khi app đang mở).']);
    server = await startApiServer({ core, token: TOKEN, port: 0 });
  });
});

describe('writePrivateFile', () => {
  const posix = process.platform !== 'win32';
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bf-cli-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('ghi đè file cũ 0644 mà vẫn ra 0600', async () => {
    const file = join(dir, 'cookies.json');
    writeFileSync(file, 'cu');
    chmodSync(file, 0o644);
    await writePrivateFile(file, 'moi');
    expect(readFileSync(file, 'utf8')).toBe('moi');
    if (posix) expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('tạo file mới với 0600 và không để lại file tạm', async () => {
    const file = join(dir, 'moi.json');
    await writePrivateFile(file, 'x');
    expect(readFileSync(file, 'utf8')).toBe('x');
    if (posix) expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['moi.json']);
  });

  it('lỗi thì không để lại file tạm và không đụng file đích', async () => {
    await expect(writePrivateFile(join(dir, 'khong-co', 'a.json'), 'x')).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });
});
