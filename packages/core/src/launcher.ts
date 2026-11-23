import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fingerprintArgs } from './fingerprint';
import { ProxyBridge, type Upstream, assertReachable } from './proxy-bridge';
import type { ProfileStore } from './store';
import type { SecretBox } from './types';

const exec = promisify(execFile);
const CDP_FILE = 'DevToolsActivePort';
const RUN_FILE = '.bf-run.json';
const LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];

export interface RunInfo {
  profileId: string;
  pid: number;
  cdpPort: number;
  cdpUrl: string;
  startedAt: number;
}

export class LaunchError extends Error {}

export interface BridgeLike {
  url: string;
  close(): Promise<void>;
}

export interface LauncherDeps {
  store: ProfileStore;
  engine: { executablePath(): string | null; release(): { version: string } };
  profilesDir: string;
  secrets: SecretBox;
  spawnImpl?: typeof spawn;
  openBridge?: (u: Upstream) => Promise<BridgeLike>;
  checkReachable?: (host: string, port: number) => Promise<void>;
  closeBrowser?: (cdpUrl: string) => Promise<void>;
  pidCommand?: (pid: number) => Promise<string | null>;
  killPid?: (pid: number) => void;
  cdpTimeoutMs?: number;
  killAfterMs?: number;
}

interface Entry {
  child: ChildProcess;
  info: RunInfo;
  /** Hoàn tất khi nhân đã thoát và trạng thái đã được dọn xong. */
  cleanedUp: Promise<void>;
}

export function cdpBrowserClose(cdpUrl: string, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(cdpUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Hết thời gian kết nối CDP'));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      resolve();
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Không kết nối được CDP'));
    });
  });
}

