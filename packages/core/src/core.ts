import { EventEmitter } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { EngineManager, type EngineOptions } from './engine';
import { hostPlatform } from './fingerprint';
import { Launcher, type LauncherDeps, type RunInfo } from './launcher';
import { type NewProfile, type ProfileFilter, type ProfilePatch, ProfileStore } from './store';
import type { Group, Platform, Profile, Proxy, ProxyProtocol, SecretBox } from './types';

export type ProfileView = Profile & { run: RunInfo | null };
export type ProxyView = Omit<Proxy, 'passwordEncrypted'> & { hasPassword: boolean };
export type NewProxy = { protocol: ProxyProtocol; host: string; port: number; username?: string | null; password?: string | null };
export type ProxyPatch = Partial<NewProxy>;
export type CoreInfo = { engineInstalled: boolean; engineVersion: string; hostPlatform: Platform };

export interface CoreOptions {
  dataDir: string;
  secrets: SecretBox;
  enginesDir?: string;
  engineOptions?: Partial<EngineOptions>;
  launcherOverrides?: Partial<LauncherDeps>;
}

// Quy tắc host (giữ đơn giản): sau khi cắt khoảng trắng phải không rỗng và là tên miền
// (chữ, số, '.', '-', '_'), IPv4, hoặc IPv6 không ngoặc vuông (chỉ chữ số hex, ':' và '.', có ít nhất hai dấu ':').
// Không khoảng trắng, '/', '@'; dấu ':' chỉ được có trong IPv6.
const HOSTNAME_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const IPV6_RE = /^[0-9A-Fa-f:.]+$/;

function normalizeHost(host: unknown): string {
  const h = typeof host === 'string' ? host.trim() : '';
  const ok = h.includes(':') ? IPV6_RE.test(h) && h.split(':').length >= 3 : HOSTNAME_RE.test(h);
  if (!ok) throw new Error('Máy chủ proxy không hợp lệ');
  return h;
}

function checkProtocol(protocol: unknown): ProxyProtocol {
  if (protocol !== 'http' && protocol !== 'socks5') throw new Error('Giao thức proxy không hợp lệ');
  return protocol;
}

function checkPort(port: unknown): number {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Cổng proxy phải là số nguyên từ 1 đến 65535');
  }
  return port;
}

function toProxyView(x: Proxy): ProxyView {
  const { passwordEncrypted, ...rest } = x;
  return { ...rest, hasPassword: passwordEncrypted !== null };
}

export class Core extends EventEmitter {
  readonly store: ProfileStore;
  readonly engine: EngineManager;
  readonly launcher: Launcher;
  private profilesDir: string;
  private secrets: SecretBox;

  constructor(opts: CoreOptions) {
    super();
    mkdirSync(opts.dataDir, { recursive: true });
    this.profilesDir = join(opts.dataDir, 'profiles');
    mkdirSync(this.profilesDir, { recursive: true });
    this.secrets = opts.secrets;
    this.store = new ProfileStore(join(opts.dataDir, 'db.sqlite'));
    this.engine = new EngineManager({ enginesDir: opts.enginesDir ?? join(opts.dataDir, 'engines'), ...opts.engineOptions });
    this.launcher = new Launcher({
      store: this.store,
      engine: this.engine,
      profilesDir: this.profilesDir,
      secrets: this.secrets,
      ...opts.launcherOverrides,
    });
    this.launcher.on('change', (id: string) => this.emit('change', id));
  }

  async init(): Promise<void> {
    await this.launcher.cleanupStale();
  }

  async shutdown(): Promise<void> {
    try {
      await this.launcher.stopAll();
    } finally {
      this.store.close();
    }
  }

  info(): CoreInfo {
    return {
      engineInstalled: this.engine.executablePath() !== null,
      engineVersion: this.engine.release().version,
      hostPlatform: hostPlatform(),
    };
  }

  async installEngine(onProgress?: (received: number, total: number) => void): Promise<void> {
    await this.engine.install(onProgress);
  }

  listProfiles(filter: ProfileFilter = {}): ProfileView[] {
    return this.store.listProfiles(filter).map((p) => ({ ...p, run: this.launcher.status(p.id) }));
  }

