import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Core } from '../src/core';
import type { ProxyCheckResult } from '../src/proxy-checker';
import type { Upstream } from '../src/proxy-bridge';

let core: Core;
let checked: Upstream[];
let nextResult: (u: Upstream) => ProxyCheckResult;

const okResult = (ip: string, country: string, timezone: string): ProxyCheckResult => ({ ok: true, ip, country, timezone, error: null, ms: 5 });

beforeEach(async () => {
  checked = [];
  nextResult = () => okResult('203.0.113.7', 'US', 'America/Chicago');
  core = new Core({
    dataDir: mkdtempSync(join(tmpdir(), 'bf-bulk-')),
    secrets: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
    proxyCheck: async (u) => {
      checked.push(u);
      return nextResult(u);
    },
  });
  await core.init();
});

describe('importProxies', () => {
  it('thêm proxy hợp lệ, bỏ qua trùng, báo lỗi theo dòng, mã hoá mật khẩu', () => {
    core.createProxy({ protocol: 'http', host: '1.1.1.1', port: 80, username: 'u', password: 'old' });
    const r = core.importProxies(['1.1.1.1:80:u:p', '2.2.2.2:81:u2:secret2', '2.2.2.2:81:u2:khac', 'sai dinh dang', 'bad host:80'].join('\n'));
    expect(r.created.map((x) => x.host)).toEqual(['2.2.2.2']);
    expect(r.skipped).toBe(2);
    expect(r.errors.map((e) => e.line)).toEqual([4, 5]);
    expect(JSON.stringify(r)).not.toContain('secret2');
    const stored = core.store.listProxies().find((x) => x.host === '2.2.2.2')!;
    expect(stored.passwordEncrypted).toBe('enc:secret2');
  });

  it('dùng giao thức mặc định được truyền vào', () => {
    expect(core.importProxies('3.3.3.3:1080', 'socks5').created[0].protocol).toBe('socks5');
    expect(() => core.importProxies('3.3.3.3:1080', 'ftp' as never)).toThrow('Giao thức proxy không hợp lệ');
  });
});

describe('checkProxy', () => {
  it('giải mã mật khẩu, lưu kết quả, phát change', async () => {
    const x = core.createProxy({ protocol: 'socks5', host: '9.9.9.9', port: 1080, username: 'u', password: 'pw' });
    let changes = 0;
    core.on('change', () => changes++);
    const view = await core.checkProxy(x.id);
    expect(checked[0]).toEqual({ protocol: 'socks5', host: '9.9.9.9', port: 1080, username: 'u', password: 'pw' });
    expect(view).toMatchObject({ lastStatus: 'ok', lastIp: '203.0.113.7', lastCountry: 'US', lastTimezone: 'America/Chicago' });
    expect(JSON.stringify(view)).not.toContain('pw');
    expect(changes).toBe(1);
  });

  it('proxy lỗi thì lưu trạng thái fail kèm lý do', async () => {
    const x = core.createProxy({ protocol: 'http', host: 'h', port: 1 });
    nextResult = () => ({ ok: false, ip: null, country: null, timezone: null, error: 'Không kết nối được qua proxy', ms: 1 });
    expect(await core.checkProxy(x.id)).toMatchObject({ lastStatus: 'fail', lastError: 'Không kết nối được qua proxy', lastIp: null });
  });

  it('id không tồn tại thì báo lỗi', async () => {
    await expect(core.checkProxy('khong-co')).rejects.toThrow('Không tìm thấy proxy');
  });

  it('checkProxies kiểm tra hết, bỏ qua id không tồn tại', async () => {
    const ids = Array.from({ length: 7 }, (_, i) => core.createProxy({ protocol: 'http', host: `h${i}`, port: 1 }).id);
    await core.checkProxies([...ids, 'khong-co']);
    expect(checked.length).toBe(7);
    expect(core.listProxies().every((x) => x.lastStatus === 'ok')).toBe(true);
  });
});

