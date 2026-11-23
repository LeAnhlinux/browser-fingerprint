import { copyFile, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { parseCrx } from './crx';

export interface ExtensionMeta {
  name: string;
  version: string;
}

export interface ExtensionLimits {
  maxArchiveBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
}

export const DEFAULT_EXTENSION_LIMITS: ExtensionLimits = {
  maxArchiveBytes: 200 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
  maxFiles: 20_000,
};

const TOO_BIG = 'Extension quá lớn';
const UNSAFE = 'File nén chứa đường dẫn không an toàn';
// _metadata: nhân từ chối nạp extension đã giải nén có thư mục này. .git: không thuộc extension.
const SKIP_AT_ROOT = new Set(['_metadata', '.git', '__MACOSX']);
const CONTROL = /[\u0000-\u001f\u007f]/g;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Tách tên mục trong zip thành các đoạn an toàn; null nếu có thể thoát khỏi thư mục đích. */
function safeSegments(name: string): string[] | null {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || name.includes('\0')) return null;
  const parts = normalized.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.length === 0 || parts.some((s) => s === '..' || s.includes(':'))) return null;
  return parts;
}

async function extractZip(zip: Buffer, dest: string, limits: ExtensionLimits): Promise<void> {
  let count = 0;
  let total = 0;
  let tooBig = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false;
        count++;
        total += f.originalSize;
        if (count > limits.maxFiles || total > limits.maxTotalBytes) {
          tooBig = true;
          throw new Error(TOO_BIG);
        }
        return true;
      },
    });
  } catch {
    throw new Error(tooBig ? TOO_BIG : 'File không phải .crx hoặc .zip hợp lệ');
  }
  let entries = Object.entries(files).map(([name, data]) => {
    const segs = safeSegments(name);
    if (!segs) throw new Error(UNSAFE);
    return { segs, data };
  });
  entries = entries.filter((e) => e.segs[0] !== '__MACOSX');
  // File zip tải từ GitHub thường bọc mọi thứ trong một thư mục gốc.
  const atRoot = (list: typeof entries): boolean => list.some((e) => e.segs.length === 1 && e.segs[0] === 'manifest.json');
  if (!atRoot(entries) && new Set(entries.map((e) => e.segs[0])).size === 1) {
    const inner = entries.map((e) => ({ ...e, segs: e.segs.slice(1) })).filter((e) => e.segs.length > 0);
    if (atRoot(inner)) entries = inner;
  }
  const root = resolve(dest);
  for (const e of entries) {
    if (SKIP_AT_ROOT.has(e.segs[0])) continue;
    const target = resolve(root, ...e.segs);
    if (!target.startsWith(root + sep)) throw new Error(UNSAFE);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, e.data);
  }
}

async function copyDir(src: string, dest: string, limits: ExtensionLimits, state: { count: number; total: number }, top: boolean): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (top && SKIP_AT_ROOT.has(entry.name)) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to, limits, state, false);
    } else if (entry.isFile()) {
      // Chỉ file thường: symlink và file đặc biệt bị bỏ qua, không bao giờ đi theo symlink.
      state.count++;
      state.total += (await lstat(from)).size;
      if (state.count > limits.maxFiles || state.total > limits.maxTotalBytes) throw new Error(TOO_BIG);
      await copyFile(from, to);
    }
  }
}

function clean(text: string, max: number): string {
  return text.replace(CONTROL, '').trim().slice(0, max);
}

async function localizedName(dest: string, manifest: Record<string, unknown>): Promise<string> {
  const raw = manifest.name as string;
  const m = /^__MSG_(.+)__$/.exec(raw);
  const locale = manifest.default_locale;
  if (!m || typeof locale !== 'string' || !/^[A-Za-z0-9_]+$/.test(locale)) return raw;
  try {
    const messages: unknown = JSON.parse((await readFile(join(dest, '_locales', locale, 'messages.json'), 'utf8')).replace(/^\uFEFF/, ''));
    if (!isRecord(messages)) return raw;
    const key = Object.keys(messages).find((k) => k.toLowerCase() === m[1].toLowerCase());
    const entry = key ? messages[key] : null;
    return isRecord(entry) && typeof entry.message === 'string' && entry.message.trim() !== '' ? entry.message : raw;
  } catch {
    return raw;
  }
}

async function readMeta(dest: string, publicKey: Buffer | null): Promise<ExtensionMeta> {
  const manifestPath = join(dest, 'manifest.json');
  const raw = await readFile(manifestPath, 'utf8').catch(() => null);
  if (raw === null) throw new Error('Không tìm thấy manifest.json trong extension');
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('manifest.json không hợp lệ');
  }
  if (!isRecord(manifest)) throw new Error('manifest.json không hợp lệ');
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || !manifest.name.trim() || !manifest.version.trim()) {
    throw new Error('manifest.json thiếu tên hoặc phiên bản');
  }
  // Giữ ID gốc của extension (trùng ID trên Chrome Web Store) bằng khoá công khai lấy từ file .crx.
  if (publicKey && typeof manifest.key !== 'string') {
    manifest.key = publicKey.toString('base64');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }
  return {
    name: clean(await localizedName(dest, manifest), 200) || 'Extension',
    version: clean(manifest.version, 50),
  };
}

export async function installExtensionFiles(source: string, destDir: string, limits: ExtensionLimits = DEFAULT_EXTENSION_LIMITS): Promise<ExtensionMeta> {
  const info = await stat(source).catch(() => null);
  if (!info) throw new Error('Không tìm thấy file hoặc thư mục extension');
  let publicKey: Buffer | null = null;
  if (info.isDirectory()) {
    if ((resolve(destDir) + sep).startsWith(resolve(source) + sep)) throw new Error('Không thể thêm thư mục đang chứa dữ liệu của ứng dụng');
    await copyDir(source, destDir, limits, { count: 0, total: 0 }, true);
  } else if (info.isFile()) {
    if (info.size > limits.maxArchiveBytes) throw new Error(TOO_BIG);
    const parts = parseCrx(await readFile(source));
    publicKey = parts.publicKey;
    await mkdir(destDir, { recursive: true });
    await extractZip(parts.zip, destDir, limits);
  } else {
    throw new Error('Không tìm thấy file hoặc thư mục extension');
  }
  return readMeta(destDir, publicKey);
}
