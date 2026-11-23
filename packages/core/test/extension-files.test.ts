import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EXTENSION_LIMITS, installExtensionFiles } from '../src/extension-files';
import { makeCrx3, makeKey } from './helpers/crx';

const manifest = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ manifest_version: 3, name: 'Ví thử', version: '1.2.3', ...extra });
const zipOf = (files: Record<string, string>): Buffer =>
  Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));

let tmp: string;
let dest: string;
const fileOf = (name: string, data: Buffer): string => {
  const p = join(tmp, name);
  writeFileSync(p, data);
  return p;
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bf-extfiles-'));
  dest = join(tmp, 'dest');
});

describe('installExtensionFiles: file nén', () => {
  it('giải nén zip và trả tên, phiên bản từ manifest', async () => {
    const src = fileOf('a.zip', zipOf({ 'manifest.json': manifest(), 'js/bg.js': 'console.log(1)' }));
    expect(await installExtensionFiles(src, dest)).toEqual({ name: 'Ví thử', version: '1.2.3' });
    expect(readFileSync(join(dest, 'js', 'bg.js'), 'utf8')).toBe('console.log(1)');
  });

  it('zip bọc trong một thư mục gốc: lấy thư mục đó làm gốc, bỏ __MACOSX', async () => {
    const src = fileOf('a.zip', zipOf({ 'my-ext/manifest.json': manifest(), 'my-ext/bg.js': 'x', '__MACOSX/my-ext/._bg.js': 'rác' }));
    await installExtensionFiles(src, dest);
    expect(existsSync(join(dest, 'manifest.json'))).toBe(true);
    expect(existsSync(join(dest, 'bg.js'))).toBe(true);
    expect(existsSync(join(dest, '__MACOSX'))).toBe(false);
    expect(existsSync(join(dest, 'my-ext'))).toBe(false);
  });

  it.each(['../evil.txt', 'a/../../evil.txt', '/abs.txt', 'C:\\evil.txt', 'a/b:stream'])('từ chối đường dẫn không an toàn: %s', async (name) => {
    const src = fileOf('a.zip', zipOf({ 'manifest.json': manifest(), [name]: 'x' }));
    await expect(installExtensionFiles(src, dest)).rejects.toThrow('File nén chứa đường dẫn không an toàn');
    expect(existsSync(join(tmp, 'evil.txt'))).toBe(false);
  });

  it('crx: ghi khoá công khai vào manifest và bỏ thư mục _metadata', async () => {
    const key = makeKey();
    const zip = zipOf({ 'manifest.json': manifest(), '_metadata/verified_contents.json': '[]' });
    await installExtensionFiles(fileOf('a.crx', makeCrx3(zip, key)), dest);
    expect(JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8')).key).toBe(key.toString('base64'));
    expect(existsSync(join(dest, '_metadata'))).toBe(false);
  });

  it('crx: manifest đã có key thì giữ nguyên', async () => {
    const zip = zipOf({ 'manifest.json': manifest({ key: 'KHOA-CO-SAN' }) });
    await installExtensionFiles(fileOf('a.crx', makeCrx3(zip, makeKey())), dest);
    expect(JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8')).key).toBe('KHOA-CO-SAN');
  });

  it('tên dạng __MSG_ được tra trong _locales theo default_locale, không phân biệt hoa thường', async () => {
    const src = fileOf('a.zip', zipOf({
      'manifest.json': manifest({ name: '__MSG_appName__', default_locale: 'en' }),
      '_locales/en/messages.json': JSON.stringify({ appname: { message: 'Ví Thật' } }),
    }));
    expect((await installExtensionFiles(src, dest)).name).toBe('Ví Thật');
  });

  it('tên dạng __MSG_ không tra được thì giữ nguyên', async () => {
    const src = fileOf('a.zip', zipOf({ 'manifest.json': manifest({ name: '__MSG_appName__', default_locale: '../x' }) }));
    expect((await installExtensionFiles(src, dest)).name).toBe('__MSG_appName__');
  });

  it('vượt giới hạn số file thì từ chối', async () => {
    const src = fileOf('a.zip', zipOf({ 'manifest.json': manifest(), 'a.js': '1', 'b.js': '2' }));
    await expect(installExtensionFiles(src, dest, { ...DEFAULT_EXTENSION_LIMITS, maxFiles: 2 })).rejects.toThrow('Extension quá lớn');
  });

  it('vượt giới hạn dung lượng file nén hoặc dung lượng sau giải nén thì từ chối', async () => {
    const src = fileOf('a.zip', zipOf({ 'manifest.json': manifest(), 'big.js': 'x'.repeat(5000) }));
    await expect(installExtensionFiles(src, dest, { ...DEFAULT_EXTENSION_LIMITS, maxArchiveBytes: 10 })).rejects.toThrow('Extension quá lớn');
    await expect(installExtensionFiles(src, dest, { ...DEFAULT_EXTENSION_LIMITS, maxTotalBytes: 1000 })).rejects.toThrow('Extension quá lớn');
  });

  it('báo lỗi rõ khi file hỏng hoặc manifest thiếu, sai', async () => {
    await expect(installExtensionFiles(fileOf('x.zip', Buffer.from('không phải zip')), dest)).rejects.toThrow('File không phải .crx hoặc .zip hợp lệ');
    await expect(installExtensionFiles(fileOf('b.zip', zipOf({ 'bg.js': 'x' })), dest)).rejects.toThrow('Không tìm thấy manifest.json trong extension');
    await expect(installExtensionFiles(fileOf('c.zip', zipOf({ 'manifest.json': '{hỏng' })), join(tmp, 'd2'))).rejects.toThrow('manifest.json không hợp lệ');
    await expect(installExtensionFiles(fileOf('d.zip', zipOf({ 'manifest.json': '{"version":"1"}' })), join(tmp, 'd3'))).rejects.toThrow('manifest.json thiếu tên hoặc phiên bản');
    await expect(installExtensionFiles(join(tmp, 'không-có'), join(tmp, 'd4'))).rejects.toThrow('Không tìm thấy file hoặc thư mục extension');
  });
});

describe('installExtensionFiles: thư mục', () => {
  it('sao chép thư mục, bỏ symlink, _metadata và .git', async () => {
    const src = join(tmp, 'src');
    mkdirSync(join(src, 'js'), { recursive: true });
    mkdirSync(join(src, '_metadata'));
    mkdirSync(join(src, '.git'));
    writeFileSync(join(src, 'manifest.json'), manifest());
    writeFileSync(join(src, 'js', 'bg.js'), 'x');
    writeFileSync(join(src, '_metadata', 'a.json'), '[]');
    writeFileSync(join(src, '.git', 'HEAD'), 'ref');
    writeFileSync(join(tmp, 'secret.txt'), 'bí mật');
    symlinkSync(join(tmp, 'secret.txt'), join(src, 'link.txt'));
    expect(await installExtensionFiles(src, dest)).toEqual({ name: 'Ví thử', version: '1.2.3' });
    expect(existsSync(join(dest, 'js', 'bg.js'))).toBe(true);
    expect(existsSync(join(dest, 'link.txt'))).toBe(false);
    expect(existsSync(join(dest, '_metadata'))).toBe(false);
    expect(existsSync(join(dest, '.git'))).toBe(false);
  });

  it('không ghi khoá vào manifest khi nguồn là thư mục', async () => {
    const src = join(tmp, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'manifest.json'), manifest());
    await installExtensionFiles(src, dest);
    expect(JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8')).key).toBeUndefined();
  });

  it('từ chối khi thư mục nguồn chứa thư mục đích', async () => {
    writeFileSync(join(tmp, 'manifest.json'), manifest());
    await expect(installExtensionFiles(tmp, dest)).rejects.toThrow('Không thể thêm thư mục đang chứa dữ liệu của ứng dụng');
  });

  it('vượt giới hạn số file thì từ chối', async () => {
    const src = join(tmp, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'manifest.json'), manifest());
    writeFileSync(join(src, 'a.js'), '1');
    writeFileSync(join(src, 'b.js'), '2');
    await expect(installExtensionFiles(src, dest, { ...DEFAULT_EXTENSION_LIMITS, maxFiles: 2 })).rejects.toThrow('Extension quá lớn');
  });
});