  private checkProfileRefs(patch: { name?: string; proxyId?: string | null; groupId?: string | null }): void {
    if (patch.proxyId && !this.store.getProxy(patch.proxyId)) throw new Error('Không tìm thấy proxy');
    if (patch.groupId && !this.store.listGroups().some((g) => g.id === patch.groupId)) throw new Error('Không tìm thấy nhóm');
  }

  private cleanName(name: unknown): string {
    const n = typeof name === 'string' ? name.trim() : '';
    if (!n) throw new Error('Tên hồ sơ không được để trống');
    return n;
  }

  createProfile(input: NewProfile): Profile {
    const name = this.cleanName(input.name);
    this.checkProfileRefs(input);
    return this.store.createProfile({ ...input, name });
  }

  updateProfile(id: string, patch: ProfilePatch): Profile {
    if (!this.store.getProfile(id)) throw new Error('Không tìm thấy hồ sơ');
    const next = { ...patch };
    if (patch.name !== undefined) next.name = this.cleanName(patch.name);
    this.checkProfileRefs(patch);
    return this.store.updateProfile(id, next);
  }

  deleteProfile(id: string): void {
    if (!this.store.getProfile(id)) throw new Error('Không tìm thấy hồ sơ');
    if (this.launcher.isActive(id)) throw new Error('Hãy dừng hồ sơ trước khi xoá');
    const dir = resolve(this.profilesDir, id);
    if (dirname(dir) !== resolve(this.profilesDir)) throw new Error('Mã hồ sơ không hợp lệ');
    this.store.deleteProfile(id);
    rmSync(dir, { recursive: true, force: true });
  }

  listGroups(): Group[] {
    return this.store.listGroups();
  }

  createGroup(name: string): Group {
    return this.store.createGroup(name);
  }

  renameGroup(id: string, name: string): void {
    this.store.renameGroup(id, name);
  }

  deleteGroup(id: string): void {
    this.store.deleteGroup(id);
  }

  listProxies(): ProxyView[] {
    return this.store.listProxies().map(toProxyView);
  }

  createProxy(input: NewProxy): ProxyView {
    const protocol = checkProtocol(input.protocol);
    const host = normalizeHost(input.host);
    const port = checkPort(input.port);
    const username = input.username || null;
    if (input.password && !username) throw new Error('Cần tài khoản khi có mật khẩu');
    return toProxyView(
      this.store.createProxy({
        protocol,
        host,
        port,
        username,
        passwordEncrypted: input.password ? this.secrets.encrypt(input.password) : null,
      }),
    );
  }

  updateProxy(id: string, patch: ProxyPatch): ProxyView {
    const current = this.store.getProxy(id);
    if (!current) throw new Error('Không tìm thấy proxy');
    // Danh sách trường cho phép: không bao giờ trải nguyên đối tượng của người gọi vào DB.
    const dbPatch: Partial<Omit<Proxy, 'id'>> = {};
    if (patch.protocol !== undefined) dbPatch.protocol = checkProtocol(patch.protocol);
    if (patch.host !== undefined) dbPatch.host = normalizeHost(patch.host);
    if (patch.port !== undefined) dbPatch.port = checkPort(patch.port);
    if (patch.username !== undefined) dbPatch.username = patch.username || null;
    if (patch.password !== undefined) {
      dbPatch.passwordEncrypted = patch.password ? this.secrets.encrypt(patch.password) : null;
    }
    const username = 'username' in dbPatch ? dbPatch.username : current.username;
    const passwordEncrypted = 'passwordEncrypted' in dbPatch ? dbPatch.passwordEncrypted : current.passwordEncrypted;
    if (passwordEncrypted && !username) throw new Error('Cần tài khoản khi có mật khẩu');
    return toProxyView(this.store.updateProxy(id, dbPatch));
  }

  deleteProxy(id: string): void {
    if (!this.store.getProxy(id)) throw new Error('Không tìm thấy proxy');
    const users = this.store.listProfiles().filter((p) => p.proxyId === id);
    if (users.length > 0) {
      throw new Error(`Proxy đang được dùng bởi hồ sơ: ${users.map((p) => p.name).join(', ')}. Hãy đổi proxy của các hồ sơ đó trước.`);
    }
    this.store.deleteProxy(id);
  }

  launch(id: string): Promise<RunInfo> {
    return this.launcher.launch(id);
  }

  stop(id: string): Promise<void> {
    return this.launcher.stop(id);
  }
}
