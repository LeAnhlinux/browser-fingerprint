import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function run(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await exec(cmd, args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name) return full;
    if (entry.isDirectory()) {
      const found = await findFile(full, name);
      if (found) return found;
    }
  }
  return null;
}

async function extractDmg(dmg: string, dest: string): Promise<string> {
  const mount = await mkdtemp(join(tmpdir(), 'bf-dmg-'));
  await run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mount]);
  try {
    const appName = (await readdir(mount)).find((n) => n.endsWith('.app'));
    if (!appName) throw new Error('Không tìm thấy .app trong file dmg');
    const appPath = join(dest, appName);
    await run('ditto', [join(mount, appName), appPath]);
    const exeName = (await run('plutil', ['-extract', 'CFBundleExecutable', 'raw', join(appPath, 'Contents', 'Info.plist')])).trim();
    return join(appPath, 'Contents', 'MacOS', exeName);
  } finally {
    await run('hdiutil', ['detach', mount, '-force']).catch(() => {});
    await rm(mount, { recursive: true, force: true });
  }
}

async function extractZip(zip: string, dest: string): Promise<string> {
  if (process.platform === 'win32') {
    // Git for Windows có thể đặt GNU tar lên trước trong PATH và nó không đọc được zip,
    // nên gọi bsdtar của hệ thống bằng đường dẫn tuyệt đối; lỗi thì dùng PowerShell.
    const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    try {
      await run(tar, ['-xf', zip, '-C', dest]);
    } catch {
      const q = (v: string): string => `'${v.replace(/'/g, "''")}'`;
      await run('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dest)} -Force`,
      ]);
    }
  } else {
    await run('tar', ['-xf', zip, '-C', dest]);
  }
  const exe = await findFile(dest, 'chrome.exe');
  if (!exe) throw new Error('Không tìm thấy chrome.exe trong file zip');
  return exe;
}

export async function extractArchive(archivePath: string, destDir: string, kind: 'dmg' | 'zip'): Promise<string> {
  return kind === 'dmg' ? extractDmg(archivePath, destDir) : extractZip(archivePath, destDir);
}
