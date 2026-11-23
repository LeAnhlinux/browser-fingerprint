import { EventEmitter } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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
    await this.launcher.stopAll();
    this.store.close();
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

  createProfile(input: NewProfile): Profile {
    return this.store.createProfile(input);
  }

  updateProfile(id: string, patch: ProfilePatch): Profile {
    return this.store.updateProfile(id, patch);
  }

  deleteProfile(id: string): void {
    if (this.launcher.status(id)) throw new Error('Hãy dừng hồ sơ trước khi xoá');
    this.store.deleteProfile(id);
    rmSync(join(this.profilesDir, id), { recursive: true, force: true });
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
    return toProxyView(
      this.store.createProxy({
        protocol: input.protocol,
        host: input.host,
        port: input.port,
        username: input.username || null,
        passwordEncrypted: input.password ? this.secrets.encrypt(input.password) : null,
      }),
    );
  }

  updateProxy(id: string, patch: ProxyPatch): ProxyView {
    const { password, ...rest } = patch;
    const dbPatch: Partial<Omit<Proxy, 'id'>> = { ...rest };
    if ('username' in patch) dbPatch.username = patch.username || null;
    if (password !== undefined) dbPatch.passwordEncrypted = password ? this.secrets.encrypt(password) : null;
    return toProxyView(this.store.updateProxy(id, dbPatch));
  }

  deleteProxy(id: string): void {
    this.store.deleteProxy(id);
  }

  launch(id: string): Promise<RunInfo> {
    return this.launcher.launch(id);
  }

  stop(id: string): Promise<void> {
    return this.launcher.stop(id);
  }
}
