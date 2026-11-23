import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PORT, defaultDataDir, loadOrCreateToken, readToken, tokenPath } from '../src/token';

const posix = process.platform !== 'win32';
let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bf-token-'));
  file = tokenPath(dir);
});

describe('token', () => {
  it('cổng mặc định và đường dẫn file token', () => {
    expect(DEFAULT_PORT).toBe(47800);
    expect(file).toBe(join(dir, 'api-token'));
  });

  it('thư mục dữ liệu mặc định theo hệ điều hành', () => {
    expect(defaultDataDir('darwin', {}, '/Users/a')).toBe(join('/Users/a', 'Library', 'Application Support', 'Browser Fingerprint'));
    expect(defaultDataDir('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a')).toBe(join('C:\\Users\\a\\AppData\\Roaming', 'Browser Fingerprint'));
    expect(defaultDataDir('win32', {}, '/home/a')).toBe(join('/home/a', 'AppData', 'Roaming', 'Browser Fingerprint'));
    expect(defaultDataDir('linux', {}, '/home/a')).toBe(join('/home/a', '.config', 'Browser Fingerprint'));
    expect(defaultDataDir('linux', { XDG_CONFIG_HOME: '/cfg' }, '/home/a')).toBe(join('/cfg', 'Browser Fingerprint'));
  });

  it('sinh token 64 ký tự hex, ghi file quyền 0600, và giữ nguyên ở lần gọi sau', () => {
    const first = loadOrCreateToken(file);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(file, 'utf8').trim()).toBe(first);
    if (posix) expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadOrCreateToken(file)).toBe(first);
    expect(readToken(file)).toBe(first);
  });

  it('hai thư mục khác nhau cho hai token khác nhau', () => {
    expect(loadOrCreateToken(file)).not.toBe(loadOrCreateToken(tokenPath(mkdtempSync(join(tmpdir(), 'bf-token-')))));
  });

  it('file token hỏng thì thay bằng token mới; file quyền lỏng thì siết lại', () => {
    writeFileSync(file, 'không phải token');
    const fresh = loadOrCreateToken(file);
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    chmodSync(file, 0o644);
    expect(loadOrCreateToken(file)).toBe(fresh);
    if (posix) expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('file hỏng quyền lỏng được thay bằng token mới quyền 0600, không để lại file tạm', () => {
    writeFileSync(file, 'không phải token');
    chmodSync(file, 0o644);
    const fresh = loadOrCreateToken(file);
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(file, 'utf8').trim()).toBe(fresh);
    if (posix) expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['api-token']);
  });

  it('readToken báo lỗi rõ khi thiếu hoặc sai dạng, không tự tạo file', () => {
    expect(() => readToken(file)).toThrow('Không đọc được token của API');
    writeFileSync(file, 'abc');
    expect(() => readToken(file)).toThrow('Không đọc được token của API');
    expect(readFileSync(file, 'utf8')).toBe('abc');
  });

  it('thông báo lỗi của readToken nêu đường dẫn file nhưng không nêu nội dung file', () => {
    writeFileSync(file, 'NOI-DUNG-BI-MAT');
    const message = (() => {
      try {
        readToken(file);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(message).toContain(file);
    expect(message).not.toContain('NOI-DUNG-BI-MAT');
  });
});
