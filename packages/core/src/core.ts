import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CdpError, type CdpSession, openCdp } from './cdp';
import { type CdpCookie, type CookieParam, cookieKey, parseCookies, toExportCookies } from './cookie-parse';
import { EngineManager, type EngineOptions } from './engine';
import { installExtensionFiles } from './extension-files';
import { hostPlatform } from './fingerprint';
import { LaunchError, Launcher, type LauncherDeps, type RunInfo } from './launcher';
import { localeForCountry } from './locale';
import type { Upstream } from './proxy-bridge';
import { RATE_LIMITED, type ProxyCheckResult, checkProxy as runProxyCheck, validTimezone } from './proxy-checker';
import { parseProxyList } from './proxy-parse';
import { type NewProfile, type NewProxyRow, type ProfileFilter, type ProfilePatch, ProfileStore, type ProxyRowPatch } from './store';
import type { Extension, Group, Platform, Profile, Proxy, ProxyProtocol, SecretBox } from './types';

export type ProfileView = Profile & { run: RunInfo | null; extensionIds: string[] };
export type ProfileInput = NewProfile & { extensionIds?: string[] };
export type ProfileUpdate = ProfilePatch & { extensionIds?: string[] };
export type ProxyView = Omit<Proxy, 'passwordEncrypted'> & { hasPassword: boolean };
export type NewProxy = { protocol: ProxyProtocol; host: string; port: number; username?: string | null; password?: string | null };
export type ProxyPatch = Partial<NewProxy>;
export type CoreInfo = { engineInstalled: boolean; engineVersion: string; hostPlatform: Platform };
export type ProxyImportResult = { created: ProxyView[]; skipped: number; errors: { line: number; reason: string }[] };
export type BulkCreateInput = {
  count: number;
  namePattern: string;
  startIndex?: number;
  groupId?: string | null;
  proxyMode?: 'none' | 'unused';
  applyLocale?: boolean;
};
export type CookieImportResult = {
  format: 'json' | 'netscape';
  imported: number;
  failed: number;
  sessionSkipped: number;
  errors: { index: number; reason: string }[];
};
export type LocaleApplyResult = { updated: number; skipped: { id: string; name: string; reason: string }[] };

export interface CoreOptions {
  dataDir: string;
  secrets: SecretBox;
  enginesDir?: string;
  engineOptions?: Partial<EngineOptions>;
  launcherOverrides?: Partial<LauncherDeps>;
  lookupUrl?: string;
  proxyCheck?: (u: Upstream) => Promise<ProxyCheckResult>;
  cdpConnect?: (cdpUrl: string) => Promise<CdpSession>;
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

const BAD_ARGS = 'Tham số không hợp lệ';
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// undefined, null hoặc chuỗi; chuỗi rỗng coi như null. Kiểu khác bị từ chối, không bao giờ ép thành null.
function refValue(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'string') return v || null;
  throw new Error(BAD_ARGS);
}

function normalizeRefs<T extends { proxyId?: string | null; groupId?: string | null }>(input: T): T {
  const next = { ...input };
  if (next.proxyId !== undefined) next.proxyId = refValue(next.proxyId);
  if (next.groupId !== undefined) next.groupId = refValue(next.groupId);
  return next;
}

const LANG_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

function checkLang(lang: unknown): string {
  if (typeof lang !== 'string' || lang.length > 35 || !LANG_TAG.test(lang)) throw new Error('Ngôn ngữ không hợp lệ');
  return lang;
}

function checkAcceptLang(value: unknown): string {
  const tags = typeof value === 'string' ? value.split(',').map((t) => t.trim()) : [];
  if (tags.length < 1 || tags.length > 10 || !tags.every((t) => t.length <= 35 && LANG_TAG.test(t))) {
    throw new Error('Accept-Language không hợp lệ');
  }
  return tags.join(',');
}

