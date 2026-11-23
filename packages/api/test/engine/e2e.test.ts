import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Core, openCdp } from '@bf/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli, writePrivateFile } from '../../src/cli';
import { ApiClient, ApiError } from '../../src/client';
import { type ApiServer, startApiServer } from '../../src/server';
import { loadOrCreateToken, tokenPath } from '../../src/token';

const ENGINES_DIR = join(__dirname, '..', '..', '..', 'core', '.engines');
const FUTURE = Math.floor(Date.now() / 1000) + 30 * 86_400;

let tmp: string;
let core: Core;
let server: ApiServer;
let client: ApiClient;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'bf-api-e2e-'));
  const dataDir = join(tmp, 'data');
  core = new Core({ dataDir, secrets: { encrypt: (s) => s, decrypt: (s) => s }, enginesDir: ENGINES_DIR });
  await core.init();
  if (!core.info().engineInstalled) throw new Error('Chưa cài nhân: chạy pnpm --filter @bf/core test:engine trước');
  const token = loadOrCreateToken(tokenPath(dataDir));
  server = await startApiServer({ core, token, port: 0 });
  client = new ApiClient({ port: server.port, token });
});

afterAll(async () => {
  await server.close();
  await core.shutdown();
});

const cli = async (...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    client,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    readFile: (p) => readFile(p, 'utf8'),
    writeFile: writePrivateFile,
  });
  return { code, out, err };
};

describe('nhân thật qua REST', () => {
  it('tạo hồ sơ, khởi động ẩn, nối CDP bằng cdpUrl, nhập và xuất cookie, dừng, xoá', async () => {
    const p = await client.createProfile({ name: 'api-1', timezone: 'Asia/Tokyo' });
    expect(p.run).toBeNull();
    const run = await client.startProfile(p.id, { headless: true });
    expect(run.cdpUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//);
    expect(run.headless).toBe(true);
    try {
      const cdp = await openCdp(run.cdpUrl);
      try {
        const version = await cdp.call<{ product: string }>('Browser.getVersion');
        expect(version.product).toMatch(/Chrome|Chromium/);
      } finally {
        cdp.close();
      }
      expect((await client.startProfile(p.id)).pid).toBe(run.pid);
      const imported = await client.importCookies(
        p.id,
        JSON.stringify([
          { domain: '.example.com', name: 'sid', value: 'abc', secure: true, expirationDate: FUTURE },
          { domain: '.example.com', name: 'phien', value: 'x' },
        ]),
      );
      expect(imported).toMatchObject({ imported: 2, failed: 0, sessionSkipped: 0 });
      const exported = await client.exportCookies(p.id);
      expect(exported.count).toBe(2);
      expect((exported.cookies as { name: string }[]).map((c) => c.name).sort()).toEqual(['phien', 'sid']);
      expect((await client.getProfile(p.id)).run).toMatchObject({ pid: run.pid });
    } finally {
      await client.stopProfile(p.id);
    }
    expect((await client.getProfile(p.id)).run).toBeNull();
    await client.deleteProfile(p.id);
    await expect(client.getProfile(p.id)).rejects.toMatchObject({ status: 404 });
  });

  it('proxy chết: khởi động và nhập cookie qua API đều báo lỗi, không có trình duyệt nào chạy', async () => {
    const proxy = core.createProxy({ protocol: 'http', host: '127.0.0.1', port: 9 });
    const p = await client.createProfile({ name: 'api-proxy-chet', proxyId: proxy.id });
    const start = await client.startProfile(p.id).catch((e: unknown) => e);
    expect(start).toBeInstanceOf(ApiError);
    expect((start as ApiError).status).toBe(400);
    expect((start as ApiError).message).toContain('không kết nối được');
    const cookies = await client.importCookies(p.id, JSON.stringify([{ domain: '.a.com', name: 'n', value: 'v', expirationDate: FUTURE }])).catch((e: unknown) => e);
    expect(cookies).toBeInstanceOf(ApiError);
    expect((cookies as ApiError).message).toContain('không kết nối được');
    expect((await client.getProfile(p.id)).run).toBeNull();
    await client.deleteProfile(p.id);
  });

  it('trường hồ sơ nguy hiểm bị lõi từ chối qua API', async () => {
    for (const fields of [{ brand: 'Chrome --no-sandbox' }, { platform: 'android' }, { platformVersion: '10 --flag' }, { timezone: '--flag=1' }]) {
      const err = await client.createProfile({ name: 'x', ...fields } as never).catch((e: unknown) => e);
      expect(err, JSON.stringify(fields)).toBeInstanceOf(ApiError);
      expect((err as ApiError).status, JSON.stringify(fields)).toBe(400);
    }
    expect((await client.listProfiles()).filter((x) => x.name === 'x')).toEqual([]);
  });
});

describe('nhân thật qua CLI', () => {
  it('create, start --headless in địa chỉ CDP dùng được, cookies export ra file 0600, stop, delete', async () => {
    const created = await cli('create', 'cli-1');
    expect(created.code).toBe(0);
    const id = created.out[0];
    const started = await cli('start', id, '--headless');
    expect(started.code).toBe(0);
    try {
      const cdp = await openCdp(started.out[0]);
      cdp.close();
      expect((await cli('list')).out.find((l) => l.startsWith(id))).toBe(`${id}\tcli-1\tđang chạy ẩn`);
      const file = join(tmp, 'cli-cookies.json');
      expect((await cli('cookies', 'export', id, '-o', file)).code).toBe(0);
      expect(Array.isArray(JSON.parse(readFileSync(file, 'utf8')))).toBe(true);
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
      expect((await cli('cookies', 'import', id, file)).code).toBe(0);
    } finally {
      expect((await cli('stop', id)).code).toBe(0);
    }
    expect((await cli('delete', id)).out).toEqual([`Đã xoá ${id}`]);
    expect((await cli('show', id)).code).toBe(1);
  });
});
