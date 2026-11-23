import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../src/core';
import { hostPlatform } from '../src/fingerprint';

class FakeChild extends EventEmitter {
  pid = 1;
  kill(): boolean {
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}
let cdpDelayMs = 0;
const spawnImpl = ((_exe: string, args: string[]) => {
  const dir = args.find((a) => a.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
  const write = () => writeFileSync(join(dir, 'DevToolsActivePort'), '9333\n/devtools/browser/abc\n');
  if (cdpDelayMs > 0) setTimeout(write, cdpDelayMs);
  else write();
  return new FakeChild();
}) as unknown as typeof spawn;

let dataDir: string;
let core: Core;

beforeEach(async () => {
  cdpDelayMs = 0;
  dataDir = mkdtempSync(join(tmpdir(), 'bf-core-'));
  core = new Core({
    dataDir,
    secrets: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
    launcherOverrides: {
      engine: { executablePath: () => '/engine/chrome', release: () => ({ version: '1.2.3' }) },
      spawnImpl,
      closeBrowser: async () => { throw new Error('no cdp'); },
    },
  });
  await core.init();
});

describe('Core', () => {
  it('sửa proxy phát change để giao diện tải lại; không đổi gì thì không phát', () => {
    const x = core.createProxy({ protocol: 'http', host: 'h', port: 1 });
    const changes: string[] = [];
    core.on('change', (id: string) => changes.push(id));
    core.updateProxy(x.id, {});
    expect(changes).toEqual([]);
    core.updateProxy(x.id, { port: 2 });
    expect(changes).toHaveLength(1);
  });

  it('múi giờ nhập tay phải là múi giờ IANA hợp lệ và được lưu dạng chuẩn', () => {
    expect(core.createProfile({ name: 'a', timezone: 'america/chicago' }).timezone).toBe('America/Chicago');
    const p = core.createProfile({ name: 'b' });
    expect(core.updateProfile(p.id, { timezone: 'Europe/Berlin' }).timezone).toBe('Europe/Berlin');
    for (const tz of ['Sao/Hoa', 'America/Chi cago', '--flag=1', '', '+01:00']) {
      expect(() => core.createProfile({ name: 'x', timezone: tz })).toThrow('Múi giờ không hợp lệ');
      expect(() => core.updateProfile(p.id, { timezone: tz })).toThrow('Múi giờ không hợp lệ');
    }
    expect(core.store.getProfile(p.id)!.timezone).toBe('Europe/Berlin');
  });

  it('ngôn ngữ nhập tay phải là thẻ ngôn ngữ hợp lệ', () => {
    expect(core.createProfile({ name: 'a', lang: 'vi-VN' }).lang).toBe('vi-VN');
    expect(core.createProfile({ name: 'b', lang: 'zh-Hant-TW' }).lang).toBe('zh-Hant-TW');
    const p = core.createProfile({ name: 'c' });
    for (const lang of ['en US', '--lang=x', 'e', '', 'en-', `en-${'a'.repeat(40)}`, 'en_US']) {
      expect(() => core.createProfile({ name: 'x', lang })).toThrow('Ngôn ngữ không hợp lệ');
      expect(() => core.updateProfile(p.id, { lang })).toThrow('Ngôn ngữ không hợp lệ');
    }
  });

  it('Accept-Language nhập tay: 1 đến 10 thẻ, cắt khoảng trắng, nối bằng dấu phẩy', () => {
    expect(core.createProfile({ name: 'a', acceptLang: ' vi-VN , vi,en-US ,en' }).acceptLang).toBe('vi-VN,vi,en-US,en');
    const p = core.createProfile({ name: 'b' });
    const tooMany = Array.from({ length: 11 }, () => 'en').join(',');
    for (const acceptLang of ['', ',', 'en,,vi', 'en US', '--accept-lang=x', 'en;q=0.9', tooMany]) {
      expect(() => core.createProfile({ name: 'x', acceptLang })).toThrow('Accept-Language không hợp lệ');
      expect(() => core.updateProfile(p.id, { acceptLang })).toThrow('Accept-Language không hợp lệ');
    }
  });

  it('tạo hồ sơ không ghi ngôn ngữ nào thì vẫn dùng mặc định của máy', () => {
    const p = core.createProfile({ name: 'mặc định' });
    expect(p.timezone.length).toBeGreaterThan(0);
    expect(p.lang.length).toBeGreaterThan(0);
    expect(core.updateProfile(p.id, { notes: 'ghi chú' }).lang).toBe(p.lang);
  });

  it('sửa thông tin kết nối của proxy thì xoá kết quả kiểm tra cũ; chỉ đọc thì giữ', () => {
    const x = core.createProxy({ protocol: 'http', host: 'h', port: 1 });
    core.store.saveProxyCheck(x.id, { ok: true, ip: '203.0.113.7', country: 'US', timezone: 'America/Chicago', error: null });
    expect(core.listProxies()[0].lastStatus).toBe('ok');
    expect(core.updateProxy(x.id, {}).lastStatus).toBe('ok');
    expect(core.updateProxy(x.id, { port: 2 }).lastStatus).toBeNull();
  });

  it('sửa proxy: nếu xoá kết quả kiểm tra lỗi thì không đổi gì cả', () => {
    const x = core.createProxy({ protocol: 'http', host: 'h', port: 1 });
    core.store.saveProxyCheck(x.id, { ok: true, ip: '203.0.113.7', country: 'US', timezone: 'America/Chicago', error: null });
    const spy = vi.spyOn(core.store, 'clearProxyCheck').mockImplementation(() => {
      throw new Error('hỏng');
    });
    expect(() => core.updateProxy(x.id, { port: 2 })).toThrow('hỏng');
    spy.mockRestore();
    expect(core.store.getProxy(x.id)).toMatchObject({ port: 1, lastStatus: 'ok', lastIp: '203.0.113.7' });
  });

  it('info báo trạng thái nhân và hệ điều hành máy', () => {
    const info = core.info();
    expect(info.engineInstalled).toBe(false);
    expect(info.hostPlatform).toBe(hostPlatform());
    expect(info.engineVersion.length).toBeGreaterThan(0);
  });

  it('mật khẩu proxy được mã hoá khi lưu và không lộ ra ngoài', () => {
    const x = core.createProxy({ protocol: 'http', host: 'h', port: 1, username: 'u', password: 'secret' });
    expect(x).toEqual({ id: x.id, protocol: 'http', host: 'h', port: 1, username: 'u', hasPassword: true,
      lastCheckedAt: null, lastStatus: null, lastIp: null, lastCountry: null, lastTimezone: null, lastError: null });
    expect(JSON.stringify(core.listProxies())).not.toContain('secret');
    expect(core.store.getProxy(x.id)!.passwordEncrypted).toBe('enc:secret');
  });

  it('sửa proxy: bỏ trống mật khẩu là giữ, chuỗi rỗng là xoá', () => {
    const x = core.createProxy({ protocol: 'http', host: 'h', port: 1, username: 'u', password: 'secret' });
    expect(core.updateProxy(x.id, { port: 2 }).hasPassword).toBe(true);
    expect(core.store.getProxy(x.id)!.port).toBe(2);
    expect(core.updateProxy(x.id, { password: '' }).hasPassword).toBe(false);
  });

  it('listProfiles kèm trạng thái chạy', async () => {
    const p = core.createProfile({ name: 'a' });
    expect(core.listProfiles()[0].run).toBeNull();
    await core.launch(p.id);
    expect(core.listProfiles()[0].run!.cdpPort).toBe(9333);
  });

  it('từ chối xoá hồ sơ đang chạy; dừng rồi thì xoá cả thư mục dữ liệu', async () => {
    const p = core.createProfile({ name: 'a' });
    await core.launch(p.id);
    expect(() => core.deleteProfile(p.id)).toThrow('Hãy dừng hồ sơ trước khi xoá');
    await core.stop(p.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(join(dataDir, 'profiles', p.id))).toBe(true);
    core.deleteProfile(p.id);
    expect(existsSync(join(dataDir, 'profiles', p.id))).toBe(false);
    expect(core.listProfiles()).toEqual([]);
  });

  it('phát change khi khởi chạy và khi dừng', async () => {
    const p = core.createProfile({ name: 'a' });
    let n = 0;
    core.on('change', () => n++);
    await core.launch(p.id);
    await core.stop(p.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(n).toBe(2);
  });

  it('xoá hồ sơ với mã không tồn tại hoặc mã đường dẫn thì báo lỗi và không đụng đĩa', async () => {
    const other = core.createProfile({ name: 'b' });
    await core.launch(other.id);
    await core.stop(other.id);
    await new Promise((r) => setTimeout(r, 20));
    const sentinel = join(dataDir, 'sentinel.txt');
    writeFileSync(sentinel, 'x');
    mkdirSync(join(dataDir, 'profiles', 'x'), { recursive: true });
    for (const bad of ['..', '', '../x', '.', crypto.randomUUID()]) {
      expect(() => core.deleteProfile(bad), `id=${JSON.stringify(bad)}`).toThrow('Không tìm thấy hồ sơ');
    }
    expect(existsSync(sentinel)).toBe(true);
    expect(existsSync(join(dataDir, 'profiles', 'x'))).toBe(true);
    expect(existsSync(join(dataDir, 'profiles', other.id))).toBe(true);
    expect(core.listProfiles()).toHaveLength(1);
  });

  it('từ chối xoá hồ sơ khi lần khởi chạy còn đang dở', async () => {
    cdpDelayMs = 150;
    const p = core.createProfile({ name: 'a' });
    const pending = core.launch(p.id);
    await new Promise((r) => setTimeout(r, 30));
    expect(core.listProfiles()[0].run).toBeNull();
    expect(() => core.deleteProfile(p.id)).toThrow('Hãy dừng hồ sơ trước khi xoá');
    expect(existsSync(join(dataDir, 'profiles', p.id))).toBe(true);
    await pending;
    await core.stop(p.id);
    await new Promise((r) => setTimeout(r, 20));
    core.deleteProfile(p.id);
    expect(core.listProfiles()).toEqual([]);
  });
  it('từ chối xoá proxy đang được hồ sơ dùng; đổi proxy của hồ sơ rồi thì xoá được', () => {
    const x = core.createProxy({ protocol: 'http', host: 'h', port: 1 });
    const a = core.createProfile({ name: 'A', proxyId: x.id });
    const b = core.createProfile({ name: 'B', proxyId: x.id });
    expect(() => core.deleteProxy(x.id)).toThrow('Proxy đang được dùng bởi hồ sơ: A, B. Hãy đổi proxy của các hồ sơ đó trước.');
    expect(core.listProxies()).toHaveLength(1);
    expect(core.store.getProfile(a.id)!.proxyId).toBe(x.id);
    core.updateProfile(a.id, { proxyId: null });
    expect(() => core.deleteProxy(x.id)).toThrow('Proxy đang được dùng bởi hồ sơ: B.');
    core.updateProfile(b.id, { proxyId: null });
    core.deleteProxy(x.id);
    expect(core.listProxies()).toEqual([]);
  });

  it('xoá proxy không tồn tại thì báo lỗi', () => {
    expect(() => core.deleteProxy('nope')).toThrow('Không tìm thấy proxy');
  });

  it('createProxy từ chối dữ liệu không hợp lệ', () => {
    const ok = { protocol: 'http' as const, host: 'h', port: 1 };
    expect(() => core.createProxy({ ...ok, protocol: 'ftp' as never })).toThrow('Giao thức proxy không hợp lệ');
    for (const host of ['', '   ', 'bad host with spaces', 'a/b', 'u@h', 'h:80', 'a:b:c:d:e:f:g:h:i']) {
      expect(() => core.createProxy({ ...ok, host }), `host=${JSON.stringify(host)}`).toThrow('Máy chủ proxy không hợp lệ');
    }
    for (const port of [0, 65536, 1.5, -1, NaN, '80' as never]) {
      expect(() => core.createProxy({ ...ok, port }), `port=${String(port)}`).toThrow('Cổng proxy phải là số nguyên từ 1 đến 65535');
    }
    expect(() => core.createProxy({ ...ok, password: 'x' })).toThrow('Cần tài khoản khi có mật khẩu');
    expect(core.listProxies()).toEqual([]);
  });

  it('createProxy chấp nhận hostname, IPv4, IPv6 và cắt khoảng trắng', () => {
    expect(core.createProxy({ protocol: 'socks5', host: '  proxy.example.net ', port: 1080 }).host).toBe('proxy.example.net');
    expect(core.createProxy({ protocol: 'http', host: '10.0.0.1', port: 65535 }).port).toBe(65535);
    expect(core.createProxy({ protocol: 'http', host: '2001:db8::1', port: 8080 }).host).toBe('2001:db8::1');
  });

  it('updateProxy kiểm tra trên dòng kết quả và chỉ nhận các trường cho phép', () => {
    const x = core.createProxy({ protocol: 'http', host: 'h', port: 1, username: 'u', password: 'secret' });
    expect(() => core.updateProxy('nope', { port: 2 })).toThrow('Không tìm thấy proxy');
    expect(() => core.updateProxy(x.id, { host: 'bad host' })).toThrow('Máy chủ proxy không hợp lệ');
    expect(() => core.updateProxy(x.id, { port: 1.5 })).toThrow('Cổng proxy phải là số nguyên từ 1 đến 65535');
    expect(() => core.updateProxy(x.id, { protocol: 'ftp' as never })).toThrow('Giao thức proxy không hợp lệ');
    expect(() => core.updateProxy(x.id, { username: '' })).toThrow('Cần tài khoản khi có mật khẩu');
    expect(core.updateProxy(x.id, { username: '', password: '' }).hasPassword).toBe(false);
    const y = core.createProxy({ protocol: 'http', host: 'h2', port: 1 });
    expect(() => core.updateProxy(y.id, { password: 'p' })).toThrow('Cần tài khoản khi có mật khẩu');
    core.updateProxy(y.id, { host: ' h3 ', username: 'u2', passwordEncrypted: 'evil', id: 'evil' } as never);
    const row = core.store.getProxy(y.id)!;
    expect(row).toMatchObject({ id: y.id, host: 'h3', username: 'u2', passwordEncrypted: null });
  });

  it('hồ sơ: tên rỗng, proxy/nhóm không tồn tại, hồ sơ không tồn tại', () => {
    expect(() => core.createProfile({ name: '   ' })).toThrow('Tên hồ sơ không được để trống');
    expect(() => core.createProfile({ name: 'a', proxyId: 'nope' })).toThrow('Không tìm thấy proxy');
    expect(() => core.createProfile({ name: 'a', groupId: 'nope' })).toThrow('Không tìm thấy nhóm');
    expect(core.listProfiles()).toEqual([]);
    const p = core.createProfile({ name: ' a ' });
    expect(p.name).toBe('a');
    expect(() => core.updateProfile('nope', { name: 'b' })).toThrow('Không tìm thấy hồ sơ');
    expect(() => core.updateProfile(p.id, { name: '  ' })).toThrow('Tên hồ sơ không được để trống');
    expect(() => core.updateProfile(p.id, { proxyId: 'nope' })).toThrow('Không tìm thấy proxy');
    expect(() => core.updateProfile(p.id, { groupId: 'nope' })).toThrow('Không tìm thấy nhóm');
    const g = core.createGroup('g');
    expect(core.updateProfile(p.id, { groupId: g.id, proxyId: null }).groupId).toBe(g.id);
    expect(core.updateProfile(p.id, { notes: 'n' }).name).toBe('a');
  });

  it('proxyId và groupId rỗng được coi là null', () => {
    const p = core.createProfile({ name: 'a', proxyId: '', groupId: '' });
    expect(p.proxyId).toBeNull();
    expect(p.groupId).toBeNull();
    const x = core.createProxy({ protocol: 'http', host: 'h', port: 1 });
    core.updateProfile(p.id, { proxyId: x.id });
    expect(core.updateProfile(p.id, { proxyId: '' }).proxyId).toBeNull();
  });

  it('từ chối trường hồ sơ không hợp lệ khi tạo và khi sửa', () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ platform: 'android' }, 'Hệ điều hành không hợp lệ'],
      [{ platform: null }, 'Hệ điều hành không hợp lệ'],
      [{ platformVersion: '10 --no-sandbox' }, 'Phiên bản hệ điều hành không hợp lệ'],
      [{ platformVersion: 15 }, 'Phiên bản hệ điều hành không hợp lệ'],
      [{ brand: 'Chrome --flag' }, 'Tên trình duyệt không hợp lệ'],
      [{ brand: '' }, 'Tên trình duyệt không hợp lệ'],
      [{ brand: 7 }, 'Tên trình duyệt không hợp lệ'],
      [{ hardwareConcurrency: 0 }, 'Số nhân CPU phải là số nguyên từ 1 đến 128'],
      [{ hardwareConcurrency: 2.5 }, 'Số nhân CPU phải là số nguyên từ 1 đến 128'],
      [{ hardwareConcurrency: '8' }, 'Số nhân CPU phải là số nguyên từ 1 đến 128'],
      [{ notes: 5 }, 'Ghi chú không hợp lệ'],
      [{ notes: 'x'.repeat(5001) }, 'Ghi chú tối đa 5000 ký tự'],
    ];
    const p = core.createProfile({ name: 'gốc' });
    for (const [fields, message] of bad) {
      expect(() => core.createProfile({ name: 'x', ...fields } as never), JSON.stringify(fields)).toThrow(message);
      expect(() => core.updateProfile(p.id, fields as never), JSON.stringify(fields)).toThrow(message);
    }
    expect(core.listProfiles().map((x) => x.name)).toEqual(['gốc']);
  });