// Chỉ kiểm tra các trường có mặt trong đầu vào; các giá trị này trở thành tham số dòng lệnh khi khởi chạy.
function normalizeLocaleFields<T extends { timezone?: string; lang?: string; acceptLang?: string }>(input: T): T {
  const next = { ...input };
  if (next.timezone !== undefined) {
    const tz = validTimezone(next.timezone);
    if (!tz) throw new Error('Múi giờ không hợp lệ');
    next.timezone = tz;
  }
  if (next.lang !== undefined) next.lang = checkLang(next.lang);
  if (next.acceptLang !== undefined) next.acceptLang = checkAcceptLang(next.acceptLang);
  return next;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const PLATFORMS: readonly unknown[] = ['macos', 'windows', 'linux'];
const PLATFORM_VERSION = /^\d{1,3}(\.\d{1,5}){0,3}$/;
const BRAND = /^[A-Za-z][A-Za-z0-9 ]{0,29}$/;
const MAX_NOTES = 5000;

// Các trường này thành tham số dòng lệnh của nhân, nên lõi tự kiểm chứ không tin nơi gọi (giao diện hay API).
function normalizeProfileFields<
  T extends { platform?: unknown; platformVersion?: unknown; brand?: unknown; hardwareConcurrency?: unknown; notes?: unknown },
>(input: T): T {
  const next = { ...input };
  if (next.platform !== undefined && !PLATFORMS.includes(next.platform)) throw new Error('Hệ điều hành không hợp lệ');
  if (next.platformVersion !== undefined && next.platformVersion !== null) {
    if (next.platformVersion === '') next.platformVersion = null;
    else if (typeof next.platformVersion !== 'string' || !PLATFORM_VERSION.test(next.platformVersion)) {
      throw new Error('Phiên bản hệ điều hành không hợp lệ');
    }
  }
  if (next.brand !== undefined && (typeof next.brand !== 'string' || !BRAND.test(next.brand))) {
    throw new Error('Tên trình duyệt không hợp lệ');
  }
  const cores = next.hardwareConcurrency;
  if (cores !== undefined && cores !== null && (typeof cores !== 'number' || !Number.isInteger(cores) || cores < 1 || cores > 128)) {
    throw new Error('Số nhân CPU phải là số nguyên từ 1 đến 128');
  }
  if (next.notes !== undefined) {
    if (typeof next.notes !== 'string') throw new Error('Ghi chú không hợp lệ');
    if (next.notes.length > MAX_NOTES) throw new Error(`Ghi chú tối đa ${MAX_NOTES} ký tự`);
  }
  return next;
}

const MAX_BULK = 500;
const CHECK_CONCURRENCY = 5;
const MAX_START_INDEX = 1_000_000_000;
const MAX_NAME = 200;
const MAX_IMPORT_CHARS = 1_000_000;
const MAX_IMPORT_LINES = 5000;
const MAX_CHECK_IDS = 1000;
const MAX_COOKIE_CHARS = 5_000_000;
const MAX_EXTENSIONS_PER_OWNER = 100;
const COOKIE_CHUNK = 500;

function proxyKey(p: { protocol: string; host: string; port: number; username: string | null }): string {
  return `${p.protocol}|${p.host.toLowerCase()}|${p.port}|${p.username ?? ''}`;
}

function localeFromProxy(proxy: Proxy): { timezone: string; lang?: string; acceptLang?: string } | null {
  if (proxy.lastStatus !== 'ok' || !proxy.lastTimezone) return null;
  return { timezone: proxy.lastTimezone, ...(localeForCountry(proxy.lastCountry) ?? {}) };
}

export class Core extends EventEmitter {
  readonly store: ProfileStore;
  readonly engine: EngineManager;
  readonly launcher: Launcher;
  private profilesDir: string;
  private extensionsDir: string;
  private secrets: SecretBox;
  private proxyCheck: (u: Upstream) => Promise<ProxyCheckResult>;
  private cdpConnect: (cdpUrl: string) => Promise<CdpSession>;
  private cookieBusy = new Set<string>();

  constructor(opts: CoreOptions) {
    super();
    mkdirSync(opts.dataDir, { recursive: true });
    this.profilesDir = join(opts.dataDir, 'profiles');
    mkdirSync(this.profilesDir, { recursive: true });
    this.extensionsDir = join(opts.dataDir, 'extensions');
    mkdirSync(this.extensionsDir, { recursive: true });
    this.secrets = opts.secrets;
    this.proxyCheck = opts.proxyCheck ?? ((u) => runProxyCheck(u, { lookupUrl: opts.lookupUrl }));
    this.cdpConnect = opts.cdpConnect ?? ((url) => openCdp(url));
    this.store = new ProfileStore(join(opts.dataDir, 'db.sqlite'));
    this.engine = new EngineManager({ enginesDir: opts.enginesDir ?? join(opts.dataDir, 'engines'), ...opts.engineOptions });
    this.launcher = new Launcher({
      store: this.store,
      engine: this.engine,
      profilesDir: this.profilesDir,
      secrets: this.secrets,
      extensionDirs: (id) => this.extensionDirsFor(id),
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
    const links = this.store.profileExtensionLinks();
    return this.store.listProfiles(filter).map((p) => ({ ...p, run: this.launcher.status(p.id), extensionIds: links[p.id] ?? [] }));
  }

  getProfile(id: string): ProfileView {
    const profile = typeof id === 'string' ? this.store.getProfile(id) : null;
    if (!profile) throw new Error('Không tìm thấy hồ sơ');
    return { ...profile, run: this.launcher.status(profile.id), extensionIds: this.store.profileExtensionLinks()[profile.id] ?? [] };
  }

  private checkProfileRefs(patch: { name?: string; proxyId?: string | null; groupId?: string | null }): void {
    if (patch.proxyId && !this.store.getProxy(patch.proxyId)) throw new Error('Không tìm thấy proxy');
    if (patch.groupId && !this.store.listGroups().some((g) => g.id === patch.groupId)) throw new Error('Không tìm thấy nhóm');
  }

  private cleanName(name: unknown): string {
    const n = typeof name === 'string' ? name.trim() : '';
    if (!n) throw new Error('Tên hồ sơ không được để trống');
    if (n.length > MAX_NAME) throw new Error(`Tên hồ sơ tối đa ${MAX_NAME} ký tự`);
    if (CONTROL_CHARS.test(n)) throw new Error('Tên hồ sơ chứa ký tự không hợp lệ');
    return n;
  }

  private checkExtensionIds(ids: unknown): string[] {
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new Error('Danh sách extension không hợp lệ');
    if (ids.length > MAX_EXTENSIONS_PER_OWNER) throw new Error(`Tối đa ${MAX_EXTENSIONS_PER_OWNER} extension`);
    const unique = [...new Set(ids as string[])];
    if (!unique.every((x) => this.store.getExtension(x))) throw new Error('Không tìm thấy extension');
    return unique;
  }

  createProfile(input: ProfileInput): Profile {
    const { extensionIds, ...rest } = input;
    const exts = extensionIds === undefined ? null : this.checkExtensionIds(extensionIds);
    const clean = normalizeProfileFields(normalizeLocaleFields(normalizeRefs(rest)));
    const name = this.cleanName(clean.name);
    this.checkProfileRefs(clean);
    const created = this.store.transaction(() => {
      const profile = this.store.createProfile({ ...clean, name });
      if (exts) this.store.setProfileExtensions(profile.id, exts);
      return profile;
    });
    this.emit('change', created.id);
    return created;
  }

  updateProfile(id: string, patch: ProfileUpdate): Profile {
    if (!this.store.getProfile(id)) throw new Error('Không tìm thấy hồ sơ');
    const { extensionIds, ...rest } = patch;
    const exts = extensionIds === undefined ? null : this.checkExtensionIds(extensionIds);
    const next = normalizeProfileFields(normalizeLocaleFields(normalizeRefs(rest)));
    if (next.name !== undefined) next.name = this.cleanName(next.name);
    this.checkProfileRefs(next);
    const updated = this.store.transaction(() => {
      if (exts) this.store.setProfileExtensions(id, exts);
      return this.store.updateProfile(id, next);
    });
    this.emit('change', id);
    return updated;
  }

  deleteProfile(id: string): void {
    if (!this.store.getProfile(id)) throw new Error('Không tìm thấy hồ sơ');
    if (this.launcher.isActive(id)) throw new Error('Hãy dừng hồ sơ trước khi xoá');
    const dir = resolve(this.profilesDir, id);
    if (dirname(dir) !== resolve(this.profilesDir)) throw new Error('Mã hồ sơ không hợp lệ');
    this.store.deleteProfile(id);
    rmSync(dir, { recursive: true, force: true });
    this.emit('change', id);
  }

  listGroups(): Group[] {
    return this.store.listGroups();
  }

  createGroup(name: string): Group {
    const g = this.store.createGroup(name);
    this.emit('change', '');
    return g;
  }

  renameGroup(id: string, name: string): void {
    this.store.renameGroup(id, name);
    this.emit('change', '');
  }

  deleteGroup(id: string): void {
    this.store.deleteGroup(id);
    this.emit('change', '');
  }

  listProxies(): ProxyView[] {
    return this.store.listProxies().map(toProxyView);
  }

  private prepareProxy(input: NewProxy): NewProxyRow {
    const protocol = checkProtocol(input.protocol);
    const host = normalizeHost(input.host);
    const port = checkPort(input.port);
    const username = input.username || null;
    if (input.password && !username) throw new Error('Cần tài khoản khi có mật khẩu');
    return { protocol, host, port, username, passwordEncrypted: input.password ? this.secrets.encrypt(input.password) : null };
  }

  createProxy(input: NewProxy): ProxyView {
    const view = toProxyView(this.store.createProxy(this.prepareProxy(input)));
    this.emit('change', '');
    return view;
  }

  updateProxy(id: string, patch: ProxyPatch): ProxyView {
    const current = this.store.getProxy(id);
    if (!current) throw new Error('Không tìm thấy proxy');
    // Danh sách trường cho phép: không bao giờ trải nguyên đối tượng của người gọi vào DB.
    const dbPatch: ProxyRowPatch = {};
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
    if (Object.keys(dbPatch).length > 0) {
      this.store.transaction(() => {
        this.store.updateProxy(id, dbPatch);
        this.store.clearProxyCheck(id);
      });
      this.emit('change', '');
    }
    return toProxyView(this.store.getProxy(id)!);
  }

  deleteProxy(id: string): void {
    if (!this.store.getProxy(id)) throw new Error('Không tìm thấy proxy');
    const users = this.store.listProfiles().filter((p) => p.proxyId === id);
    if (users.length > 0) {
      throw new Error(`Proxy đang được dùng bởi hồ sơ: ${users.map((p) => p.name).join(', ')}. Hãy đổi proxy của các hồ sơ đó trước.`);
    }
    this.store.deleteProxy(id);
    this.emit('change', '');
  }

  importProxies(text: string, defaultProtocol: ProxyProtocol = 'http'): ProxyImportResult {
    if (typeof text !== 'string') throw new Error('Danh sách proxy không hợp lệ');
    const tooLong = 'Danh sách proxy quá dài (tối đa 5000 dòng)';
    if (text.length > MAX_IMPORT_CHARS) throw new Error(tooLong);
    const parsed = parseProxyList(text, checkProtocol(defaultProtocol));
    if (parsed.proxies.length + parsed.errors.length > MAX_IMPORT_LINES) throw new Error(tooLong);
    const errors = [...parsed.errors];
    const seen = new Set(this.store.listProxies().map(proxyKey));
    const rows: NewProxyRow[] = [];
    let skipped = 0;
    // Kiểm tra từng dòng trước khi ghi: chỉ lỗi kiểm tra mới thành lỗi theo dòng.
    for (const item of parsed.proxies) {
      if (seen.has(proxyKey(item))) {
        skipped++;
        continue;
      }
      try {
        rows.push(this.prepareProxy(item));
        seen.add(proxyKey(item));
      } catch (err) {
        errors.push({ line: item.line, reason: (err as Error).message });
      }
    }
    // Ghi một transaction: lỗi lưu trữ thật sự làm hỏng cả lần nhập, không đổi gì.
    const created = this.store.transaction(() => rows.map((row) => toProxyView(this.store.createProxy(row))));
    errors.sort((a, b) => a.line - b.line);
    if (created.length > 0) this.emit('change', '');
    return { created, skipped, errors };
  }

  async checkProxy(id: string): Promise<ProxyView> {
    const proxy = this.store.getProxy(id);
    if (!proxy) throw new Error('Không tìm thấy proxy');
    const { protocol, host, port, username, passwordEncrypted } = proxy;
    const result = await this.proxyCheck({
      protocol,
      host,
      port,
      username,
      password: passwordEncrypted ? this.secrets.decrypt(passwordEncrypted) : null,
    });
    const now = this.store.getProxy(id);
    if (!now) throw new Error('Không tìm thấy proxy');
    if (
      now.protocol !== protocol ||
      now.host !== host ||
      now.port !== port ||
      now.username !== username ||
      now.passwordEncrypted !== passwordEncrypted
    ) {
      throw new Error('Proxy đã thay đổi trong lúc kiểm tra, hãy kiểm tra lại');
    }
    if (result.rateLimited) throw new Error(RATE_LIMITED);
    this.store.saveProxyCheck(id, result);
    this.emit('change', id);
    return toProxyView(this.store.getProxy(id)!);
  }

  async checkProxies(ids: string[]): Promise<void> {
    if (!Array.isArray(ids)) throw new Error('Danh sách proxy không hợp lệ');
    if (ids.length > MAX_CHECK_IDS) throw new Error(`Kiểm tra tối đa ${MAX_CHECK_IDS} proxy một lần`);
    const queue = [...new Set(ids.filter((id) => typeof id === 'string'))];
    const worker = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        await this.checkProxy(id).catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, queue.length) }, worker));
  }

  private unusedProxies(): Proxy[] {
    const used = new Set(this.store.listProfiles().map((p) => p.proxyId));
    return this.store.listProxies().filter((x) => !used.has(x.id));
  }

  private profilesByIds(ids: unknown): Profile[] {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('Chưa chọn hồ sơ nào');
    if (ids.length > 1000) throw new Error('Chọn tối đa 1000 hồ sơ một lần');
    return [...new Set(ids)].map((id) => {
      const profile = typeof id === 'string' ? this.store.getProfile(id) : null;
      if (!profile) throw new Error('Không tìm thấy hồ sơ');
      return profile;
    });
  }

  createProfilesBulk(input: BulkCreateInput): Profile[] {
    if (!isRecord(input)) throw new Error(BAD_ARGS);
    const count = input.count;
    if (!Number.isInteger(count) || count < 1 || count > MAX_BULK) throw new Error(`Số lượng phải từ 1 đến ${MAX_BULK}`);
    const start = input.startIndex ?? 1;
    if (!Number.isInteger(start) || start < 0 || start > MAX_START_INDEX) throw new Error('Số bắt đầu không hợp lệ');
    const pattern = this.cleanName(input.namePattern);
    const groupId = refValue(input.groupId) ?? null;
    this.checkProfileRefs({ groupId });
    const mode = input.proxyMode ?? 'none';
    if (mode !== 'none' && mode !== 'unused') throw new Error('Cách gán proxy không hợp lệ');
    const pool = mode === 'unused' ? this.unusedProxies() : [];
    if (mode === 'unused' && pool.length < count) throw new Error(`Không đủ proxy chưa dùng: cần ${count}, có ${pool.length}`);
    if (mode === 'unused' && input.applyLocale) {
      const unchecked = pool.slice(0, count).filter((x) => localeFromProxy(x) === null).length;
      if (unchecked > 0) throw new Error(`Có ${unchecked} proxy chưa kiểm tra thành công. Hãy bấm "Kiểm tra tất cả" trước khi tạo.`);
    }
    const width = Math.max(2, String(start + count - 1).length);
    const names = Array.from({ length: count }, (_, i) => {
      const n = String(start + i).padStart(width, '0');
      return this.cleanName(pattern.includes('{n}') ? pattern.replaceAll('{n}', n) : `${pattern}-${n}`);
    });
    const made = this.store.transaction(() =>
      names.map((name, i) => {
        const proxy = mode === 'unused' ? pool[i] : null;
        const locale = input.applyLocale && proxy ? localeFromProxy(proxy) : null;
        return this.store.createProfile({ name, groupId, proxyId: proxy?.id ?? null, ...(locale ?? {}) });
      }),
    );
    this.emit('change', '');
    return made;
  }

  updateProfilesBulk(ids: string[], patch: { groupId?: string | null; proxyId?: string | null }): number {
    const profiles = this.profilesByIds(ids);
    if (!isRecord(patch)) throw new Error(BAD_ARGS);
    // Danh sách trường cho phép: chỉ nhóm và proxy.
    const next: { groupId?: string | null; proxyId?: string | null } = {};
    if (patch.groupId !== undefined) next.groupId = refValue(patch.groupId);
    if (patch.proxyId !== undefined) next.proxyId = refValue(patch.proxyId);
    if (Object.keys(next).length === 0) throw new Error('Chưa chọn thay đổi nào');
    this.checkProfileRefs(next);
    this.store.transaction(() => {
      for (const p of profiles) this.store.updateProfile(p.id, next);
    });
    this.emit('change', '');
    return profiles.length;
  }

  assignUnusedProxies(ids: string[]): number {
    const profiles = this.profilesByIds(ids);
    const pool = this.unusedProxies();
    if (pool.length < profiles.length) throw new Error(`Không đủ proxy chưa dùng: cần ${profiles.length}, có ${pool.length}`);
    this.store.transaction(() => {
      profiles.forEach((p, i) => this.store.updateProfile(p.id, { proxyId: pool[i].id }));
    });
    this.emit('change', '');
    return profiles.length;
  }

  applyProxyLocale(ids: string[]): LocaleApplyResult {
    const profiles = this.profilesByIds(ids);
    const skipped: LocaleApplyResult['skipped'] = [];
    const updates: { id: string; patch: ProfilePatch }[] = [];
    for (const p of profiles) {
      const proxy = p.proxyId ? this.store.getProxy(p.proxyId) : null;
      if (!proxy) {
        skipped.push({ id: p.id, name: p.name, reason: 'Không có proxy' });
        continue;
      }
      const locale = localeFromProxy(proxy);
      if (!locale) {
        skipped.push({ id: p.id, name: p.name, reason: 'Proxy chưa kiểm tra thành công' });
        continue;
      }
      updates.push({ id: p.id, patch: locale });
    }
    this.store.transaction(() => {
      for (const u of updates) this.store.updateProfile(u.id, u.patch);
    });
    if (updates.length > 0) this.emit('change', '');
    return { updated: updates.length, skipped };
  }

  private extensionDirsFor(profileId: string): string[] {
    return this.store.extensionsForProfile(profileId).map((e) => {
      // Luôn tính đường dẫn từ mã extension, không tin cột path trong DB.
      const dir = join(this.extensionsDir, e.id);
      if (!existsSync(join(dir, 'manifest.json'))) {
        throw new LaunchError(`Thiếu file của extension "${e.name}". Hãy xoá rồi thêm lại extension này.`);
      }
      return dir;
    });
  }

  listExtensions(): Extension[] {
    return this.store.listExtensions();
  }

  /** Chỉ gọi từ tiến trình main sau hộp thoại chọn file; không đưa vào danh sách IPC cho phép. */
  async addExtension(sourcePath: string): Promise<Extension> {
    if (typeof sourcePath !== 'string' || sourcePath === '') throw new Error(BAD_ARGS);
    if (this.extensionsDir.includes(',')) throw new Error('Thư mục dữ liệu của ứng dụng chứa dấu phẩy nên không nạp được extension');
    const id = randomUUID();
    const dir = join(this.extensionsDir, id);
    let ext: Extension;
    try {
      const meta = await installExtensionFiles(sourcePath, dir);
      ext = this.store.createExtension({ id, name: meta.name, version: meta.version, path: dir });
    } catch (err) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    this.emit('change', '');
    return ext;
  }

  deleteExtension(id: string): void {
    if (typeof id !== 'string' || !this.store.getExtension(id)) throw new Error('Không tìm thấy extension');
    const users = this.store
      .listProfiles()
      .filter((p) => this.launcher.isActive(p.id) && this.store.extensionsForProfile(p.id).some((e) => e.id === id));
    if (users.length > 0) {
      throw new Error(`Extension đang được dùng bởi hồ sơ đang chạy: ${users.map((p) => p.name).join(', ')}. Hãy dừng các hồ sơ đó trước.`);
    }
    const dir = resolve(this.extensionsDir, id);
    if (dirname(dir) !== resolve(this.extensionsDir)) throw new Error('Mã extension không hợp lệ');
    this.store.deleteExtension(id);
    try {
      rmSync(dir, { recursive: true, force: true });
    } finally {
      this.emit('change', '');
    }
  }

  setProfileExtensions(profileId: string, extensionIds: string[]): void {
    if (typeof profileId !== 'string' || !this.store.getProfile(profileId)) throw new Error('Không tìm thấy hồ sơ');
    const exts = this.checkExtensionIds(extensionIds);
    this.store.transaction(() => this.store.setProfileExtensions(profileId, exts));
    this.emit('change', profileId);
  }

  setGroupExtensions(groupId: string, extensionIds: string[]): void {
    if (typeof groupId !== 'string' || !this.store.listGroups().some((g) => g.id === groupId)) throw new Error('Không tìm thấy nhóm');
    const exts = this.checkExtensionIds(extensionIds);
    this.store.transaction(() => this.store.setGroupExtensions(groupId, exts));
    this.emit('change', '');
  }

  listGroupExtensions(): Record<string, string[]> {
    return this.store.groupExtensionLinks();
  }

  /**
   * Chạy fn với một kết nối CDP tới hồ sơ. Hồ sơ chưa chạy thì mở ẩn qua Launcher (vẫn qua cầu proxy)
   * và luôn dừng lại sau đó, kể cả khi fn lỗi.
   */
  private async withBrowser<T>(id: string, fn: (cdp: CdpSession, temporary: boolean) => Promise<T>): Promise<T> {
    if (typeof id !== 'string' || !this.store.getProfile(id)) throw new Error('Không tìm thấy hồ sơ');
    if (this.cookieBusy.has(id)) throw new Error('Hồ sơ đang có thao tác cookie khác, hãy chờ xong');
    this.cookieBusy.add(id);
    try {
      let run = this.launcher.status(id);
      const temporary = run === null;
      if (!run) {
        if (this.launcher.isActive(id)) throw new Error('Hồ sơ đang khởi động, hãy thử lại sau');
        run = await this.launcher.launch(id, { headless: true });
      }
      try {
        const cdp = await this.cdpConnect(run.cdpUrl);
        try {
          return await fn(cdp, temporary);
        } finally {
          cdp.close();
        }
      } finally {
        // Chỉ dừng nếu lần chạy hiện tại vẫn là lần chạy ẩn của ta (người dùng có thể đã mở lại hồ sơ có giao diện).
        if (temporary && this.launcher.status(id)?.headless === true) {
          await this.launcher.stop(id).catch(() => {});
        }
      }
    } finally {
      this.cookieBusy.delete(id);
    }
  }

  async importCookies(id: string, text: string): Promise<CookieImportResult> {
    if (typeof text !== 'string') throw new Error(BAD_ARGS);
    if (text.length > MAX_COOKIE_CHARS) throw new Error('Nội dung cookie quá dài (tối đa 5 MB)');
    if (typeof id !== 'string' || !this.store.getProfile(id)) throw new Error('Không tìm thấy hồ sơ');
    const parsed = parseCookies(text);
    const persistent = parsed.cookies.filter((c) => c.expires !== undefined);
    const pick = (temporary: boolean): CookieParam[] => (temporary ? persistent : parsed.cookies);
    const result = (toSet: CookieParam[], imported: number): CookieImportResult => ({
      format: parsed.format,
      imported,
      failed: toSet.length - imported,
      sessionSkipped: parsed.cookies.length - toSet.length,
      errors: parsed.errors,
    });
    // Không có gì để ghi thì không mở nhân. (Khi đó mọi cookie còn lại, nếu có, đều là cookie phiên của hồ sơ chưa chạy.)
    if (pick(this.launcher.status(id) === null).length === 0) return result([], 0);
    return this.withBrowser(id, async (cdp, temporary) => {
      const toSet = pick(temporary);
      const rejected = (err: unknown): boolean => err instanceof CdpError && err.protocol;
      for (let i = 0; i < toSet.length; i += COOKIE_CHUNK) {
        const chunk = toSet.slice(i, i + COOKIE_CHUNK);
        try {
          await cdp.call('Storage.setCookies', { cookies: chunk });
        } catch (err) {
          if (!rejected(err)) throw err;
          // Nhân từ chối cả lô vì một cookie sai: ghi lại từng cookie để các cookie tốt vẫn vào.
          for (const cookie of chunk) {
            await cdp.call('Storage.setCookies', { cookies: [cookie] }).catch((e: unknown) => {
              if (!rejected(e)) throw e;
            });
          }
        }
      }
      // Nhân có thể nhận lệnh mà không lưu cookie, nên đếm bằng cách đọc lại.
      const stored = await cdp.call<{ cookies: CdpCookie[] }>('Storage.getCookies');
      const have = new Set(stored.cookies.map(cookieKey));
      return result(toSet, toSet.filter((c) => have.has(cookieKey(c))).length);
    });
  }

  async exportCookies(id: string): Promise<{ count: number; json: string }> {
    return this.withBrowser(id, async (cdp) => {
      const { cookies } = await cdp.call<{ cookies: CdpCookie[] }>('Storage.getCookies');
      const out = toExportCookies(cookies);
      return { count: out.length, json: JSON.stringify(out, null, 2) };
    });
  }

  launch(id: string, opts?: { headless?: boolean }): Promise<RunInfo> {
    if (opts !== undefined && (!isRecord(opts) || (opts.headless !== undefined && typeof opts.headless !== 'boolean'))) {
      return Promise.reject(new Error(BAD_ARGS));
    }
    return this.launcher.launch(id, { headless: opts?.headless === true });
  }

  stop(id: string): Promise<void> {
    return this.launcher.stop(id);
  }
}
