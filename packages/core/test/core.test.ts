import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Core } from '../src/core';
import { hostPlatform } from '../src/fingerprint';

class FakeChild extends EventEmitter {
  pid = 1;
  kill(): boolean {
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}
const spawnImpl = ((_exe: string, args: string[]) => {
  const dir = args.find((a) => a.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
  writeFileSync(join(dir, 'DevToolsActivePort'), '9333\n/devtools/browser/abc\n');
  return new FakeChild();
}) as unknown as typeof spawn;

let dataDir: string;
let core: Core;

beforeEach(async () => {
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
  it('info báo trạng thái nhân và hệ điều hành máy', () => {
    const info = core.info();
    expect(info.engineInstalled).toBe(false);
    expect(info.hostPlatform).toBe(hostPlatform());
    expect(info.engineVersion.length).toBeGreaterThan(0);
  });

  it('mật khẩu proxy được mã hoá khi lưu và không lộ ra ngoài', () => {
    const x = core.createProxy({ protocol: 'http', host: 'h', port: 1, username: 'u', password: 'secret' });
    expect(x).toEqual({ id: x.id, protocol: 'http', host: 'h', port: 1, username: 'u', hasPassword: true });
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
});
