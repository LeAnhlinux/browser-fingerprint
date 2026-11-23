import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../src/core';
import type { ProbeResult } from '../src/fingerprint-probe';

const RESULT: ProbeResult = {
  userAgent: 'UA', platform: 'Win32', cores: 8, memory: 16, gpuVendor: 'Google Inc. (NVIDIA)',
  gpuRenderer: 'ANGLE (NVIDIA, RTX 3060)', languages: ['en-US'], timezone: 'UTC',
};

let core: Core;
let probes: string[][];
let probeImpl: (exe: string, args: string[]) => Promise<ProbeResult>;

beforeEach(() => {
  probes = [];
  probeImpl = async (_exe, args) => {
    probes.push(args);
    return RESULT;
  };
  core = new Core({
    dataDir: mkdtempSync(join(tmpdir(), 'bf-fp-')),
    secrets: { encrypt: (s) => s, decrypt: (s) => s },
    probe: (exe, args) => probeImpl(exe, args),
  });
  vi.spyOn(core.engine, 'executablePath').mockReturnValue('/engine/chrome');
  vi.spyOn(core.engine, 'release').mockReturnValue({ version: '1.2.3' } as ReturnType<Core['engine']['release']>);
});

describe('Core: màn hình giả', () => {
  it('lưu và đọc lại độ phân giải, tỉ lệ điểm ảnh', () => {
    const p = core.createProfile({ name: 'a', screenWidth: 1920, screenHeight: 1080, screenScale: 1.25 });
    expect(core.getProfile(p.id)).toMatchObject({ screenWidth: 1920, screenHeight: 1080, screenScale: 1.25 });
    core.updateProfile(p.id, { screenWidth: null, screenHeight: null, screenScale: null });
    expect(core.getProfile(p.id)).toMatchObject({ screenWidth: null, screenHeight: null, screenScale: null });
  });

  it('phải nhập đủ cả hai chiều, trong giới hạn hợp lý', () => {
    expect(() => core.createProfile({ name: 'a', screenWidth: 1920 })).toThrow('cả chiều rộng và chiều cao');
    expect(() => core.createProfile({ name: 'a', screenWidth: 1920, screenHeight: null })).toThrow('cả chiều rộng và chiều cao');
    expect(() => core.createProfile({ name: 'a', screenWidth: 100, screenHeight: 1080 })).toThrow('320–7680');
    expect(() => core.createProfile({ name: 'a', screenWidth: 1920.5, screenHeight: 1080 })).toThrow('320–7680');
    expect(() => core.createProfile({ name: 'a', screenWidth: '1920' as unknown as number, screenHeight: 1080 })).toThrow('320–7680');
    expect(() => core.createProfile({ name: 'a', screenScale: 5 })).toThrow('0.5 đến 4');
    expect(() => core.createProfile({ name: 'a', screenScale: 1.333 })).toThrow('0.5 đến 4');
  });
});

describe('Core: đo và đổi vân tay', () => {
  it('đo rồi lưu; hồ sơ mang kết quả cho tới khi tham số vân tay đổi', async () => {
    const p = core.createProfile({ name: 'a', platform: 'windows' });
    expect(core.getProfile(p.id).fingerprint).toBeNull();
    const snap = await core.measureFingerprint(p.id);
    expect(snap).toMatchObject({ ...RESULT, engineVersion: '1.2.3' });
    expect(probes[0]).toContain(`--fingerprint=${p.seed}`);
    expect(probes[0]).toContain('--fingerprint-platform=windows');
    expect(core.listProfiles()[0].fingerprint?.gpuRenderer).toBe('ANGLE (NVIDIA, RTX 3060)');
    // Sửa thứ không thuộc vân tay thì kết quả vẫn đúng.
    core.updateProfile(p.id, { notes: 'ghi chú' });
    expect(core.getProfile(p.id).fingerprint).not.toBeNull();
    // Đổi số nhân CPU thì kết quả cũ không còn đúng.
    core.updateProfile(p.id, { hardwareConcurrency: 4 });
    expect(core.getProfile(p.id).fingerprint).toBeNull();
  });

  it('đổi vân tay thì có seed mới và bỏ kết quả đo cũ', async () => {
    const p = core.createProfile({ name: 'a' });
    await core.measureFingerprint(p.id);
    const changes: string[] = [];
    core.on('change', (id) => changes.push(id));
    const next = core.regenerateFingerprint(p.id);
    expect(next.seed).not.toBe(p.seed);
    expect(core.getProfile(p.id).fingerprint).toBeNull();
    expect(changes).toEqual([p.id]);
  });

  it('bấm đo hai lần liền chỉ mở nhân một lần', async () => {
    const p = core.createProfile({ name: 'a' });
    await Promise.all([core.measureFingerprint(p.id), core.measureFingerprint(p.id)]);
    expect(probes).toHaveLength(1);
  });

  it('hồ sơ bị sửa trong lúc đo thì không lưu kết quả đã cũ', async () => {
    const p = core.createProfile({ name: 'a' });
    let release!: () => void;
    probeImpl = (_exe, args) => {
      probes.push(args);
      return new Promise((r) => {
        release = () => r(RESULT);
      });
    };
    const pending = core.measureFingerprint(p.id);
    await Promise.resolve();
    core.regenerateFingerprint(p.id);
    release();
    await pending;
    expect(core.getProfile(p.id).fingerprint).toBeNull();
  });

  it('chưa cài nhân thì báo lỗi', async () => {
    vi.spyOn(core.engine, 'executablePath').mockReturnValue(null);
    const p = core.createProfile({ name: 'a' });
    await expect(core.measureFingerprint(p.id)).rejects.toThrow('Chưa cài nhân');
  });
});
