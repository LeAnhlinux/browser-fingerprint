import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
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

function extFolder(name: string, withManifest = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'bf-ext-src-'));
  if (withManifest) writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name, version: '1.0' }));
  writeFileSync(join(dir, 'bg.js'), 'x');
  return dir;
}

const loadFlag = (args: string[]): string[] => {
  const flag = args.find((a) => a.startsWith('--load-extension='));
  return flag ? flag.slice('--load-extension='.length).split(',') : [];
};

let dataDir: string;
let core: Core;

beforeEach(async () => {
  spawned = [];
  dataDir = mkdtempSync(join(tmpdir(), 'bf-core-ext-'));
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

describe('Core: extension', () => {
  it('listener change ném lỗi: dòng DB và thư mục extension vẫn còn nhất quán', async () => {
    core.on('change', () => {
      throw new Error('listener lỗi');
    });
    await core.addExtension(extFolder('Ví A')).catch(() => {});
    const rows = core.listExtensions();
    expect(rows).toHaveLength(1);
    expect(existsSync(join(dataDir, 'extensions', rows[0].id, 'manifest.json'))).toBe(true);
  });

  it('thêm extension: sao chép vào thư mục dữ liệu, ghi DB và phát change', async () => {
    const changes: string[] = [];
    core.on('change', (id: string) => changes.push(id));
    const ext = await core.addExtension(extFolder('Ví A'));
    expect(ext).toMatchObject({ name: 'Ví A', version: '1.0', path: join(dataDir, 'extensions', ext.id) });
    expect(existsSync(join(dataDir, 'extensions', ext.id, 'manifest.json'))).toBe(true);
    expect(core.listExtensions().map((e) => e.id)).toEqual([ext.id]);
    expect(changes).toHaveLength(1);
  });

  it('thêm thất bại thì không để lại thư mục hay dòng DB', async () => {
    await expect(core.addExtension(extFolder('x', false))).rejects.toThrow('Không tìm thấy manifest.json trong extension');
    await expect(core.addExtension('')).rejects.toThrow('Tham số không hợp lệ');
    expect(core.listExtensions()).toEqual([]);
    expect(readdirSync(join(dataDir, 'extensions'))).toEqual([]);
  });

  it('khởi chạy nạp hợp của extension riêng và extension của nhóm, không trùng', async () => {
    const a = await core.addExtension(extFolder('A'));
    const b = await core.addExtension(extFolder('B'));
    const g = core.createGroup('g');
    const p = core.createProfile({ name: 'p', groupId: g.id, extensionIds: [a.id] });
    const q = core.createProfile({ name: 'q' });
    core.setGroupExtensions(g.id, [a.id, b.id]);
    await core.launch(p.id);
    await core.launch(q.id);
    expect(loadFlag(spawned[0]).sort()).toEqual([join(dataDir, 'extensions', a.id), join(dataDir, 'extensions', b.id)].sort());
    expect(loadFlag(spawned[1])).toEqual([]);
  });

  it('tạo và sửa hồ sơ kèm extensionIds; listProfiles trả extensionIds riêng của hồ sơ', async () => {
    const a = await core.addExtension(extFolder('A'));
    const b = await core.addExtension(extFolder('B'));
    const p = core.createProfile({ name: 'p', extensionIds: [a.id, a.id] });
    expect(core.listProfiles()[0].extensionIds).toEqual([a.id]);
    core.updateProfile(p.id, { name: 'p2' });
    expect(core.listProfiles()[0].extensionIds).toEqual([a.id]);
    core.updateProfile(p.id, { extensionIds: [b.id] });
    expect(core.listProfiles()[0]).toMatchObject({ name: 'p2', extensionIds: [b.id] });
    core.setProfileExtensions(p.id, []);
    expect(core.listProfiles()[0].extensionIds).toEqual([]);
  });

  it('extension không tồn tại: từ chối và không tạo, không sửa gì', async () => {
    const a = await core.addExtension(extFolder('A'));
    expect(() => core.createProfile({ name: 'p', extensionIds: ['không-có'] })).toThrow('Không tìm thấy extension');
    expect(core.listProfiles()).toEqual([]);
    const p = core.createProfile({ name: 'p', extensionIds: [a.id] });
    expect(() => core.updateProfile(p.id, { name: 'đổi', extensionIds: ['không-có'] })).toThrow('Không tìm thấy extension');
    expect(core.listProfiles()[0]).toMatchObject({ name: 'p', extensionIds: [a.id] });
    expect(() => core.setProfileExtensions(p.id, 'e1' as unknown as string[])).toThrow('Danh sách extension không hợp lệ');
    expect(() => core.setProfileExtensions(p.id, Array.from({ length: 101 }, () => a.id))).toThrow('Tối đa 100 extension');
    expect(() => core.setProfileExtensions('không-có', [a.id])).toThrow('Không tìm thấy hồ sơ');
    expect(() => core.setGroupExtensions('không-có', [a.id])).toThrow('Không tìm thấy nhóm');
  });

  it('gán theo nhóm và liệt kê theo nhóm', async () => {
    const a = await core.addExtension(extFolder('A'));
    const g = core.createGroup('g');
    core.setGroupExtensions(g.id, [a.id]);
    expect(core.listGroupExtensions()).toEqual({ [g.id]: [a.id] });
    core.setGroupExtensions(g.id, []);
    expect(core.listGroupExtensions()).toEqual({});
  });

  it('không xoá extension khi hồ sơ đang chạy dùng nó; dừng rồi thì xoá cả file và dòng gán', async () => {
    const a = await core.addExtension(extFolder('A'));
    const p = core.createProfile({ name: 'ví-1', extensionIds: [a.id] });
    await core.launch(p.id);
    expect(() => core.deleteExtension(a.id)).toThrow('Extension đang được dùng bởi hồ sơ đang chạy: ví-1. Hãy dừng các hồ sơ đó trước.');
    await core.stop(p.id);
    core.deleteExtension(a.id);
    expect(core.listExtensions()).toEqual([]);
    expect(existsSync(join(dataDir, 'extensions', a.id))).toBe(false);
    expect(core.listProfiles()[0].extensionIds).toEqual([]);
    expect(() => core.deleteExtension(a.id)).toThrow('Không tìm thấy extension');
  });

  it('xoá hồ sơ hoặc nhóm thì dọn dòng gán', async () => {
    const a = await core.addExtension(extFolder('A'));
    const g = core.createGroup('g');
    const p = core.createProfile({ name: 'p', extensionIds: [a.id] });
    core.setGroupExtensions(g.id, [a.id]);
    core.deleteProfile(p.id);
    core.deleteGroup(g.id);
    expect(core.store.profileExtensionLinks()).toEqual({});
    expect(core.store.groupExtensionLinks()).toEqual({});
  });

  it('thiếu file của extension: khởi chạy báo lỗi rõ, không chạy nhân', async () => {
    const a = await core.addExtension(extFolder('Ví A'));
    const p = core.createProfile({ name: 'p', extensionIds: [a.id] });
    rmSync(join(dataDir, 'extensions', a.id), { recursive: true });
    await expect(core.launch(p.id)).rejects.toThrow('Thiếu file của extension "Ví A". Hãy xoá rồi thêm lại extension này.');
    expect(spawned).toHaveLength(0);
  });
});