export async function pidCommand(pid: number): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await exec('powershell', [
        '-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ]);
      return stdout.trim() || null;
    }
    const { stdout } = await exec('ps', ['-p', String(pid), '-o', 'command=']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function commandUsesDir(cmd: string, dir: string): boolean {
  const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`--user-data-dir=\"?${escaped}\"?(?:\\s|$)`).test(cmd);
}

async function waitForCdpFile(dir: string, timeoutMs: number, signal: AbortSignal): Promise<{ port: number; path: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !signal.aborted) {
    const raw = await readFile(join(dir, CDP_FILE), 'utf8').catch(() => null);
    if (raw) {
      const [port, path] = raw.split('\n');
      if (Number(port) > 0 && path) return { port: Number(port), path: path.trim() };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new LaunchError('Nhân không mở cổng CDP kịp thời gian');
}

export class Launcher extends EventEmitter {
  private runs = new Map<string, Entry>();
  private starting = new Set<string>();
  private inflight = new Set<Promise<unknown>>();
  private closing = false;
  private exitCodes = new Map<string, number | null>();

  constructor(private deps: LauncherDeps) {
    super();
  }

  lastExitCode(profileId: string): number | null {
    return this.exitCodes.get(profileId) ?? null;
  }

  status(profileId: string): RunInfo | null {
    return this.runs.get(profileId)?.info ?? null;
  }

  /** Đang chạy hoặc đang trong quá trình khởi chạy. */
  isActive(profileId: string): boolean {
    return this.runs.has(profileId) || this.starting.has(profileId);
  }

  launch(profileId: string): Promise<RunInfo> {
    if (this.closing) return Promise.reject(new LaunchError('Ứng dụng đang thoát'));
    const p = this.doLaunch(profileId);
    this.inflight.add(p);
    const done = (): void => {
      this.inflight.delete(p);
    };
    p.then(done, done);
    return p;
  }

  private async doLaunch(profileId: string): Promise<RunInfo> {
    if (this.runs.has(profileId) || this.starting.has(profileId)) throw new LaunchError('Hồ sơ đang chạy');
    this.starting.add(profileId);
    let bridge: BridgeLike | null = null;
    let child: ChildProcess | null = null;
    const abort = new AbortController();
    try {
      const profile = this.deps.store.getProfile(profileId);
      if (!profile) throw new LaunchError('Không tìm thấy hồ sơ');
      const exe = this.deps.engine.executablePath();
      if (!exe) throw new LaunchError('Chưa cài nhân trình duyệt');
      const dir = join(this.deps.profilesDir, profileId);
      const args = [
        `--user-data-dir=${dir}`,
        ...fingerprintArgs(profile),
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
      ];
      if (profile.proxyId) {
        const proxy = this.deps.store.getProxy(profile.proxyId);
        if (!proxy) throw new LaunchError('Proxy của hồ sơ không còn tồn tại');
        try {
          await (this.deps.checkReachable ?? assertReachable)(proxy.host, proxy.port);
        } catch {
          throw new LaunchError(`Proxy ${proxy.host}:${proxy.port} không kết nối được`);
        }
        const open = this.deps.openBridge ?? ((u: Upstream) => ProxyBridge.open(u));
        bridge = await open({
          protocol: proxy.protocol,
          host: proxy.host,
          port: proxy.port,
          username: proxy.username,
          password: proxy.passwordEncrypted ? this.deps.secrets.decrypt(proxy.passwordEncrypted) : null,
        });
        args.push(`--proxy-server=${bridge.url}`);
      }
      // Chỉ tạo thư mục dữ liệu sau khi các kiểm tra proxy đã qua.
      await mkdir(dir, { recursive: true });
      await rm(join(dir, CDP_FILE), { force: true });
      child = (this.deps.spawnImpl ?? spawn)(exe, args, { stdio: 'ignore' });
      const spawned = child;
      let exited = false;
      const exit = new Promise<number | null>((resolve) =>
        spawned.once('exit', (code) => {
          exited = true;
          resolve(code);
        }),
      );
      // Luôn giữ một listener 'error' để lỗi spawn (ENOENT/EACCES) không thành uncaught exception.
      const spawnFailed = new Promise<never>((_, reject) =>
        spawned.on('error', (e) => reject(new LaunchError(`Không chạy được nhân trình duyệt: ${e.message}`))),
      );
      const cdp = await Promise.race([
        waitForCdpFile(dir, this.deps.cdpTimeoutMs ?? 20_000, abort.signal),
        spawnFailed,
        exit.then((code) => {
          throw new LaunchError(`Nhân thoát ngay khi khởi động (mã ${code})`);
        }),
      ]);
      const info: RunInfo = {
        profileId,
        pid: spawned.pid ?? 0,
        cdpPort: cdp.port,
        cdpUrl: `ws://127.0.0.1:${cdp.port}${cdp.path}`,
        startedAt: Date.now(),
      };
      // Mọi bước có thể lỗi phải xong trước khi đăng ký chạy, để catch dọn đúng.
      await writeFile(join(dir, RUN_FILE), JSON.stringify({ pid: info.pid }));
      this.deps.store.markLaunched(profileId, this.deps.engine.release().version);
      if (exited) throw new LaunchError('Nhân đã thoát trong lúc khởi động');
      const liveBridge = bridge;
      const cleanedUp = exit.then(async (code) => {
        try {
          this.exitCodes.set(profileId, code);
          await liveBridge?.close().catch(() => {});
          await rm(join(dir, RUN_FILE), { force: true });
        } catch {
          // lỗi dọn dẹp không được làm hỏng luồng dừng
        } finally {
          if (this.runs.get(profileId)?.child === spawned) this.runs.delete(profileId);
          this.emit('change', profileId);
        }
      });
      this.runs.set(profileId, { child: spawned, info, cleanedUp });
      this.emit('change', profileId);
      return info;
    } catch (err) {
      try {
        child?.kill();
      } catch {
        // nhân có thể đã thoát
      }
      await bridge?.close().catch(() => {});
      await rm(join(this.deps.profilesDir, profileId, RUN_FILE), { force: true }).catch(() => {});
      throw err;
    } finally {
      abort.abort();
      this.starting.delete(profileId);
    }
  }

  async stop(profileId: string): Promise<void> {
    const entry = this.runs.get(profileId);
    if (!entry) return;
    // Hẹn giờ SIGKILL trước, để lệnh đóng qua CDP có treo thì stop() vẫn có giới hạn thời gian.
    const timer = setTimeout(() => entry.child.kill('SIGKILL'), this.deps.killAfterMs ?? 5000);
    const close = (this.deps.closeBrowser ?? ((url: string) => cdpBrowserClose(url)))(entry.info.cdpUrl).catch(() => {
      entry.child.kill();
    });
    await Promise.race([close, entry.cleanedUp]);
    await entry.cleanedUp;
    clearTimeout(timer);
  }

  async stopAll(): Promise<void> {
    this.closing = true;
    // Chờ các lần khởi chạy dở dang xong (thành công thì đã đăng ký, thất bại thì đã tự dọn) rồi mới dừng.
    await Promise.allSettled([...this.inflight]);
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)));
  }

  async cleanupStale(): Promise<void> {
    const names = await readdir(this.deps.profilesDir).catch(() => [] as string[]);
    for (const name of names) {
      const dir = join(this.deps.profilesDir, name);
      const runFile = join(dir, RUN_FILE);
      const raw = await readFile(runFile, 'utf8').catch(() => null);
      if (raw === null) continue;
      let pid = 0;
      try {
        pid = Number(JSON.parse(raw).pid) || 0;
      } catch {
        pid = 0;
      }
      if (pid > 0) {
        const cmd = await (this.deps.pidCommand ?? pidCommand)(pid);
        if (cmd && commandUsesDir(cmd, dir)) {
          try {
            (this.deps.killPid ?? ((p: number) => process.kill(p)))(pid);
          } catch {
            // tiến trình đã tự thoát
          }
        }
      }
      await rm(runFile, { force: true });
      for (const f of LOCK_FILES) await rm(join(dir, f), { force: true });
    }
  }
}
