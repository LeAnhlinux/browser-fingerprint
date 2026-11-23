import { type Server, createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, ApiError, clientFromEnv } from '../src/client';
import { type ApiServer, startApiServer } from '../src/server';
import { COOKIE_SECRET, type FakeCore, TOKEN, fakeCore } from './helpers';

let core: FakeCore;
let server: ApiServer;
let client: ApiClient;

beforeEach(async () => {
  core = fakeCore();
  server = await startApiServer({ core, token: TOKEN, port: 0 });
  client = new ApiClient({ token: TOKEN, port: server.port });
});

afterEach(async () => {
  await server.close();
});

const failure = async (p: Promise<unknown>): Promise<ApiError> => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
};

describe('ApiClient', () => {
  it('đi hết các thao tác với hồ sơ', async () => {
    expect(await client.info()).toMatchObject({ engineVersion: '1.2.3', apiVersion: 1 });
    const p = await client.createProfile({ name: 'IG-01', groupId: 'g1' });
    expect(p).toMatchObject({ id: 'p1', name: 'IG-01' });
    await client.createProfile({ name: 'FB-01' });
    expect((await client.listProfiles()).map((x) => x.name)).toEqual(['IG-01', 'FB-01']);
    expect((await client.listProfiles({ search: 'IG' })).map((x) => x.name)).toEqual(['IG-01']);
    expect((await client.listProfiles({ groupId: null })).map((x) => x.name)).toEqual(['FB-01']);
    expect((await client.listProfiles({ groupId: 'g1' })).map((x) => x.name)).toEqual(['IG-01']);
    expect(await client.getProfile('p1')).toMatchObject({ name: 'IG-01' });
    expect(await client.updateProfile('p1', { name: 'IG-02' })).toMatchObject({ name: 'IG-02' });
    const run = await client.startProfile('p1', { headless: true });
    expect(run).toMatchObject({ cdpUrl: 'ws://127.0.0.1:9333/devtools/browser/abc', headless: true });
    await client.stopProfile('p1');
    expect((await client.getProfile('p1')).run).toBeNull();
    await client.deleteProfile('p1');
    expect((await failure(client.getProfile('p1'))).status).toBe(404);
  });

  it('cookie, nhóm, proxy', async () => {
    await client.createProfile({ name: 'a' });
    expect(await client.exportCookies('p1')).toEqual({ count: 1, cookies: [{ domain: '.a.com', name: 'sid', value: COOKIE_SECRET, path: '/' }] });
    expect(await client.importCookies('p1', '[{"name":"x"}]')).toMatchObject({ imported: 1 });
    expect(core.lastCookieText).toBe('[{"name":"x"}]');
    expect(await client.listGroups()).toEqual([{ id: 'g1', name: 'airdrop' }]);
    expect((await client.listProxies())[0]).toMatchObject({ id: 'x1' });
    expect(await client.checkProxy('x1')).toMatchObject({ lastStatus: 'ok' });
  });

  it('lỗi của app thành ApiError mang đúng mã và thông báo', async () => {
    const empty = await failure(client.createProfile({ name: '' }));
    expect(empty).toMatchObject({ status: 400, message: 'Tên hồ sơ không được để trống' });
    expect(await failure(client.checkProxy('zz'))).toMatchObject({ status: 404, message: 'Không tìm thấy proxy' });
    const wrong = new ApiClient({ token: 'b'.repeat(64), port: server.port });
    expect(await failure(wrong.info())).toMatchObject({ status: 401, message: 'Thiếu hoặc sai token' });
  });

  it('mã hồ sơ được mã hoá phần trăm trong đường dẫn', async () => {
    expect((await failure(client.getProfile('a/b c?d'))).status).toBe(404);
    expect((await failure(client.getProfile('../info'))).status).toBe(404);
  });

  it('app không mở: ApiError mã 0 với hướng dẫn mở app', async () => {
    await server.close();
    const err = await failure(client.info());
    expect(err.status).toBe(0);
    expect(err.message).toBe('Không kết nối được tới app. Hãy mở Browser Fingerprint trước (API chỉ chạy khi app đang mở).');
    server = await startApiServer({ core, token: TOKEN, port: 0 });
  });

  describe('máy chủ không phải app', () => {
    let fake: Server;
    let hits: string[];
    const listen = async (handler: Parameters<typeof createServer>[1]): Promise<number> => {
      fake = createServer(handler);
      await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
      return (fake.address() as { port: number }).port;
    };
    beforeEach(() => {
      hits = [];
    });
    afterEach(async () => {
      fake.closeAllConnections();
      await new Promise<void>((r) => fake.close(() => r()));
    });

    it('chuyển hướng thành ApiError mã 0 và không bao giờ gọi tới đích chuyển hướng', async () => {
      const port = await listen((req, res) => {
        hits.push(req.url ?? '');
        if (req.url === '/v1/info') {
          res.writeHead(302, { Location: `http://127.0.0.1:${(fake.address() as { port: number }).port}/duoc-chuyen-huong` });
          res.end();
        } else {
          res.end('{}');
        }
      });
      const err = await failure(new ApiClient({ token: TOKEN, port }).info());
      expect(err).toMatchObject({ status: 0, message: 'Máy chủ API trả lời không hợp lệ' });
      expect(hits).toEqual(['/v1/info']);
    });

    it('máy chủ không bao giờ trả lời: hết thời gian chờ thành ApiError mã 0', async () => {
      const port = await listen(() => {});
      const err = await failure(new ApiClient({ token: TOKEN, port, timeoutMs: 100 }).info());
      expect(err).toMatchObject({ status: 0, message: 'App không trả lời kịp thời gian' });
    });
  });

  it('token dạng hàm được gọi lại ở mỗi request; hàm ném lỗi thành ApiError mã 0', async () => {
    let calls = 0;
    const lazy = new ApiClient({
      port: server.port,
      token: () => {
        calls++;
        if (calls === 1) throw new Error('Không đọc được token của API tại /x');
        return TOKEN;
      },
    });
    expect(await failure(lazy.info())).toMatchObject({ status: 0, message: 'Không đọc được token của API tại /x' });
    expect(await lazy.info()).toMatchObject({ apiVersion: 1 });
    await lazy.info();
    expect(calls).toBe(3);
  });

  it('clientFromEnv đọc cổng và file token từ biến môi trường', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'bf-client-')), 'api-token');
    const fromEnv = clientFromEnv({ BF_API_PORT: String(server.port), BF_API_TOKEN_FILE: file });
    expect((await failure(fromEnv.info())).message).toContain('Không đọc được token của API');
    writeFileSync(file, TOKEN);
    expect(await fromEnv.info()).toMatchObject({ apiVersion: 1 });
    for (const bad of ['abc', '0', '70000', '1.5']) {
      expect(() => clientFromEnv({ BF_API_PORT: bad }), bad).toThrow('BF_API_PORT không hợp lệ');
    }
  });
});
