import { describe, expect, it } from 'vitest';
import { fingerprintArgs, hostDefaults, hostPlatform, randomSeed } from '../src/fingerprint';
import type { Profile } from '../src/types';

const base: Profile = {
  id: 'p1', name: 'A', groupId: null, notes: '', seed: 12345,
  platform: 'macos', platformVersion: null, brand: 'Chrome', hardwareConcurrency: null,
  lang: 'en-US', acceptLang: 'en-US,en', timezone: 'America/New_York',
  proxyId: null, engineVersion: null, createdAt: 1, lastLaunchedAt: null,
};

describe('fingerprint', () => {
  it('randomSeed trả số nguyên dương 32 bit', () => {
    for (let i = 0; i < 100; i++) {
      const s = randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(2 ** 31);
    }
  });

  it('hostPlatform ánh xạ đúng', () => {
    expect(hostPlatform('darwin')).toBe('macos');
    expect(hostPlatform('win32')).toBe('windows');
    expect(hostPlatform('linux')).toBe('linux');
  });

  it('hostDefaults có đủ trường và acceptLang bắt đầu bằng lang', () => {
    const d = hostDefaults();
    expect(d.platform).toBe(hostPlatform());
    expect(d.timezone.length).toBeGreaterThan(0);
    expect(d.acceptLang.startsWith(d.lang)).toBe(true);
  });

  it('fingerprintArgs sinh cờ bắt buộc, bỏ cờ tuỳ chọn khi rỗng', () => {
    expect(fingerprintArgs(base)).toEqual([
      '--fingerprint=12345',
      '--fingerprint-platform=macos',
      '--fingerprint-brand=Chrome',
      '--lang=en-US',
      '--accept-lang=en-US,en',
      '--timezone=America/New_York',
    ]);
  });

  it('fingerprintArgs thêm cờ tuỳ chọn khi có giá trị', () => {
    const args = fingerprintArgs({ ...base, platformVersion: '15.2.0', hardwareConcurrency: 8 });
    expect(args).toContain('--fingerprint-platform-version=15.2.0');
    expect(args).toContain('--fingerprint-hardware-concurrency=8');
  });
});