  it('nhận trường hồ sơ hợp lệ; phiên bản hệ điều hành rỗng thành null', () => {
    const p = core.createProfile({ name: 'a', platform: 'windows', platformVersion: '10.0.19045', brand: 'Edge', hardwareConcurrency: 8, notes: 'ghi chú' });
    expect(p).toMatchObject({ platform: 'windows', platformVersion: '10.0.19045', brand: 'Edge', hardwareConcurrency: 8, notes: 'ghi chú' });
    const u = core.updateProfile(p.id, { platformVersion: '' as never, hardwareConcurrency: null });
    expect(u.platformVersion).toBeNull();
    expect(u.hardwareConcurrency).toBeNull();
  });

  it('getProfile trả hồ sơ kèm trạng thái chạy và extensionIds, hoặc báo không tìm thấy', async () => {
    const p = core.createProfile({ name: 'a' });
    expect(core.getProfile(p.id)).toMatchObject({ id: p.id, name: 'a', run: null, extensionIds: [] });
    await core.launch(p.id);
    expect(core.getProfile(p.id).run).toMatchObject({ profileId: p.id, headless: false });
    await core.stop(p.id);
    expect(() => core.getProfile('không-có')).toThrow('Không tìm thấy hồ sơ');
    expect(() => core.getProfile(5 as never)).toThrow('Không tìm thấy hồ sơ');
  });

