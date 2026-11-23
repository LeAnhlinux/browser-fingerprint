import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { hostDefaults } from '../src/fingerprint';
import { ProfileStore } from '../src/store';

let store: ProfileStore;
beforeEach(() => { store = new ProfileStore(':memory:'); });

describe('ProfileStore', () => {
  it('tạo hồ sơ với mặc định theo máy và seed ngẫu nhiên', () => {
    const p = store.createProfile({ name: 'IG-US-01' });
    const d = hostDefaults();
    expect(p.name).toBe('IG-US-01');
    expect(p.platform).toBe(d.platform);
    expect(p.timezone).toBe(d.timezone);
    expect(p.brand).toBe('Chrome');
    expect(p.seed).toBeGreaterThan(0);
    expect(p.groupId).toBeNull();
    expect(store.getProfile(p.id)).toEqual(p);
  });

  it('hai hồ sơ có seed khác nhau', () => {
    const a = store.createProfile({ name: 'a' });
    const b = store.createProfile({ name: 'b' });
    expect(a.seed).not.toBe(b.seed);
  });

  it('cập nhật hồ sơ không đổi seed', () => {
    const p = store.createProfile({ name: 'a' });
    const u = store.updateProfile(p.id, { name: 'b', timezone: 'Asia/Tokyo', hardwareConcurrency: 8 });
    expect(u.name).toBe('b');
    expect(u.timezone).toBe('Asia/Tokyo');
    expect(u.hardwareConcurrency).toBe(8);
    expect(u.seed).toBe(p.seed);
  });

  it('lọc theo từ khoá và theo nhóm', () => {
    const g = store.createGroup('Amazon');
    store.createProfile({ name: 'AMZ-US-01', groupId: g.id });
    store.createProfile({ name: 'FB-US-01' });
    expect(store.listProfiles().length).toBe(2);
    expect(store.listProfiles({ search: 'amz' }).map((p) => p.name)).toEqual(['AMZ-US-01']);
    expect(store.listProfiles({ groupId: g.id }).map((p) => p.name)).toEqual(['AMZ-US-01']);
    expect(store.listProfiles({ groupId: null }).map((p) => p.name)).toEqual(['FB-US-01']);
  });

  it('xoá nhóm thì hồ sơ về chưa gán nhóm', () => {
    const g = store.createGroup('G');
    const p = store.createProfile({ name: 'a', groupId: g.id });
    store.deleteGroup(g.id);
    expect(store.listGroups()).toEqual([]);
    expect(store.getProfile(p.id)!.groupId).toBeNull();
  });

  it('đổi tên nhóm', () => {
    const g = store.createGroup('G');
    store.renameGroup(g.id, 'H');
    expect(store.listGroups()).toEqual([{ id: g.id, name: 'H' }]);
  });

  it('CRUD proxy; xoá proxy thì hồ sơ mất proxy', () => {
    const x = store.createProxy({ protocol: 'socks5', host: '1.2.3.4', port: 1080, username: 'u', passwordEncrypted: 'enc' });
    expect(store.getProxy(x.id)).toEqual(x);
    const u = store.updateProxy(x.id, { port: 1081, passwordEncrypted: null });
    expect(u.port).toBe(1081);
    expect(u.passwordEncrypted).toBeNull();
    const p = store.createProfile({ name: 'a', proxyId: x.id });
    store.deleteProxy(x.id);
    expect(store.listProxies()).toEqual([]);
    expect(store.getProfile(p.id)!.proxyId).toBeNull();
  });

  it('patch bỏ qua khoá nằm trên prototype như constructor', () => {
    const p = store.createProfile({ name: 'a' });
    const updated = store.updateProfile(p.id, { constructor: 'x', toString: 'y', name: 'b' } as never);
    expect(updated.name).toBe('b');
  });

  it('markLaunched ghi phiên bản nhân và thời điểm', () => {
    const p = store.createProfile({ name: 'a' });
    store.markLaunched(p.id, '148.0.7778.215');
    const after = store.getProfile(p.id)!;
    expect(after.engineVersion).toBe('148.0.7778.215');
    expect(after.lastLaunchedAt).toBeGreaterThan(0);
  });

  it('xoá hồ sơ', () => {
    const p = store.createProfile({ name: 'a' });
    store.deleteProfile(p.id);
    expect(store.getProfile(p.id)).toBeNull();
  });

  it('dữ liệu còn nguyên khi mở lại file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'bf-store-')), 'db.sqlite');
    const a = new ProfileStore(file);
    const p = a.createProfile({ name: 'keep' });
    a.close();
    const b = new ProfileStore(file);
    expect(b.getProfile(p.id)).toEqual(p);
    b.close();
  });

  it('proxy mới chưa có kết quả kiểm tra', () => {
    const x = store.createProxy({ protocol: 'http', host: 'h', port: 1, username: null, passwordEncrypted: null });
    expect(x).toMatchObject({ lastCheckedAt: null, lastStatus: null, lastIp: null, lastCountry: null, lastTimezone: null, lastError: null });
    expect(store.getProxy(x.id)).toEqual(x);
  });

  it('saveProxyCheck ghi kết quả; clearProxyCheck xoá', () => {
    const x = store.createProxy({ protocol: 'http', host: 'h', port: 1, username: null, passwordEncrypted: null });
    store.saveProxyCheck(x.id, { ok: true, ip: '203.0.113.7', country: 'US', timezone: 'America/Chicago', error: null });
    const ok = store.getProxy(x.id)!;
    expect(ok).toMatchObject({ lastStatus: 'ok', lastIp: '203.0.113.7', lastCountry: 'US', lastTimezone: 'America/Chicago', lastError: null });
    expect(ok.lastCheckedAt).toBeGreaterThan(0);
    store.saveProxyCheck(x.id, { ok: false, ip: null, country: null, timezone: null, error: 'Hết thời gian' });
    expect(store.getProxy(x.id)).toMatchObject({ lastStatus: 'fail', lastIp: null, lastError: 'Hết thời gian' });
    store.clearProxyCheck(x.id);
    expect(store.getProxy(x.id)).toMatchObject({ lastCheckedAt: null, lastStatus: null, lastError: null });
  });

  it('nâng cấp DB của giai đoạn 1 mà không mất dữ liệu', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'bf-mig-')), 'db.sqlite');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE grp (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE proxy (id TEXT PRIMARY KEY, protocol TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT, password_encrypted TEXT);
      CREATE TABLE profile (id TEXT PRIMARY KEY, name TEXT NOT NULL, group_id TEXT, notes TEXT NOT NULL DEFAULT '', seed INTEGER NOT NULL,
        platform TEXT NOT NULL, platform_version TEXT, brand TEXT NOT NULL, hardware_concurrency INTEGER, lang TEXT NOT NULL,
        accept_lang TEXT NOT NULL, timezone TEXT NOT NULL, proxy_id TEXT, engine_version TEXT, created_at INTEGER NOT NULL, last_launched_at INTEGER);
      INSERT INTO proxy VALUES ('x1', 'socks5', '9.9.9.9', 1080, 'u', 'enc');
      PRAGMA user_version = 1;`);
    old.close();
    const upgraded = new ProfileStore(file);
    expect(upgraded.getProxy('x1')).toMatchObject({ host: '9.9.9.9', passwordEncrypted: 'enc', lastStatus: null });
    upgraded.close();
  });

  it('transaction: ROLLBACK lỗi thì vẫn ném lỗi gốc', () => {
    const db = (store as unknown as { db: DatabaseSync }).db;
    expect(() =>
      store.transaction(() => {
        db.exec('ROLLBACK'); // SQLite đã đóng transaction, ROLLBACK sau đó sẽ lỗi "no transaction is active"
        throw new Error('lỗi gốc');
      }),
    ).toThrow('lỗi gốc');
  });

  it('transaction: lỗi giữa chừng thì không ghi gì', () => {
    expect(() =>
      store.transaction(() => {
        store.createProfile({ name: 'x' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.listProfiles()).toEqual([]);
  });

  it('transaction: thành công thì ghi và trả kết quả', () => {
    const p = store.transaction(() => store.createProfile({ name: 'y' }));
    expect(store.getProfile(p.id)).toEqual(p);
  });
});