describe('createProfilesBulk', () => {
  it('đặt tên theo mẫu có {n}, đệm số, gán nhóm', () => {
    const g = core.createGroup('Amazon');
    const made = core.createProfilesBulk({ count: 3, namePattern: 'AMZ-US-{n}', groupId: g.id });
    expect(made.map((p) => p.name)).toEqual(['AMZ-US-01', 'AMZ-US-02', 'AMZ-US-03']);
    expect(made.every((p) => p.groupId === g.id && p.proxyId === null)).toBe(true);
    expect(new Set(made.map((p) => p.seed)).size).toBe(3);
  });

  it('mẫu không có {n} thì nối số; startIndex và độ rộng số', () => {
    expect(core.createProfilesBulk({ count: 2, namePattern: 'Shop', startIndex: 99 }).map((p) => p.name)).toEqual(['Shop-099', 'Shop-100']);
  });

  it('proxyMode unused gán lần lượt proxy chưa dùng', () => {
    const a = core.createProxy({ protocol: 'http', host: 'a', port: 1 });
    const b = core.createProxy({ protocol: 'http', host: 'b', port: 1 });
    const c = core.createProxy({ protocol: 'http', host: 'c', port: 1 });
    core.createProfile({ name: 'cũ', proxyId: a.id });
    const made = core.createProfilesBulk({ count: 2, namePattern: 'P{n}', proxyMode: 'unused' });
    expect(made.map((p) => p.proxyId)).toEqual([b.id, c.id]);
  });

  it('thiếu proxy chưa dùng thì từ chối và không tạo gì', () => {
    core.createProxy({ protocol: 'http', host: 'a', port: 1 });
    expect(() => core.createProfilesBulk({ count: 2, namePattern: 'P{n}', proxyMode: 'unused' })).toThrow('Không đủ proxy chưa dùng: cần 2, có 1');
    expect(core.listProfiles()).toEqual([]);
  });

  it('applyLocale lấy múi giờ và ngôn ngữ từ kết quả kiểm tra của proxy', async () => {
    const a = core.createProxy({ protocol: 'http', host: 'a', port: 1 });
    nextResult = () => okResult('198.51.100.9', 'DE', 'Europe/Berlin');
    await core.checkProxy(a.id);
    const [p] = core.createProfilesBulk({ count: 1, namePattern: 'D{n}', proxyMode: 'unused', applyLocale: true });
    expect(p).toMatchObject({ timezone: 'Europe/Berlin', lang: 'de-DE', acceptLang: 'de-DE,de,en-US,en' });
  });

  it('kiểm tra đầu vào', () => {
    expect(() => core.createProfilesBulk({ count: 0, namePattern: 'x' })).toThrow('Số lượng phải từ 1 đến 500');
    expect(() => core.createProfilesBulk({ count: 501, namePattern: 'x' })).toThrow('Số lượng phải từ 1 đến 500');
    expect(() => core.createProfilesBulk({ count: 1.5, namePattern: 'x' })).toThrow('Số lượng phải từ 1 đến 500');
    expect(() => core.createProfilesBulk({ count: 1, namePattern: '  ' })).toThrow('Tên hồ sơ không được để trống');
    expect(() => core.createProfilesBulk({ count: 1, namePattern: 'x', startIndex: -1 })).toThrow('Số bắt đầu không hợp lệ');
    expect(() => core.createProfilesBulk({ count: 1, namePattern: 'x', groupId: 'khong-co' })).toThrow('Không tìm thấy nhóm');
    expect(() => core.createProfilesBulk({ count: 1, namePattern: 'x', proxyMode: 'sai' as never })).toThrow('Cách gán proxy không hợp lệ');
  });
});

