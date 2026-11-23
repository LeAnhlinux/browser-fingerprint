import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ApiServer, startApiServer } from '../src/server';
import { COOKIE_SECRET, type FakeCore, TOKEN, fakeCore, http } from './helpers';

let core: FakeCore;
let server: ApiServer;
let port: number;

beforeEach(async () => {
  core = fakeCore();
  server = await startApiServer({ core, token: TOKEN, port: 0 });
  port = server.port;
});

afterEach(async () => {
  await server.close();
});

describe('máy chủ API: lớp bảo vệ', () => {
  it('chỉ nghe trên 127.0.0.1', () => {
    expect(server.address).toBe('127.0.0.1');
    expect(port).toBeGreaterThan(0);
  });

  it('thiếu token, sai token hoặc sai kiểu xác thực: 401 và lõi không được gọi', async () => {
    for (const headers of [{}, { authorization: `Bearer ${'b'.repeat(64)}` }, { authorization: `Basic ${TOKEN}` }, { authorization: TOKEN }, { authorization: 'Bearer ' }]) {
      const r = await http(port, 'POST', '/v1/profiles', { token: null, body: { name: 'a' }, headers });
      expect(r.status, JSON.stringify(headers)).toBe(401);
      expect(r.json).toEqual({ error: 'Thiếu hoặc sai token' });
      expect(r.headers['www-authenticate']).toBe('Bearer');
      expect(r.text).not.toContain(TOKEN);
    }
    expect(core.calls).toEqual([]);
  });

  it('Host lạ bị từ chối 403 kể cả khi token đúng; localhost được nhận', async () => {
    for (const host of ['evil.example', `evil.example:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`]) {
      const r = await http(port, 'GET', '/v1/info', { headers: { host } });
      expect(r.status, host).toBe(403);
      expect(r.json).toEqual({ error: 'Host không hợp lệ' });
    }
    expect((await http(port, 'GET', '/v1/info', { headers: { host: `localhost:${port}` } })).status).toBe(200);
    expect((await http(port, 'GET', '/v1/info', { headers: { host: `LOCALHOST:${port}` } })).status).toBe(200);
  });

  it('request có Origin bị từ chối 403 kể cả khi token đúng, và không bao giờ có header CORS', async () => {
    for (const origin of ['https://evil.example', `http://127.0.0.1:${port}`, 'null']) {
      const r = await http(port, 'POST', '/v1/profiles', { body: { name: 'a' }, headers: { origin } });
      expect(r.status, origin).toBe(403);
      expect(r.json).toEqual({ error: 'Không nhận yêu cầu từ trang web' });
      expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control'))).toEqual([]);
    }
    const preflight = await http(port, 'OPTIONS', '/v1/profiles', { token: null, headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(preflight.status).toBe(403);
    expect(Object.keys(preflight.headers).filter((h) => h.startsWith('access-control'))).toEqual([]);
    expect(core.calls).toEqual([]);
  });

  it('thứ tự kiểm: Host trước, Origin sau, rồi mới tới token', async () => {
    expect((await http(port, 'GET', '/v1/info', { token: null, headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await http(port, 'GET', '/v1/info', { token: null, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await http(port, 'GET', '/v1/khong-co', { token: null })).status).toBe(401);
  });

  it('mọi phản hồi là JSON, không cho lưu đệm, không cho đoán kiểu', async () => {
    for (const r of [await http(port, 'GET', '/v1/info'), await http(port, 'GET', '/v1/khong-co'), await http(port, 'GET', '/v1/info', { token: null })]) {
      expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('đường dẫn lạ 404, sai phương thức 405', async () => {
    expect(await http(port, 'GET', '/v1/khong-co')).toMatchObject({ status: 404, json: { error: 'Không tìm thấy đường dẫn' } });
    expect(await http(port, 'GET', '/')).toMatchObject({ status: 404 });
    expect(await http(port, 'PUT', '/v1/profiles')).toMatchObject({ status: 405, json: { error: 'Phương thức không được hỗ trợ' } });
    expect(await http(port, 'OPTIONS', '/v1/profiles')).toMatchObject({ status: 405 });
  });

  it('thân request: JSON hỏng 400, sai Content-Type 415, quá lớn 413', async () => {
    expect(await http(port, 'POST', '/v1/profiles', { raw: '{hỏng' })).toMatchObject({ status: 400, json: { error: 'JSON không hợp lệ' } });
    expect(await http(port, 'POST', '/v1/profiles', { raw: '{"name":"a"}', headers: { 'content-type': 'text/plain' } })).toMatchObject({ status: 415 });
    const big = await http(port, 'POST', '/v1/profiles/p1/cookies', { body: { text: 'x'.repeat(6_000_001) } });
    expect(big).toMatchObject({ status: 413, json: { error: 'Nội dung quá lớn (tối đa 6 MB)' } });
    expect(core.calls).toEqual([]);
  });

  it('cổng đang bận thì báo lỗi rõ; đóng rồi thì cổng dùng lại được', async () => {
    await expect(startApiServer({ core, token: TOKEN, port })).rejects.toThrow(`Cổng ${port} đang được dùng bởi chương trình khác`);
    await server.close();
    server = await startApiServer({ core, token: TOKEN, port });
    expect((await http(port, 'GET', '/v1/info')).status).toBe(200);
  });
});

describe('máy chủ API: đường dẫn', () => {
  it('GET /v1/info', async () => {
    expect((await http(port, 'GET', '/v1/info')).json).toEqual({ engineInstalled: true, engineVersion: '1.2.3', hostPlatform: 'macos', apiVersion: 1 });
  });

  it('vòng đời hồ sơ: tạo, liệt kê có lọc, xem, sửa, xoá', async () => {
    const created = await http(port, 'POST', '/v1/profiles', { body: { name: 'IG-01', groupId: 'g1' } });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ id: 'p1', name: 'IG-01', groupId: 'g1', run: null });
    await http(port, 'POST', '/v1/profiles', { body: { name: 'FB-01' } });
    expect((await http(port, 'GET', '/v1/profiles')).json.map((p) => (p as { name: string }).name)).toEqual(['IG-01', 'FB-01']);
    expect((await http(port, 'GET', '/v1/profiles?search=IG')).json).toHaveLength(1);
    expect((await http(port, 'GET', '/v1/profiles?groupId=g1')).json).toHaveLength(1);
    expect((await http(port, 'GET', '/v1/profiles?groupId=none')).json.map((p) => (p as { name: string }).name)).toEqual(['FB-01']);
    expect((await http(port, 'GET', '/v1/profiles/p1')).json).toMatchObject({ id: 'p1', name: 'IG-01' });
    const patched = await http(port, 'PATCH', '/v1/profiles/p1', { body: { name: 'IG-02', proxyId: null } });
    expect(patched).toMatchObject({ status: 200, json: { id: 'p1', name: 'IG-02' } });
    expect(await http(port, 'DELETE', '/v1/profiles/p1')).toMatchObject({ status: 200, json: { ok: true } });
    expect(await http(port, 'GET', '/v1/profiles/p1')).toMatchObject({ status: 404, json: { error: 'Không tìm thấy hồ sơ' } });
  });

  it('hồ sơ không tồn tại: 404 ở mọi đường dẫn theo mã', async () => {
    for (const [method, path, body] of [
      ['GET', '/v1/profiles/zz', undefined],
      ['PATCH', '/v1/profiles/zz', { name: 'a' }],
      ['DELETE', '/v1/profiles/zz', undefined],
      ['POST', '/v1/profiles/zz/start', undefined],
      ['POST', '/v1/profiles/zz/stop', undefined],
      ['GET', '/v1/profiles/zz/cookies', undefined],
      ['POST', '/v1/profiles/zz/cookies', { text: '[]' }],
    ] as const) {
      expect((await http(port, method, path, { body })).status, `${method} ${path}`).toBe(404);
    }
  });

  it('trường lạ và thân sai dạng bị từ chối 400 trước khi tới lõi', async () => {
    expect(await http(port, 'POST', '/v1/profiles', { body: { name: 'a', proxy: 'x1' } })).toMatchObject({ status: 400, json: { error: 'Trường không được hỗ trợ: proxy' } });
    expect(await http(port, 'POST', '/v1/profiles', { body: { name: 'a', seed: 1 } })).toMatchObject({ status: 400, json: { error: 'Trường không được hỗ trợ: seed' } });
    expect(await http(port, 'POST', '/v1/profiles', { body: ['a'] })).toMatchObject({ status: 400, json: { error: 'Thân yêu cầu phải là một đối tượng JSON' } });
    expect(await http(port, 'POST', '/v1/profiles')).toMatchObject({ status: 400, json: { error: 'Thân yêu cầu phải là một đối tượng JSON' } });
    expect(core.calls).toEqual([]);
  });

  it('lỗi do lõi báo thành 400 kèm thông báo; lỗi lập trình thành 500 không lộ chi tiết', async () => {
    expect(await http(port, 'POST', '/v1/profiles', { body: { name: '' } })).toMatchObject({ status: 400, json: { error: 'Tên hồ sơ không được để trống' } });
    const boom = await http(port, 'POST', '/v1/profiles', { body: { name: 'boom' } });
    expect(boom).toMatchObject({ status: 500, json: { error: 'Lỗi nội bộ' } });
    expect(boom.text).not.toContain('bí mật');
  });

  it('500 gọi onError với tên lỗi và route, không kèm thông báo, URL thật hay token; 4xx thì không gọi', async () => {
    const seen: unknown[] = [];
    const traced = await startApiServer({ core, token: TOKEN, port: 0, onError: (info) => seen.push(info) });
    try {
      expect((await http(traced.port, 'POST', '/v1/profiles', { body: { name: 'boom' } })).status).toBe(500);
      expect(await http(traced.port, 'POST', '/v1/profiles', { body: { name: '' } })).toMatchObject({ status: 400 });
      expect(await http(traced.port, 'GET', '/v1/profiles/ma-nhay-cam')).toMatchObject({ status: 404 });
      expect(seen).toEqual([{ method: 'POST', route: String.raw`^\/v1\/profiles$`, name: 'TypeError' }]);
      const logged = JSON.stringify(seen);
      for (const secret of ['bí mật', 'chi tiết', TOKEN, 'boom', 'ma-nhay-cam']) expect(logged).not.toContain(secret);
    } finally {
      await traced.close();
    }
  });

  it('onError ném lỗi cũng không làm hỏng phản hồi 500', async () => {
    const bad = await startApiServer({ core, token: TOKEN, port: 0, onError: () => { throw new Error('log hỏng'); } });
    try {
      expect(await http(bad.port, 'POST', '/v1/profiles', { body: { name: 'boom' } })).toMatchObject({ status: 500, json: { error: 'Lỗi nội bộ' } });
    } finally {
      await bad.close();
    }
  });

  it('start trả RunInfo có cdpUrl, nhận headless, và gọi lại thì trả phiên đang chạy', async () => {
    await http(port, 'POST', '/v1/profiles', { body: { name: 'a' } });
    const first = await http(port, 'POST', '/v1/profiles/p1/start', { body: { headless: true } });
    expect(first).toMatchObject({ status: 200, json: { profileId: 'p1', cdpUrl: 'ws://127.0.0.1:9333/devtools/browser/abc', headless: true } });
    const again = await http(port, 'POST', '/v1/profiles/p1/start');
    expect(again.json).toEqual(first.json);
    expect(core.calls.filter((c) => c[0] === 'launch')).toEqual([['launch', 'p1', { headless: true }]]);
    expect(await http(port, 'DELETE', '/v1/profiles/p1')).toMatchObject({ status: 400, json: { error: 'Hãy dừng hồ sơ trước khi xoá' } });
    expect(await http(port, 'POST', '/v1/profiles/p1/stop')).toMatchObject({ status: 200, json: { ok: true } });
    expect((await http(port, 'GET', '/v1/profiles/p1')).json).toMatchObject({ run: null });
  });

  it('start không có thân thì chạy có cửa sổ; thân sai dạng bị từ chối', async () => {
    await http(port, 'POST', '/v1/profiles', { body: { name: 'a' } });
    for (const body of [{ headless: 'có' }, { headless: true, extra: 1 }, [true]]) {
      expect((await http(port, 'POST', '/v1/profiles/p1/start', { body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await http(port, 'POST', '/v1/profiles/p1/start')).json).toMatchObject({ headless: false });
  });

  it('cookie: xuất trả count và mảng cookie; nhập nhận text hoặc mảng cookies', async () => {
    await http(port, 'POST', '/v1/profiles', { body: { name: 'a' } });
    const out = await http(port, 'GET', '/v1/profiles/p1/cookies');
    expect(out.json).toEqual({ count: 1, cookies: [{ domain: '.a.com', name: 'sid', value: COOKIE_SECRET, path: '/' }] });
    const byText = await http(port, 'POST', '/v1/profiles/p1/cookies', { body: { text: '# Netscape\n' } });
    expect(byText).toMatchObject({ status: 200, json: { imported: 1, failed: 0 } });
    expect(core.lastCookieText).toBe('# Netscape\n');
    await http(port, 'POST', '/v1/profiles/p1/cookies', { body: { cookies: [{ name: 'a' }] } });
    expect(core.lastCookieText).toBe('[{"name":"a"}]');
    for (const body of [{}, { text: 'a', cookies: [] }, { text: 5 }, { cookies: 'a' }, { text: 'a', extra: 1 }, 'a']) {
      expect((await http(port, 'POST', '/v1/profiles/p1/cookies', { body })).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('nhóm, proxy và kiểm tra proxy; phản hồi proxy không có mật khẩu', async () => {
    expect((await http(port, 'GET', '/v1/groups')).json).toEqual([{ id: 'g1', name: 'airdrop' }]);
    const proxies = await http(port, 'GET', '/v1/proxies');
    expect(proxies.json[0]).toMatchObject({ id: 'x1', host: 'proxy.example', hasPassword: true });
    expect(proxies.text).not.toMatch(/password"|passwordEncrypted/);
    expect(await http(port, 'POST', '/v1/proxies/x1/check')).toMatchObject({ status: 200, json: { lastStatus: 'ok', lastIp: '1.2.3.4' } });
    expect(await http(port, 'POST', '/v1/proxies/zz/check')).toMatchObject({ status: 404, json: { error: 'Không tìm thấy proxy' } });
  });

  it('mã trong đường dẫn được giải mã phần trăm; mã hoá hỏng thì 400', async () => {
    expect(await http(port, 'GET', '/v1/profiles/%E0%A4%A')).toMatchObject({ status: 400, json: { error: 'Mã không hợp lệ' } });
    expect(await http(port, 'GET', '/v1/profiles/a%20b')).toMatchObject({ status: 404 });
  });
});
