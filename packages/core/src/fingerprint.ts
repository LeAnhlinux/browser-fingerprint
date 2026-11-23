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
