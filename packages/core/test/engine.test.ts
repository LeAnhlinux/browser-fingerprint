import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EngineError, EngineManager, type EngineRelease, type ExtractFn } from '../src/engine';

const payload = Buffer.from('fake-archive-bytes');
const sha = createHash('sha256').update(payload).digest('hex');
const fetchOk = (async () => new Response(payload, { headers: { 'content-length': String(payload.length) } })) as unknown as typeof fetch;
const fakeExtract: ExtractFn = async (_archive, dest) => {
  mkdirSync(join(dest, 'bin'), { recursive: true });
  const exe = join(dest, 'bin', 'chrome');
  writeFileSync(exe, '');
  return exe;
};

let dir: string;
const manifest = (sha256: string): Partial<Record<NodeJS.Platform, EngineRelease>> => ({
  darwin: { version: '1.2.3', url: 'https://example.test/e.dmg', sha256, archive: 'dmg' },
});

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bf-engine-')); });

describe('EngineManager', () => {
  it('chưa cài thì executablePath trả null', () => {
    const m = new EngineManager({ enginesDir: dir, platform: 'darwin', manifest: manifest(sha) });
    expect(m.executablePath()).toBeNull();
    expect(m.release().version).toBe('1.2.3');
  });

  it('hệ điều hành không có trong manifest thì báo lỗi', () => {
    const m = new EngineManager({ enginesDir: dir, platform: 'linux', manifest: manifest(sha) });
    expect(() => m.release()).toThrow(EngineError);
  });

  it('cài thành công: báo tiến độ, trả file chạy, dọn file tải', async () => {
    const m = new EngineManager({ enginesDir: dir, platform: 'darwin', manifest: manifest(sha), fetchImpl: fetchOk, extract: fakeExtract });
    const progress: number[] = [];
    const exe = await m.install((received) => progress.push(received));
    expect(exe).toBe(join(dir, '1.2.3', 'bin', 'chrome'));
    expect(m.executablePath()).toBe(exe);
    expect(progress.at(-1)).toBe(payload.length);
    expect(readdirSync(dir)).toEqual(['1.2.3']);
  });

  it('sai SHA-256 thì từ chối và không để lại gì', async () => {
    const m = new EngineManager({ enginesDir: dir, platform: 'darwin', manifest: manifest('00'.repeat(32)), fetchImpl: fetchOk, extract: fakeExtract });
    await expect(m.install()).rejects.toThrow(EngineError);
    expect(m.executablePath()).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('tải lỗi HTTP thì báo lỗi', async () => {
    const fetch404 = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch;
    const m = new EngineManager({ enginesDir: dir, platform: 'darwin', manifest: manifest(sha), fetchImpl: fetch404, extract: fakeExtract });
    await expect(m.install()).rejects.toThrow(EngineError);
    expect(existsSync(join(dir, '1.2.3'))).toBe(false);
  });
});
