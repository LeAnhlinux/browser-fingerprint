import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { Core } from '../src/core';

let core: Core;
let version: string;
let download: () => Buffer;
let replies: unknown[];
let sent: Record<string, unknown>[];

function extensionZip(name: string, v: string): Buffer {
  return Buffer.from(
    zipSync({
      'manifest.json': strToU8(JSON.stringify({ manifest_version: 3, name, version: v })),
      'defaultSettings.json': strToU8(JSON.stringify({ isEnabled: true, clientKey: '' })),
    }),
  );
}

beforeEach(() => {
  version = '1.15.5';
  download = () => extensionZip('CapMonster Cloud — automated captcha solver', version);
  replies = [];
  sent = [];
  core = new Core({
    dataDir: mkdtempSync(join(tmpdir(), 'bf-cmcore-')),
    // Mã hoá giả nhận ra được, để kiểm tra DB không chứa key thô.
    secrets: { encrypt: (s) => `enc:${Buffer.from(s).toString('base64')}`, decrypt: (s) => Buffer.from(s.slice(4), 'base64').toString() },
    capmonster: {
      pollMs: 1,
      sleep: async () => {},
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(replies.shift()), { status: 200 });
      }) as unknown as typeof fetch,
    },
    capmonsterDownload: async (dest) => writeFileSync(dest, download()),
  });
});

const settingsOf = (extId: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join((core as unknown as { extensionsDir: string }).extensionsDir, extId, 'defaultSettings.json'), 'utf8'));
const dirsFor = (profileId: string): Promise<string[]> =>
  (core as unknown as { extensionDirsFor(id: string): Promise<string[]> }).extensionDirsFor(profileId);

describe('Core: CapMonster', () => {
  it('lưu key đã mã hoá; trạng thái chỉ báo có key', async () => {
    expect(await core.capmonsterStatus()).toEqual({ hasKey: false, keyUnreadable: false, extension: null });
    await core.setCapMonsterKey('  abcdef0123456789  ');
    expect(core.store.getSetting('capmonster.key')).not.toContain('abcdef0123456789');
    expect(await core.capmonsterStatus()).toEqual({ hasKey: true, keyUnreadable: false, extension: null });
    expect(JSON.stringify(await core.capmonsterStatus())).not.toContain('abcdef');
    await core.setCapMonsterKey(null);
    expect((await core.capmonsterStatus()).hasKey).toBe(false);
    await expect(core.setCapMonsterKey('có dấu cách')).rejects.toThrow('không hợp lệ');
  });

  it('số dư và giải captcha dùng key đã lưu', async () => {
    await expect(core.capmonsterBalance()).rejects.toThrow('Chưa nhập API key');
    await core.setCapMonsterKey('abcdef0123456789');
    replies.push({ errorId: 0, balance: 3 });
    expect(await core.capmonsterBalance()).toBe(3);
    replies.push({ errorId: 0, taskId: 5 }, { errorId: 0, status: 'ready', solution: { gRecaptchaResponse: 'R' }, cost: 0.0006 });
    expect(await core.solveCaptcha({ type: 'RecaptchaV2Task' })).toEqual({ taskId: 5, solution: { gRecaptchaResponse: 'R' }, cost: 0.0006 });
    expect(sent.every((b) => b.clientKey === 'abcdef0123456789')).toBe(true);
    await expect(core.solveCaptcha({ type: 'X' }, 1000)).rejects.toThrow('10 đến 280 giây');
  });

  it('cài extension, rồi cập nhật tại chỗ giữ nguyên mã và việc gán cho hồ sơ', async () => {
    const ext = await core.installCapMonsterExtension();
    expect(ext).toMatchObject({ name: 'CapMonster Cloud — automated captcha solver', version: '1.15.5' });
    const p = core.createProfile({ name: 'a', extensionIds: [ext.id] });
    version = '1.16.0';
    const updated = await core.installCapMonsterExtension();
    expect(updated.id).toBe(ext.id);
    expect(updated.version).toBe('1.16.0');
    expect(core.listExtensions()).toHaveLength(1);
    expect(core.getProfile(p.id).extensionIds).toEqual([ext.id]);
    expect((await core.capmonsterStatus()).extension?.id).toBe(ext.id);
  });

  it('không cài file không phải extension CapMonster', async () => {
    download = () => extensionZip('Extension khác', '1.0');
    await expect(core.installCapMonsterExtension()).rejects.toThrow('không phải extension CapMonster');
    expect(core.listExtensions()).toHaveLength(0);
  });

  it('mở hồ sơ thì ghi key hiện tại vào extension; xoá key thì ghi chuỗi rỗng', async () => {
    const ext = await core.installCapMonsterExtension();
    const p = core.createProfile({ name: 'a', extensionIds: [ext.id] });
    await core.setCapMonsterKey('abcdef0123456789');
    expect(await dirsFor(p.id)).toHaveLength(1);
    expect(settingsOf(ext.id).clientKey).toBe('abcdef0123456789');
    await core.setCapMonsterKey(null);
    await dirsFor(p.id);
    expect(settingsOf(ext.id).clientKey).toBe('');
  });

  it('lưu hoặc xoá key thì ghi ngay vào extension, không để key cũ nằm lại trên đĩa', async () => {
    const ext = await core.installCapMonsterExtension();
    await core.setCapMonsterKey('abcdef0123456789');
    expect(settingsOf(ext.id).clientKey).toBe('abcdef0123456789');
    await core.setCapMonsterKey(null);
    expect(settingsOf(ext.id).clientKey).toBe('');
  });

  it('key không giải mã được: hồ sơ vẫn mở (không nạp key), trạng thái báo cần nhập lại', async () => {
    const ext = await core.installCapMonsterExtension();
    const p = core.createProfile({ name: 'a', extensionIds: [ext.id] });
    core.store.setSetting('capmonster.key', 'hỏng');
    (core as unknown as { secrets: { decrypt(s: string): string } }).secrets.decrypt = () => {
      throw new Error('keychain đổi');
    };
    expect(await core.capmonsterStatus()).toMatchObject({ hasKey: false, keyUnreadable: true });
    expect(await dirsFor(p.id)).toHaveLength(1);
    expect(settingsOf(ext.id).clientKey).toBe('');
    await expect(core.capmonsterBalance()).rejects.toThrow('nhập lại key');
  });

  it('đang cài hoặc cập nhật extension thì hồ sơ dùng nó chưa mở được', async () => {
    const ext = await core.installCapMonsterExtension();
    const p = core.createProfile({ name: 'a', extensionIds: [ext.id] });
    const pending = core.installCapMonsterExtension();
    await expect(dirsFor(p.id)).rejects.toThrow('Đang cài hoặc cập nhật extension CapMonster');
    await pending;
    expect(await dirsFor(p.id)).toHaveLength(1);
  });
});
