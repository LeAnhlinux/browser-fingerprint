import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../src/core';
import type { ProxyCheckResult } from '../src/proxy-checker';
import type { Upstream } from '../src/proxy-bridge';

let core: Core;
let checked: Upstream[];
let nextResult: (u: Upstream) => ProxyCheckResult;

const okResult = (ip: string, country: string, timezone: string): ProxyCheckResult => ({ ok: true, ip, country, timezone, error: null, ms: 5, rateLimited: false });

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

afterEach(() => vi.restoreAllMocks());

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
    nextResult = () => ({ ok: false, ip: null, country: null, timezone: null, error: 'Không kết nối được qua proxy', ms: 1, rateLimited: false });
    expect(await core.checkProxy(x.id)).toMatchObject({ lastStatus: 'fail', lastError: 'Không kết nối được qua proxy', lastIp: null });
  });

  it('bị giới hạn tốc độ thì không lưu, giữ kết quả cũ và báo lỗi', async () => {
    const x = core.createProxy({ protocol: 'http', host: 'h', port: 1 });
    await core.checkProxy(x.id);
    const before = core.listProxies()[0];
    expect(before.lastStatus).toBe('ok');
    nextResult = () => ({ ok: false, ip: null, country: null, timezone: null, error: 'x', ms: 1, rateLimited: true });
    let changes = 0;
    core.on('change', () => changes++);
    await expect(core.checkProxy(x.id)).rejects.toThrow('Dịch vụ tra IP đang giới hạn tốc độ, hãy thử lại sau');
    expect(core.listProxies()[0]).toEqual(before);
    expect(changes).toBe(0);
    await expect(core.checkProxies([x.id])).resolves.toBeUndefined();
    expect(core.listProxies()[0]).toEqual(before);
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

  it('applyLocale với proxy chưa kiểm tra thành công thì từ chối cả thao tác', async () => {
    const a = core.createProxy({ protocol: 'http', host: 'a', port: 1 });
    core.createProxy({ protocol: 'http', host: 'b', port: 1 });
    core.createProxy({ protocol: 'http', host: 'c', port: 1 });
    nextResult = () => okResult('198.51.100.9', 'DE', 'Europe/Berlin');
    await core.checkProxy(a.id);
    const spare = core.createProxy({ protocol: 'http', host: 'd', port: 1 });
    expect(() => core.createProfilesBulk({ count: 3, namePattern: 'D{n}', proxyMode: 'unused', applyLocale: true })).toThrow(
      'Có 2 proxy chưa kiểm tra thành công. Hãy bấm "Kiểm tra tất cả" trước khi tạo.',
    );
    expect(core.listProfiles()).toEqual([]);
    // Proxy dư ngoài số được gán không bị tính.
    await core.checkProxies(core.listProxies().slice(0, 3).map((x) => x.id));
    expect(core.listProxies().find((x) => x.id === spare.id)!.lastStatus).toBeNull();
    const made = core.createProfilesBulk({ count: 3, namePattern: 'D{n}', proxyMode: 'unused', applyLocale: true });
    expect(made.every((p) => p.timezone === 'Europe/Berlin' && p.proxyId !== spare.id)).toBe(true);
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

function throwOnCall<T extends object, K extends keyof T>(obj: T, key: K, nth: number): void {
  const real = (obj[key] as unknown as (...a: unknown[]) => unknown).bind(obj);
  let calls = 0;
  vi.spyOn(obj, key as never).mockImplementation(((...a: unknown[]) => {
    if (++calls === nth) throw new Error('lỗi ghi giả lập');
    return real(...a);
  }) as never);
}

describe('rollback giữa chừng', () => {
  it('createProfilesBulk: ghi lỗi ở hồ sơ thứ 3 thì không tạo gì', () => {
    throwOnCall(core.store, 'createProfile', 3);
    expect(() => core.createProfilesBulk({ count: 5, namePattern: 'P{n}' })).toThrow('lỗi ghi giả lập');
    vi.restoreAllMocks();
    expect(core.listProfiles()).toEqual([]);
  });

  it('assignUnusedProxies: ghi lỗi ở lần thứ 2 thì không gán gì', () => {
    for (const h of ['a', 'b', 'c']) core.createProxy({ protocol: 'http', host: h, port: 1 });
    const made = core.createProfilesBulk({ count: 3, namePattern: 'P{n}' });
    throwOnCall(core.store, 'updateProfile', 2);
    expect(() => core.assignUnusedProxies(made.map((p) => p.id))).toThrow('lỗi ghi giả lập');
    vi.restoreAllMocks();
    expect(core.listProfiles().every((p) => p.proxyId === null)).toBe(true);
  });

  it('updateProfilesBulk: ghi lỗi ở lần thứ 2 thì không đổi gì', () => {
    const g = core.createGroup('G');
    const made = core.createProfilesBulk({ count: 3, namePattern: 'P{n}' });
    throwOnCall(core.store, 'updateProfile', 2);
    expect(() => core.updateProfilesBulk(made.map((p) => p.id), { groupId: g.id })).toThrow('lỗi ghi giả lập');
    vi.restoreAllMocks();
    expect(core.listProfiles().every((p) => p.groupId === null)).toBe(true);
  });

  it('applyProxyLocale: ghi lỗi ở lần thứ 2 thì không đổi gì', async () => {
    const xs = [core.createProxy({ protocol: 'http', host: 'a', port: 1 }), core.createProxy({ protocol: 'http', host: 'b', port: 1 })];
    await core.checkProxies(xs.map((x) => x.id));
    const ps = xs.map((x, i) => core.createProfile({ name: `p${i}`, proxyId: x.id, timezone: 'UTC' }));
    throwOnCall(core.store, 'updateProfile', 2);
    expect(() => core.applyProxyLocale(ps.map((p) => p.id))).toThrow('lỗi ghi giả lập');
    vi.restoreAllMocks();
    expect(core.listProfiles().every((p) => p.timezone === 'UTC')).toBe(true);
  });

  it('importProxies: lỗi lưu trữ ở lần ghi thứ 2 thì hủy cả lần nhập', () => {
    throwOnCall(core.store, 'createProxy', 2);
    expect(() => core.importProxies('1.1.1.1:80\n2.2.2.2:80\n3.3.3.3:80')).toThrow('lỗi ghi giả lập');
    vi.restoreAllMocks();
    expect(core.store.listProxies()).toEqual([]);
  });
});

describe('proxy đổi trong lúc kiểm tra', () => {
  it('không lưu kết quả cũ cho điểm cuối mới', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = new Core({
      dataDir: mkdtempSync(join(tmpdir(), 'bf-bulk-')),
      secrets: { encrypt: (s) => s, decrypt: (s) => s },
      proxyCheck: async () => {
        await gate;
        return okResult('9.9.9.9', 'FR', 'Europe/Paris');
      },
    });
    const y = slow.createProxy({ protocol: 'http', host: 'a', port: 1 });
    const pending = slow.checkProxy(y.id);
    slow.updateProxy(y.id, { port: 2 });
    release();
    await expect(pending).rejects.toThrow('Proxy đã thay đổi trong lúc kiểm tra, hãy kiểm tra lại');
    expect(slow.listProxies()[0].lastStatus).toBeNull();
    await slow.shutdown();
  });
});

describe('checkProxies', () => {
  it('không chạy quá 5 kiểm tra cùng lúc và bỏ id trùng', async () => {
    let running = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const c = new Core({
      dataDir: mkdtempSync(join(tmpdir(), 'bf-bulk-')),
      secrets: { encrypt: (s) => s, decrypt: (s) => s },
      proxyCheck: async () => {
        peak = Math.max(peak, ++running);
        await gate;
        running--;
        return okResult('1.1.1.1', 'US', 'America/Chicago');
      },
    });
    const ids = Array.from({ length: 12 }, (_, i) => c.createProxy({ protocol: 'http', host: `h${i}`, port: 1 }).id);
    const done = c.checkProxies([...ids, ...ids]);
    await new Promise((r) => setTimeout(r, 20));
    expect(running).toBe(5);
    release();
    await done;
    expect(peak).toBe(5);
    expect(c.listProxies().every((x) => x.lastStatus === 'ok')).toBe(true);
    await c.shutdown();
  });

  it('từ chối quá 1000 id', async () => {
    await expect(core.checkProxies(Array.from({ length: 1001 }, (_, i) => `x${i}`))).rejects.toThrow('Kiểm tra tối đa 1000 proxy một lần');
  });
});

describe('id trùng', () => {
  it('assignUnusedProxies và updateProfilesBulk coi id trùng là một hồ sơ', () => {
    const a = core.createProxy({ protocol: 'http', host: 'a', port: 1 });
    const g = core.createGroup('G');
    const [p1] = core.createProfilesBulk({ count: 1, namePattern: 'P{n}' });
    expect(core.assignUnusedProxies([p1.id, p1.id])).toBe(1);
    expect(core.listProfiles()[0].proxyId).toBe(a.id);
    expect(core.updateProfilesBulk([p1.id, p1.id], { groupId: g.id })).toBe(1);
  });

  it('applyProxyLocale đếm theo hồ sơ riêng biệt', async () => {
    const x = core.createProxy({ protocol: 'http', host: 'a', port: 1 });
    await core.checkProxy(x.id);
    const p = core.createProfile({ name: 'p', proxyId: x.id });
    const none = core.createProfile({ name: 'q' });
    const r = core.applyProxyLocale([p.id, p.id, none.id, none.id]);
    expect(r.updated).toBe(1);
    expect(r.skipped).toHaveLength(1);
  });
});

describe('kiểm tra đầu vào bổ sung', () => {
  it('proxyId/groupId sai kiểu bị từ chối, không bị ép thành null', () => {
    const x = core.createProxy({ protocol: 'http', host: 'a', port: 1 });
    const p = core.createProfile({ name: 'p', proxyId: x.id });
    for (const bad of [0, false, Number.NaN, {}]) {
      expect(() => core.updateProfilesBulk([p.id], { proxyId: bad as never })).toThrow('Tham số không hợp lệ');
      expect(() => core.updateProfilesBulk([p.id], { groupId: bad as never })).toThrow('Tham số không hợp lệ');
      expect(() => core.createProfilesBulk({ count: 1, namePattern: 'x', groupId: bad as never })).toThrow('Tham số không hợp lệ');
      expect(() => core.updateProfile(p.id, { proxyId: bad as never })).toThrow('Tham số không hợp lệ');
      expect(() => core.createProfile({ name: 'y', groupId: bad as never })).toThrow('Tham số không hợp lệ');
    }
    expect(core.listProfiles()[0].proxyId).toBe(x.id);
  });

  it('tên: giới hạn độ dài, ký tự điều khiển; startIndex tối đa', () => {
    expect(() => core.createProfilesBulk({ count: 1, namePattern: 'a'.repeat(201) })).toThrow('Tên hồ sơ tối đa 200 ký tự');
    expect(() => core.createProfilesBulk({ count: 1, namePattern: 'a\nb' })).toThrow('Tên hồ sơ chứa ký tự không hợp lệ');
    expect(() => core.createProfile({ name: 'a\u0000' })).toThrow('Tên hồ sơ chứa ký tự không hợp lệ');
    expect(() => core.createProfilesBulk({ count: 1, namePattern: 'x', startIndex: 1_000_000_001 })).toThrow('Số bắt đầu không hợp lệ');
    expect(() => core.createProfilesBulk({ count: 1, namePattern: 'a'.repeat(200) })).toThrow('Tên hồ sơ tối đa 200 ký tự');
    expect(core.listProfiles()).toEqual([]);
  });

  it('input/patch không phải đối tượng', () => {
    const [p] = core.createProfilesBulk({ count: 1, namePattern: 'P{n}' });
    for (const bad of [null, [], 'x']) {
      expect(() => core.createProfilesBulk(bad as never)).toThrow('Tham số không hợp lệ');
      expect(() => core.updateProfilesBulk([p.id], bad as never)).toThrow('Tham số không hợp lệ');
    }
  });

  it('importProxies: giới hạn kích thước', () => {
    expect(() => core.importProxies('a'.repeat(1_000_001))).toThrow('Danh sách proxy quá dài (tối đa 5000 dòng)');
    expect(() => core.importProxies(Array.from({ length: 5001 }, (_, i) => `h${i}:1`).join('\n'))).toThrow('Danh sách proxy quá dài (tối đa 5000 dòng)');
  });
});