describe('sửa hàng loạt', () => {
  it('updateProfilesBulk đổi nhóm và proxy cho các hồ sơ đã chọn', () => {
    const g = core.createGroup('G');
    const x = core.createProxy({ protocol: 'http', host: 'a', port: 1 });
    const [p1, p2, p3] = core.createProfilesBulk({ count: 3, namePattern: 'P{n}' });
    expect(core.updateProfilesBulk([p1.id, p2.id], { groupId: g.id, proxyId: x.id })).toBe(2);
    const by = new Map(core.listProfiles().map((p) => [p.id, p]));
    expect(by.get(p1.id)).toMatchObject({ groupId: g.id, proxyId: x.id });
    expect(by.get(p3.id)).toMatchObject({ groupId: null, proxyId: null });
  });

  it('updateProfilesBulk: có id sai thì không đổi gì; bỏ qua trường lạ', () => {
    const g = core.createGroup('G');
    const [p1] = core.createProfilesBulk({ count: 1, namePattern: 'P{n}' });
    expect(() => core.updateProfilesBulk([p1.id, 'khong-co'], { groupId: g.id })).toThrow('Không tìm thấy hồ sơ');
    expect(core.listProfiles()[0].groupId).toBeNull();
    expect(() => core.updateProfilesBulk([], { groupId: g.id })).toThrow('Chưa chọn hồ sơ nào');
    core.updateProfilesBulk([p1.id], { groupId: g.id, name: 'đổi' } as never);
    expect(core.listProfiles()[0]).toMatchObject({ groupId: g.id, name: 'P01' });
  });

  it('assignUnusedProxies gán lần lượt theo thứ tự id truyền vào', () => {
    const a = core.createProxy({ protocol: 'http', host: 'a', port: 1 });
    const b = core.createProxy({ protocol: 'http', host: 'b', port: 1 });
    const [p1, p2] = core.createProfilesBulk({ count: 2, namePattern: 'P{n}' });
    expect(core.assignUnusedProxies([p2.id, p1.id])).toBe(2);
    const by = new Map(core.listProfiles().map((p) => [p.id, p.proxyId]));
    expect(by.get(p2.id)).toBe(a.id);
    expect(by.get(p1.id)).toBe(b.id);
  });

  it('assignUnusedProxies thiếu proxy thì từ chối, không gán một phần', () => {
    core.createProxy({ protocol: 'http', host: 'a', port: 1 });
    const made = core.createProfilesBulk({ count: 2, namePattern: 'P{n}' });
    expect(() => core.assignUnusedProxies(made.map((p) => p.id))).toThrow('Không đủ proxy chưa dùng: cần 2, có 1');
    expect(core.listProfiles().every((p) => p.proxyId === null)).toBe(true);
  });

  it('applyProxyLocale cập nhật hồ sơ có proxy đã kiểm tra tốt, bỏ qua số còn lại kèm lý do', async () => {
    const good = core.createProxy({ protocol: 'http', host: 'a', port: 1 });
    const unknownCountry = core.createProxy({ protocol: 'http', host: 'b', port: 1 });
    const unchecked = core.createProxy({ protocol: 'http', host: 'c', port: 1 });
    nextResult = (u) => (u.host === 'a' ? okResult('1.1.1.1', 'JP', 'Asia/Tokyo') : okResult('2.2.2.2', 'ZZ', 'Europe/Paris'));
    await core.checkProxies([good.id, unknownCountry.id]);
    const p1 = core.createProfile({ name: 'p1', proxyId: good.id, lang: 'en-US', acceptLang: 'en-US,en', timezone: 'UTC' });
    const p2 = core.createProfile({ name: 'p2', proxyId: unknownCountry.id, lang: 'en-US', acceptLang: 'en-US,en', timezone: 'UTC' });
    const p3 = core.createProfile({ name: 'p3', proxyId: unchecked.id });
    const p4 = core.createProfile({ name: 'p4' });
    const r = core.applyProxyLocale([p1.id, p2.id, p3.id, p4.id]);
    expect(r.updated).toBe(2);
    expect(r.skipped).toEqual([
      { id: p3.id, name: 'p3', reason: 'Proxy chưa kiểm tra thành công' },
      { id: p4.id, name: 'p4', reason: 'Không có proxy' },
    ]);
    const by = new Map(core.listProfiles().map((p) => [p.id, p]));
    expect(by.get(p1.id)).toMatchObject({ timezone: 'Asia/Tokyo', lang: 'ja-JP', acceptLang: 'ja-JP,ja,en-US,en' });
    expect(by.get(p2.id)).toMatchObject({ timezone: 'Europe/Paris', lang: 'en-US' });
  });
});
