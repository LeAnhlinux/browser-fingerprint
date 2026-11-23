import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CdpError, type CdpSession } from '../src/cdp';
import { Core } from '../src/core';

class FakeChild extends EventEmitter {
  pid = 1;
  kill(): boolean {
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}

let spawned: string[][];
const spawnImpl = ((_exe: string, args: string[]) => {
  spawned.push(args);
  const dir = args.find((a) => a.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
  writeFileSync(join(dir, 'DevToolsActivePort'), '9333\n/devtools/browser/abc\n');
  return new FakeChild();
}) as unknown as typeof spawn;

type Stored = Record<string, unknown>;
let jar: Map<string, Stored>;
let cdpCalls: string[];
let cdpClosed: number;
let connectFails: boolean;
let transportFails: boolean;
let hold: Promise<void> | null;

const cdpConnect = async (): Promise<CdpSession> => {
  if (connectFails) throw new CdpError('Không kết nối được CDP');
  return {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      cdpCalls.push(method);
      if (hold) await hold;
      if (method === 'Storage.setCookies') {
        if (transportFails) throw new CdpError('Mất kết nối CDP');
        const list = params.cookies as Stored[];
        // Giống nhân thật: một cookie sai làm cả lô bị từ chối; 'ghost' được nhận nhưng không lưu.
        if (list.some((c) => c.name === 'bad')) throw new CdpError('Invalid cookie fields', true);
        for (const c of list) {
          if (c.name === 'ghost') continue;
          jar.set(`${c.name}|${c.domain}|${c.path}`, { ...c, expires: c.expires ?? -1, session: c.expires === undefined });
        }
        return {} as T;
      }
      if (method === 'Storage.getCookies') return { cookies: [...jar.values()] } as T;
      throw new Error(`lệnh không mong đợi: ${method}`);
    },
    close(): void {
      cdpClosed++;
    },
  };
};

const FUTURE = Math.floor(Date.now() / 1000) + 86_400;
const persistent = (name: string): Stored => ({ domain: '.a.com', name, value: 'v', expirationDate: FUTURE });
const sessionOnly = (name: string): Stored => ({ domain: '.a.com', name, value: 'v' });
const json = (items: unknown[]): string => JSON.stringify(items);

let core: Core;

beforeEach(async () => {
  spawned = [];
  jar = new Map();
  cdpCalls = [];
  cdpClosed = 0;
  connectFails = false;
  transportFails = false;
  hold = null;
  core = new Core({
    dataDir: mkdtempSync(join(tmpdir(), 'bf-cookie-')),
    secrets: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
    cdpConnect,
    launcherOverrides: {
      engine: { executablePath: () => '/engine/chrome', release: () => ({ version: '1.2.3' }) },
      spawnImpl,
      closeBrowser: async () => { throw new Error('no cdp'); },
    },
  });
  await core.init();
});

describe('Core: cookie', () => {
  it('hồ sơ đang chạy: ghi cả cookie phiên và không dừng hồ sơ', async () => {
    const p = core.createProfile({ name: 'a' });
    await core.launch(p.id);
    const r = await core.importCookies(p.id, json([persistent('a'), sessionOnly('s')]));
    expect(r).toEqual({ format: 'json', imported: 2, failed: 0, sessionSkipped: 0, errors: [] });
    expect(core.launcher.status(p.id)).not.toBeNull();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).not.toContain('--headless=new');
    expect(cdpClosed).toBe(1);
  });

  it('hồ sơ chưa chạy: mở ẩn, bỏ qua cookie phiên, rồi dừng', async () => {
    const p = core.createProfile({ name: 'a' });
    const r = await core.importCookies(p.id, json([persistent('a'), sessionOnly('s')]));
    expect(r).toEqual({ format: 'json', imported: 1, failed: 0, sessionSkipped: 1, errors: [] });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toContain('--headless=new');
    expect(core.launcher.status(p.id)).toBeNull();
    expect([...jar.values()].map((c) => c.name)).toEqual(['a']);
    expect(cdpClosed).toBe(1);
  });

  it('chưa chạy và chỉ có cookie phiên: không mở nhân', async () => {
    const p = core.createProfile({ name: 'a' });
    const r = await core.importCookies(p.id, json([sessionOnly('s1'), sessionOnly('s2')]));
    expect(r).toEqual({ format: 'json', imported: 0, failed: 0, sessionSkipped: 2, errors: [] });
    expect(spawned).toHaveLength(0);
  });

  it('một cookie sai làm cả lô bị từ chối: ghi lại từng cookie và đếm số thất bại', async () => {
    const p = core.createProfile({ name: 'a' });
    const r = await core.importCookies(p.id, json([persistent('a'), persistent('bad'), persistent('ghost'), persistent('b')]));
    expect(r.imported).toBe(2);
    expect(r.failed).toBe(2);
    expect([...jar.values()].map((c) => c.name).sort()).toEqual(['a', 'b']);
  });

  it('lỗi phân tích theo mục được trả về cùng kết quả', async () => {
    const p = core.createProfile({ name: 'a' });
    const r = await core.importCookies(p.id, json([persistent('a'), { domain: 'bad domain', name: 'x', value: '1' }]));
    expect(r.imported).toBe(1);
    expect(r.errors).toEqual([{ index: 2, reason: 'Tên miền không hợp lệ' }]);
  });

  it('không kết nối được CDP: báo lỗi và hồ sơ mở tạm vẫn được dừng', async () => {
    const p = core.createProfile({ name: 'a' });
    connectFails = true;
    await expect(core.importCookies(p.id, json([persistent('a')]))).rejects.toThrow('Không kết nối được CDP');
    expect(core.launcher.status(p.id)).toBeNull();
    connectFails = false;
    await expect(core.importCookies(p.id, json([persistent('a')]))).resolves.toMatchObject({ imported: 1 });
  });

  it('mất kết nối giữa chừng không bị coi là cookie sai', async () => {
    const p = core.createProfile({ name: 'a' });
    transportFails = true;
    await expect(core.importCookies(p.id, json([persistent('a'), persistent('b')]))).rejects.toThrow('Mất kết nối CDP');
    expect(cdpCalls).toEqual(['Storage.setCookies']);
    expect(core.launcher.status(p.id)).toBeNull();
  });

  it('một hồ sơ chỉ một thao tác cookie một lúc; hồ sơ đang mở tạm không xoá được', async () => {
    const p = core.createProfile({ name: 'a' });
    let release = (): void => {};
    hold = new Promise<void>((r) => { release = r; });
    const first = core.importCookies(p.id, json([persistent('a')]));
    await expect(core.exportCookies(p.id)).rejects.toThrow('Hồ sơ đang có thao tác cookie khác, hãy chờ xong');
    expect(() => core.deleteProfile(p.id)).toThrow('Hãy dừng hồ sơ trước khi xoá');
    release();
    await expect(first).resolves.toMatchObject({ imported: 1 });
    await expect(core.exportCookies(p.id)).resolves.toMatchObject({ count: 1 });
  });

  it('hồ sơ mở tạm bị người dùng mở lại có giao diện giữa chừng: không dừng lần chạy mới', async () => {
    const p = core.createProfile({ name: 'a' });
    let release = (): void => {};
    hold = new Promise<void>((r) => { release = r; });
    const first = core.importCookies(p.id, json([persistent('a')]));
    await vi.waitFor(() => expect(cdpCalls).toContain('Storage.setCookies'));
    await core.launcher.stop(p.id);
    await core.launch(p.id);
    release();
    await first;
    expect(spawned).toHaveLength(2);
    expect(spawned[1]).not.toContain('--headless=new');
    expect(core.launcher.status(p.id)).not.toBeNull();
  });

  it('từ chối nội dung quá dài, tham số sai kiểu và hồ sơ không tồn tại', async () => {
    const p = core.createProfile({ name: 'a' });
    await expect(core.importCookies(p.id, 'x'.repeat(5_000_001))).rejects.toThrow('Nội dung cookie quá dài (tối đa 5 MB)');
    await expect(core.importCookies(p.id, 123 as unknown as string)).rejects.toThrow('Tham số không hợp lệ');
    await expect(core.importCookies('không-có', json([persistent('a')]))).rejects.toThrow('Không tìm thấy hồ sơ');
    await expect(core.exportCookies('không-có')).rejects.toThrow('Không tìm thấy hồ sơ');
    expect(spawned).toHaveLength(0);
  });

  it('xuất cookie thành JSON nhập lại được; hồ sơ chưa chạy được mở ẩn rồi dừng', async () => {
    const p = core.createProfile({ name: 'a' });
    jar.set('k', { name: 'a', value: 'v', domain: '.a.com', path: '/', expires: FUTURE, httpOnly: false, secure: false, session: false });
    const r = await core.exportCookies(p.id);
    expect(r.count).toBe(1);
    expect(JSON.parse(r.json)).toEqual([
      { domain: '.a.com', name: 'a', value: 'v', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified', hostOnly: false, session: false, expirationDate: FUTURE },
    ]);
    expect(spawned[0]).toContain('--headless=new');
    expect(core.launcher.status(p.id)).toBeNull();
  });
});