  it('launch nhận tuỳ chọn headless và từ chối tuỳ chọn sai kiểu', async () => {
    const p = core.createProfile({ name: 'a' });
    const run = await core.launch(p.id, { headless: true });
    expect(run.headless).toBe(true);
    await core.stop(p.id);
    expect((await core.launch(p.id)).headless).toBe(false);
    await core.stop(p.id);
    await expect(core.launch(p.id, { headless: 'có' } as never)).rejects.toThrow('Tham số không hợp lệ');
    await expect(core.launch(p.id, 'headless' as never)).rejects.toThrow('Tham số không hợp lệ');
    expect(core.getProfile(p.id).run).toBeNull();
  });

  it('mọi thay đổi hồ sơ, nhóm, proxy đều phát change', () => {
    let count = 0;
    core.on('change', () => count++);
    const step = (fn: () => void): void => {
      const before = count;
      fn();
      expect(count, fn.toString()).toBeGreaterThan(before);
    };
    let profileId = '';
    let groupId = '';
    let proxyId = '';
    step(() => { profileId = core.createProfile({ name: 'a' }).id; });
    step(() => { core.updateProfile(profileId, { name: 'b' }); });
    step(() => { groupId = core.createGroup('g').id; });
    step(() => { core.renameGroup(groupId, 'g2'); });
    step(() => { proxyId = core.createProxy({ protocol: 'http', host: 'h', port: 1 }).id; });
    step(() => { core.deleteProxy(proxyId); });
    step(() => { core.deleteGroup(groupId); });
    step(() => { core.deleteProfile(profileId); });
  });

  it('thao tác thất bại thì không phát change', () => {
    let count = 0;
    core.on('change', () => count++);
    expect(() => core.createProfile({ name: '' })).toThrow();
    expect(() => core.updateProfile('không-có', { name: 'x' })).toThrow();
    expect(() => core.deleteProfile('không-có')).toThrow();
    expect(() => core.deleteProxy('không-có')).toThrow();
    expect(count).toBe(0);
  });
});
