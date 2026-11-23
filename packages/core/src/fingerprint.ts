import { randomInt } from 'node:crypto';
import type { Platform, Profile } from './types';

export function randomSeed(): number {
  return randomInt(1, 2 ** 31);
}

export function hostPlatform(p: NodeJS.Platform = process.platform): Platform {
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  return 'linux';
}

export function hostDefaults(): { platform: Platform; lang: string; acceptLang: string; timezone: string } {
  const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
  const short = locale.split('-')[0];
  return {
    platform: hostPlatform(),
    lang: locale,
    acceptLang: short === locale ? locale : `${locale},${short}`,
    timezone: timeZone,
  };
}

export function fingerprintArgs(p: Profile): string[] {
  const args = [
    `--fingerprint=${p.seed}`,
    `--fingerprint-platform=${p.platform}`,
    `--fingerprint-brand=${p.brand}`,
  ];
  if (p.platformVersion) args.push(`--fingerprint-platform-version=${p.platformVersion}`);
  if (p.hardwareConcurrency) args.push(`--fingerprint-hardware-concurrency=${p.hardwareConcurrency}`);
  args.push(`--lang=${p.lang}`, `--accept-lang=${p.acceptLang}`, `--timezone=${p.timezone}`);
  return args;
}

export interface ScreenSpec {
  width: number;
  height: number;
  scale: number;
}

export function profileScreen(p: Pick<Profile, 'screenWidth' | 'screenHeight' | 'screenScale'>): ScreenSpec | null {
  if (!p.screenWidth || !p.screenHeight) return null;
  return { width: p.screenWidth, height: p.screenHeight, scale: p.screenScale ?? 1 };
}

/**
 * Cờ đi kèm khi giả màn hình. Nhân không cho đặt màn hình cho iframe khác tên miền chạy ở tiến trình riêng,
 * nên tắt cách ly theo tên miền để iframe dùng chung màn hình giả với trang chứa nó.
 * Cửa sổ mở ra vừa trong màn hình giả, tránh cửa sổ to hơn cả màn hình.
 */
export function screenArgs(s: ScreenSpec | null): string[] {
  if (!s) return [];
  const w = Math.min(1280, s.width);
  const h = Math.min(800, s.height - 80);
  return ['--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process', `--window-size=${w},${h}`];
}

/** Khoá thay đổi khi bất kỳ tham số nào ảnh hưởng tới kết quả đo vân tay thay đổi. */
export function fingerprintKey(p: Profile, engineVersion: string): string {
  return [engineVersion, ...fingerprintArgs(p)].join('|');
}
