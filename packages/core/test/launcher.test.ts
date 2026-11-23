import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LaunchError, Launcher, type LauncherDeps } from '../src/launcher';
import { ProfileStore } from '../src/store';

class FakeChild extends EventEmitter {
  pid = 4242;
  killed = false;
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}

function fakeSpawn(writeCdp = true) {
  const calls: { exe: string; args: string[]; child: FakeChild }[] = [];
  const impl = ((exe: string, args: string[]) => {
    const child = new FakeChild();
    calls.push({ exe, args, child });
    const dir = args.find((a) => a.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
    if (writeCdp) writeFileSync(join(dir, 'DevToolsActivePort'), '9333\n/devtools/browser/abc\n');
    else queueMicrotask(() => child.emit('exit', 1));
    return child;
  }) as unknown as typeof spawn;
  return { impl, calls };
}

let store: ProfileStore;
let profilesDir: string;
let bridgeClosed: number;
let deps: LauncherDeps;
let sp: ReturnType<typeof fakeSpawn>;

beforeEach(() => {
  store = new ProfileStore(':memory:');
  profilesDir = mkdtempSync(join(tmpdir(), 'bf-launch-'));
  bridgeClosed = 0;
  sp = fakeSpawn();
  deps = {
    store,
    engine: { executablePath: () => '/engine/chrome', release: () => ({ version: '1.2.3' }) },
    profilesDir,
    secrets: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
    spawnImpl: sp.impl,
    openBridge: async () => ({ url: 'http://127.0.0.1:5555', close: async () => { bridgeClosed++; } }),
    checkReachable: async () => {},
    closeBrowser: async () => { throw new Error('không có CDP thật'); },
    cdpTimeoutMs: 500,
    windowWatchMs: 0,
  };
});

describe('Launcher: đóng hết cửa sổ thì dừng', () => {
  const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

  function withCounts(seq: (number | null)[]) {
    let i = 0;
    const ports: number[] = [];
    const countPages = async (port: number): Promise<number | null> => {
      ports.push(port);
      return seq[Math.min(i++, seq.length - 1)];
    };
    return { countPages, ports };
  }

  it('có tab rồi hết tab hai lần liền thì dừng hồ sơ', async () => {
    const p = store.createProfile({ name: 'a' });
    const c = withCounts([1, 2, 0, 0]);
    const l = new Launcher({ ...deps, windowWatchMs: 5, countPages: c.countPages });
    await l.launch(p.id);
    await tick();
    expect(sp.calls[0].child.killed).toBe(true);
    expect(l.status(p.id)).toBeNull();
    expect(c.ports[0]).toBe(9333);
  });

  it('chưa từng có tab thì không dừng (nhân đang mở cửa sổ đầu)', async () => {
    const p = store.createProfile({ name: 'a' });
    const l = new Launcher({ ...deps, windowWatchMs: 5, countPages: withCounts([0]).countPages });
    await l.launch(p.id);
    await tick();
    expect(l.status(p.id)).not.toBeNull();
  });

  it('chỉ một lần thấy 0 tab hoặc không hỏi được thì không dừng', async () => {
    const p = store.createProfile({ name: 'a' });
    const l = new Launcher({ ...deps, windowWatchMs: 5, countPages: withCounts([1, 0, 1, null, null, 0, null, 1]).countPages });
    await l.launch(p.id);
    await tick();
    expect(l.status(p.id)).not.toBeNull();
  });

  it('lần mở ẩn không bị theo dõi', async () => {
    const p = store.createProfile({ name: 'a' });
    const c = withCounts([1, 0]);
    const l = new Launcher({ ...deps, windowWatchMs: 5, countPages: c.countPages });
    await l.launch(p.id, { headless: true });
    await tick();
    expect(c.ports).toHaveLength(0);
    expect(l.status(p.id)).not.toBeNull();
  });

  it('dừng tay thì ngừng hỏi', async () => {
    const p = store.createProfile({ name: 'a' });
    const c = withCounts([1]);
    const l = new Launcher({ ...deps, windowWatchMs: 5, countPages: c.countPages });
    await l.launch(p.id);
    await tick(20);
    await l.stop(p.id);
    const n = c.ports.length;
    await tick();
    expect(c.ports.length).toBe(n);
  });
});

describe('Launcher', () => {
  it('khởi chạy với đúng cờ và trả thông tin CDP', async () => {
    const p = store.createProfile({ name: 'a', lang: 'en-US', acceptLang: 'en-US,en', timezone: 'UTC', platform: 'macos' });
    const l = new Launcher(deps);
    const info = await l.launch(p.id);
    expect(info.cdpPort).toBe(9333);
    expect(info.cdpUrl).toBe('ws://127.0.0.1:9333/devtools/browser/abc');
    expect(info.pid).toBe(4242);
    const { exe, args } = sp.calls[0];
    expect(exe).toBe('/engine/chrome');
    expect(args).toContain(`--user-data-dir=${join(profilesDir, p.id)}`);
    expect(args).toContain(`--fingerprint=${p.seed}`);
    expect(args).toContain('--timezone=UTC');
    expect(args).toContain('--remote-debugging-port=0');
    expect(args.some((a) => a.startsWith('--proxy-server='))).toBe(false);
    expect(l.status(p.id)).toEqual(info);
    expect(store.getProfile(p.id)!.engineVersion).toBe('1.2.3');
  });

  it('không cho mở lần hai khi đang chạy', async () => {
    const p = store.createProfile({ name: 'a' });
    const l = new Launcher(deps);
    await l.launch(p.id);
    await expect(l.launch(p.id)).rejects.toThrow(LaunchError);
    expect(sp.calls.length).toBe(1);
  });

  it('chưa cài nhân thì báo lỗi', async () => {
    const p = store.createProfile({ name: 'a' });
    const l = new Launcher({ ...deps, engine: { executablePath: () => null, release: () => ({ version: '1.2.3' }) } });
    await expect(l.launch(p.id)).rejects.toThrow('Chưa cài nhân trình duyệt');
  });

  it('có proxy thì trỏ trình duyệt vào cầu cục bộ và giải mã mật khẩu', async () => {
    const x = store.createProxy({ protocol: 'socks5', host: '9.9.9.9', port: 1080, username: 'u', passwordEncrypted: 'enc:secret' });
    const p = store.createProfile({ name: 'a', proxyId: x.id });
    let seen: unknown;
    const l = new Launcher({ ...deps, openBridge: async (u) => { seen = u; return { url: 'http://127.0.0.1:5555', close: async () => { bridgeClosed++; } }; } });
    await l.launch(p.id);
    expect(seen).toEqual({ protocol: 'socks5', host: '9.9.9.9', port: 1080, username: 'u', password: 'secret' });
    expect(sp.calls[0].args).toContain('--proxy-server=http://127.0.0.1:5555');
  });

  it('proxy không kết nối được thì không chạy nhân', async () => {
    const x = store.createProxy({ protocol: 'http', host: '9.9.9.9', port: 8080, username: null, passwordEncrypted: null });
    const p = store.createProfile({ name: 'a', proxyId: x.id });
    const l = new Launcher({ ...deps, checkReachable: async () => { throw new Error('refused'); } });
    await expect(l.launch(p.id)).rejects.toThrow('Proxy 9.9.9.9:8080 không kết nối được');
    expect(sp.calls.length).toBe(0);
    expect(l.status(p.id)).toBeNull();
    expect(existsSync(join(profilesDir, p.id))).toBe(false);
  });

  it('nhân thoát thì trạng thái về dừng, đóng cầu proxy, phát sự kiện', async () => {
    const x = store.createProxy({ protocol: 'http', host: '9.9.9.9', port: 8080, username: null, passwordEncrypted: null });
    const p = store.createProfile({ name: 'a', proxyId: x.id });
    const l = new Launcher(deps);
    const changes: string[] = [];
    l.on('change', (id) => changes.push(id));
    await l.launch(p.id);
    expect(existsSync(join(profilesDir, p.id, '.bf-run.json'))).toBe(true);
    await l.stop(p.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(sp.calls[0].child.killed).toBe(true);
    expect(l.status(p.id)).toBeNull();
    expect(l.lastExitCode(p.id)).toBe(0);
    expect(bridgeClosed).toBe(1);
    expect(existsSync(join(profilesDir, p.id, '.bf-run.json'))).toBe(false);
    expect(changes).toEqual([p.id, p.id]);
  });

  it('nhân thoát trước khi có CDP thì báo lỗi và đóng cầu proxy', async () => {
    const dead = fakeSpawn(false);
    const x = store.createProxy({ protocol: 'http', host: '9.9.9.9', port: 8080, username: null, passwordEncrypted: null });
    const p = store.createProfile({ name: 'a', proxyId: x.id });
    const l = new Launcher({ ...deps, spawnImpl: dead.impl });
    await expect(l.launch(p.id)).rejects.toThrow(LaunchError);
    expect(bridgeClosed).toBe(1);
    expect(l.status(p.id)).toBeNull();
  });

  it('cleanupStale diệt tiến trình còn sót và xoá khoá', async () => {
    const dir = join(profilesDir, 'old');
    mkdirSync(dir);
    writeFileSync(join(dir, '.bf-run.json'), JSON.stringify({ pid: 777 }));
    writeFileSync(join(dir, 'SingletonLock'), '');
    const killed: number[] = [];
    const l = new Launcher({ ...deps, pidCommand: async () => `/engine/chrome --user-data-dir=${dir}`, killPid: (pid) => killed.push(pid) });
    await l.cleanupStale();
    expect(killed).toEqual([777]);
    expect(existsSync(join(dir, '.bf-run.json'))).toBe(false);
    expect(existsSync(join(dir, 'SingletonLock'))).toBe(false);
  });

  it('cleanupStale không diệt pid đã bị tiến trình khác dùng lại', async () => {
    const dir = join(profilesDir, 'old');
    mkdirSync(dir);
    writeFileSync(join(dir, '.bf-run.json'), JSON.stringify({ pid: 777 }));
    const killed: number[] = [];
    const l = new Launcher({ ...deps, pidCommand: async () => '/usr/bin/some-other-app', killPid: (pid) => killed.push(pid) });
    await l.cleanupStale();
    expect(killed).toEqual([]);
    expect(existsSync(join(dir, '.bf-run.json'))).toBe(false);
  });

  it('spawn lỗi (ENOENT) thì báo lỗi nhanh, đóng cầu proxy, không uncaught', async () => {
    const x = store.createProxy({ protocol: 'http', host: '9.9.9.9', port: 8080, username: null, passwordEncrypted: null });
    const p = store.createProfile({ name: 'a', proxyId: x.id });
    const bad = fakeSpawn(false);
    const impl = ((exe: string, args: string[]) => {
      const child = new FakeChild();
      bad.calls.push({ exe, args, child });
      queueMicrotask(() => child.emit('error', new Error('spawn ENOENT')));
      return child;
    }) as unknown as typeof spawn;
    const l = new Launcher({ ...deps, spawnImpl: impl, cdpTimeoutMs: 5000 });
    const t0 = Date.now();
    await expect(l.launch(p.id)).rejects.toThrow(LaunchError);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(bad.calls[0].child.killed).toBe(true);
    expect(bridgeClosed).toBe(1);
    expect(l.status(p.id)).toBeNull();
    expect(existsSync(join(profilesDir, p.id, '.bf-run.json'))).toBe(false);
  });

  it('lỗi sau khi nhân đã mở thì diệt nhân, đóng cầu, cho phép chạy lại', async () => {
    const x = store.createProxy({ protocol: 'http', host: '9.9.9.9', port: 8080, username: null, passwordEncrypted: null });
    const p = store.createProfile({ name: 'a', proxyId: x.id });
    const l = new Launcher(deps);
    const real = store.markLaunched.bind(store);
    store.markLaunched = () => { throw new Error('db hỏng'); };
    await expect(l.launch(p.id)).rejects.toThrow('db hỏng');
    expect(sp.calls[0].child.killed).toBe(true);
    expect(bridgeClosed).toBe(1);
    expect(l.status(p.id)).toBeNull();
    expect(existsSync(join(profilesDir, p.id, '.bf-run.json'))).toBe(false);
    store.markLaunched = real;
    const info = await l.launch(p.id);
    expect(l.status(p.id)).toEqual(info);
    expect(sp.calls.length).toBe(2);
  });

  it('cleanupStale không diệt khi dòng lệnh thuộc thư mục có cùng tiền tố', async () => {
    const dir = join(profilesDir, 'old');
    const sibling = join(profilesDir, 'old2');
    mkdirSync(dir);
    writeFileSync(join(dir, '.bf-run.json'), JSON.stringify({ pid: 777 }));
    const killed: number[] = [];
    const mk = (cmd: string) => new Launcher({ ...deps, pidCommand: async () => cmd, killPid: (pid) => killed.push(pid) });
    await mk(`/engine/chrome --user-data-dir=${sibling} --x`).cleanupStale();
    expect(killed).toEqual([]);
    writeFileSync(join(dir, '.bf-run.json'), JSON.stringify({ pid: 777 }));
    await mk(`/engine/chrome --user-data-dir=${dir} --x`).cleanupStale();
    expect(killed).toEqual([777]);
  });

  it('hồ sơ có proxy không bao giờ được chạy thiếu --proxy-server', async () => {
    const x = store.createProxy({ protocol: 'http', host: '9.9.9.9', port: 8080, username: null, passwordEncrypted: null });
    const p = store.createProfile({ name: 'a', proxyId: x.id });
    await new Launcher(deps).launch(p.id);
    expect(sp.calls.every((c) => c.args.some((a) => a.startsWith('--proxy-server=')))).toBe(true);
    expect(sp.calls.length).toBe(1);
  });

  it('dọn dẹp khi thoát lỗi thì vẫn phát sự kiện và không làm stop() lỗi', async () => {
    const x = store.createProxy({ protocol: 'http', host: '9.9.9.9', port: 8080, username: null, passwordEncrypted: null });
    const p = store.createProfile({ name: 'a', proxyId: x.id });
    const l = new Launcher({ ...deps, openBridge: async () => ({ url: 'http://127.0.0.1:5555', close: async () => { throw new Error('boom'); } }) });
    const changes: string[] = [];
    l.on('change', (id) => changes.push(id));
    await l.launch(p.id);
    await l.stop(p.id);
    expect(l.status(p.id)).toBeNull();
    expect(changes.length).toBe(2);
  });

  it('isActive đúng khi đang khởi chạy, đang chạy và sau khi dừng', async () => {
    const p = store.createProfile({ name: 'a' });
    const l = new Launcher(deps);
    expect(l.isActive(p.id)).toBe(false);
    const pending = l.launch(p.id);
    expect(l.isActive(p.id)).toBe(true);
    await pending;
    expect(l.isActive(p.id)).toBe(true);
    await l.stop(p.id);
    expect(l.isActive(p.id)).toBe(false);
  });
  it('stopAll khi đang khởi chạy dở: chờ, dừng nhân đã sinh, từ chối lần mở sau', async () => {
    const p = store.createProfile({ name: 'a' });
    const q = store.createProfile({ name: 'b' });
    const delayed: { child: FakeChild }[] = [];
    const impl = ((_exe: string, args: string[]) => {
      const child = new FakeChild();
      delayed.push({ child });
      const dir = args.find((a) => a.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
      setTimeout(() => writeFileSync(join(dir, 'DevToolsActivePort'), '9333\n/devtools/browser/abc\n'), 150);
      return child;
    }) as unknown as typeof spawn;
    const l = new Launcher({ ...deps, spawnImpl: impl });
    const pending = l.launch(p.id);
    const settled = pending.then(() => 'ok', () => 'err');
    await new Promise((r) => setTimeout(r, 30));
    expect(l.status(p.id)).toBeNull();
    await l.stopAll();
    expect(delayed).toHaveLength(1);
    expect(delayed[0].child.killed).toBe(true);
    expect(l.status(p.id)).toBeNull();
    expect(l.isActive(p.id)).toBe(false);
    await settled;
    await expect(l.launch(q.id)).rejects.toThrow('Ứng dụng đang thoát');
    await expect(l.launch(q.id)).rejects.toThrow(LaunchError);
    expect(delayed).toHaveLength(1);
  });

  it('stop vẫn kết thúc khi lệnh đóng qua CDP treo vô hạn', async () => {
    const p = store.createProfile({ name: 'a' });
    const l = new Launcher({ ...deps, closeBrowser: () => new Promise<void>(() => {}), killAfterMs: 30 });
    await l.launch(p.id);
    await l.stop(p.id);
    expect(sp.calls[0].child.killed).toBe(true);
    expect(l.status(p.id)).toBeNull();
  });

  it('tuỳ chọn headless thêm cờ --headless=new và ghi vào RunInfo', async () => {
    const p = store.createProfile({ name: 'a' });
    const l = new Launcher(deps);
    const info = await l.launch(p.id, { headless: true });
    expect(sp.calls[0].args).toContain('--headless=new');
    expect(info.headless).toBe(true);
    await l.stop(p.id);
    const again = await l.launch(p.id);
    expect(sp.calls[1].args).not.toContain('--headless=new');
    expect(again.headless).toBe(false);
  });

  it('nạp extension bằng --load-extension; không có extension thì không thêm cờ', async () => {
    const a = store.createProfile({ name: 'a' });
    const b = store.createProfile({ name: 'b' });
    const l = new Launcher({ ...deps, extensionDirs: (id) => (id === a.id ? ['/data/extensions/e1', '/data/extensions/e2'] : []) });
    await l.launch(a.id);
    await l.launch(b.id);
    expect(sp.calls[0].args).toContain('--load-extension=/data/extensions/e1,/data/extensions/e2');
    expect(sp.calls[1].args.some((x) => x.startsWith('--load-extension'))).toBe(false);
  });

  it('đường dẫn extension có dấu phẩy: từ chối trước khi chạy nhân', async () => {
    const p = store.createProfile({ name: 'a' });
    const l = new Launcher({ ...deps, extensionDirs: () => ['/data/a,b/e1'] });
    await expect(l.launch(p.id)).rejects.toThrow(LaunchError);
    expect(sp.calls).toHaveLength(0);
    expect(l.isActive(p.id)).toBe(false);
  });

  it('lỗi khi lấy danh sách extension làm hỏng lần khởi chạy và không để sót trạng thái', async () => {
    const p = store.createProfile({ name: 'a' });
    const l = new Launcher({ ...deps, extensionDirs: () => { throw new LaunchError('Thiếu file của extension'); } });
    await expect(l.launch(p.id)).rejects.toThrow('Thiếu file của extension');
    expect(sp.calls).toHaveLength(0);
    expect(l.isActive(p.id)).toBe(false);
  });
});
