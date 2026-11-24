import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../src/core';
import { makeCrx3, makeKey } from './helpers/crx';

let core: Core;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bf-extup-'));
  core = new Core({ dataDir: join(tmp, 'data'), secrets: { encrypt: (s) => s, decrypt: (s) => s } });
});

function zipOf(name: string, version: string, extra: Record<string, string> = {}): Buffer {
  const files: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify({ manifest_version: 3, name, version })) };
  for (const [k, v] of Object.entries(extra)) files[k] = strToU8(v);
  return Buffer.from(zipSync(files));
}

function file(name: string, data: Buffer): string {
  const path = join(tmp, name);
  writeFileSync(path, data);
  return path;
}

const extDir = (id: string): string => join(tmp, 'data', 'extensions', id);
const manifestOf = (id: string): Record<string, unknown> => JSON.parse(readFileSync(join(extDir(id), 'manifest.json'), 'utf8'));
const dirsFor = (profileId: string): Promise<string[]> =>
  (core as unknown as { extensionDirsFor(id: string): Promise<string[]> }).extensionDirsFor(profileId);

describe('Core: cập nhật extension tại chỗ', () => {
  it('thay file, đổi phiên bản, giữ nguyên mã, thư mục và việc gán cho hồ sơ, nhóm', async () => {
    const ext = await core.addExtension(file('a.zip', zipOf('Ví A', '1.0', { 'old.js': 'cũ' })));
    const g = core.createGroup('G');
    core.setGroupExtensions(g.id, [ext.id]);
    const p = core.createProfile({ name: 'p', extensionIds: [ext.id] });
    const r = await core.updateExtensionFiles(ext.id, file('b.zip', zipOf('Ví A', '2.0', { 'new.js': 'mới' })));
    expect(r.before.version).toBe('1.0');
    expect(r.after).toMatchObject({ id: ext.id, name: 'Ví A', version: '2.0' });
    expect(existsSync(join(extDir(ext.id), 'new.js'))).toBe(true);
    expect(existsSync(join(extDir(ext.id), 'old.js'))).toBe(false);
    expect(core.listExtensions()).toHaveLength(1);
    expect(core.getProfile(p.id).extensionIds).toEqual([ext.id]);
    expect(core.listGroupExtensions()[g.id]).toEqual([ext.id]);
    expect(await dirsFor(p.id)).toEqual([extDir(ext.id)]);
  });

  it('extension cài từ .crx: bản mới dạng zip vẫn giữ khoá cũ nên ID không đổi', async () => {
    const key = makeKey();
    const ext = await core.addExtension(file('a.crx', makeCrx3(zipOf('Ví', '1.0'), key)));
    const before = manifestOf(ext.id).key;
    expect(before).toBe(key.toString('base64'));
    await core.updateExtensionFiles(ext.id, file('b.zip', zipOf('Ví', '1.1')));
    expect(manifestOf(ext.id)).toMatchObject({ key: before, version: '1.1' });
  });

  it('cùng khoá thì nhận; .crx của extension khác (khoá khác) bị từ chối và file cũ còn nguyên', async () => {
    const key = makeKey();
    const ext = await core.addExtension(file('a.crx', makeCrx3(zipOf('Ví', '1.0'), key)));
    await core.updateExtensionFiles(ext.id, file('b.crx', makeCrx3(zipOf('Ví', '1.2'), key)));
    expect(manifestOf(ext.id).version).toBe('1.2');
    await expect(core.updateExtensionFiles(ext.id, file('c.crx', makeCrx3(zipOf('Khác', '9.0'), makeKey())))).rejects.toThrow('extension khác');
    expect(manifestOf(ext.id).version).toBe('1.2');
    expect(core.listExtensions()[0].version).toBe('1.2');
  });

  it('extension cài từ zip (ID theo thư mục): bản mới dạng .crx bị bỏ khoá để ID không đổi', async () => {
    const ext = await core.addExtension(file('a.zip', zipOf('Ví', '1.0')));
    await core.updateExtensionFiles(ext.id, file('b.crx', makeCrx3(zipOf('Ví', '2.0'), makeKey())));
    expect(manifestOf(ext.id).key).toBeUndefined();
    expect(manifestOf(ext.id).version).toBe('2.0');
  });

  it('file hỏng thì báo lỗi, extension cũ không đổi và không để lại thư mục tạm', async () => {
    const ext = await core.addExtension(file('a.zip', zipOf('Ví', '1.0')));
    await expect(core.updateExtensionFiles(ext.id, file('b.zip', Buffer.from('không phải zip')))).rejects.toThrow();
    expect(manifestOf(ext.id).version).toBe('1.0');
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(join(tmp, 'data', 'extensions'))).toEqual([ext.id]);
  });

  it('hồ sơ đang chạy dùng extension thì không cập nhật được', async () => {
    const ext = await core.addExtension(file('a.zip', zipOf('Ví', '1.0')));
    const p = core.createProfile({ name: 'Đang chạy', extensionIds: [ext.id] });
    vi.spyOn(core.launcher, 'isActive').mockImplementation((id) => id === p.id);
    await expect(core.updateExtensionFiles(ext.id, file('b.zip', zipOf('Ví', '2.0')))).rejects.toThrow('Đang chạy');
    expect(manifestOf(ext.id).version).toBe('1.0');
  });

  it('mã không tồn tại hoặc tham số sai', async () => {
    await expect(core.updateExtensionFiles('khong-co', file('b.zip', zipOf('Ví', '2.0')))).rejects.toThrow('Không tìm thấy extension');
    await expect(core.updateExtensionFiles('x', '')).rejects.toThrow('Tham số không hợp lệ');
  });
});
