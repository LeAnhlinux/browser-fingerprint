import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
