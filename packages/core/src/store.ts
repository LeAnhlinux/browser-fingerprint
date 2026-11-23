import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hostDefaults, randomSeed } from './fingerprint';
import type { Extension, FingerprintSnapshot, Group, Profile, Proxy } from './types';

export type NewProfile = { name: string } & Partial<
  Pick<Profile, 'groupId' | 'notes' | 'platform' | 'platformVersion' | 'brand' | 'hardwareConcurrency' | 'screenWidth' | 'screenHeight' | 'screenScale' | 'lang' | 'acceptLang' | 'timezone' | 'proxyId'>
>;
export type ProfilePatch = Partial<
  Pick<Profile, 'name' | 'groupId' | 'notes' | 'platform' | 'platformVersion' | 'brand' | 'hardwareConcurrency' | 'screenWidth' | 'screenHeight' | 'screenScale' | 'lang' | 'acceptLang' | 'timezone' | 'proxyId'>
>;
export type ProfileFilter = { search?: string; groupId?: string | null };
export type NewProxyRow = Pick<Proxy, 'protocol' | 'host' | 'port' | 'username' | 'passwordEncrypted'>;
export type ProxyRowPatch = Partial<NewProxyRow>;
export interface ProxyCheckRecord {
  ok: boolean;
  ip: string | null;
  country: string | null;
  timezone: string | null;
  error: string | null;
}

const MIGRATIONS = [
  `CREATE TABLE grp (id TEXT PRIMARY KEY, name TEXT NOT NULL);
   CREATE TABLE proxy (
     id TEXT PRIMARY KEY, protocol TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL,
     username TEXT, password_encrypted TEXT);
   CREATE TABLE profile (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, group_id TEXT, notes TEXT NOT NULL DEFAULT '',
     seed INTEGER NOT NULL, platform TEXT NOT NULL, platform_version TEXT, brand TEXT NOT NULL,
     hardware_concurrency INTEGER, lang TEXT NOT NULL, accept_lang TEXT NOT NULL, timezone TEXT NOT NULL,
     proxy_id TEXT, engine_version TEXT, created_at INTEGER NOT NULL, last_launched_at INTEGER);`,
  `ALTER TABLE proxy ADD COLUMN last_checked_at INTEGER;
   ALTER TABLE proxy ADD COLUMN last_status TEXT;
   ALTER TABLE proxy ADD COLUMN last_ip TEXT;
   ALTER TABLE proxy ADD COLUMN last_country TEXT;
   ALTER TABLE proxy ADD COLUMN last_timezone TEXT;
   ALTER TABLE proxy ADD COLUMN last_error TEXT;`,
  `CREATE TABLE extension (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE profile_extension (profile_id TEXT NOT NULL, extension_id TEXT NOT NULL, PRIMARY KEY (profile_id, extension_id));
   CREATE TABLE group_extension (group_id TEXT NOT NULL, extension_id TEXT NOT NULL, PRIMARY KEY (group_id, extension_id));`,
  `ALTER TABLE profile ADD COLUMN screen_width INTEGER;
   ALTER TABLE profile ADD COLUMN screen_height INTEGER;
   ALTER TABLE profile ADD COLUMN screen_scale REAL;
   ALTER TABLE profile ADD COLUMN fp_key TEXT;
   ALTER TABLE profile ADD COLUMN fp_snapshot TEXT;`,
];

const PROFILE_COLS: Record<keyof ProfilePatch, string> = {
  name: 'name', groupId: 'group_id', notes: 'notes', platform: 'platform',
  platformVersion: 'platform_version', brand: 'brand', hardwareConcurrency: 'hardware_concurrency',
  screenWidth: 'screen_width', screenHeight: 'screen_height', screenScale: 'screen_scale',
  lang: 'lang', acceptLang: 'accept_lang', timezone: 'timezone', proxyId: 'proxy_id',
};
const PROXY_COLS: Record<keyof NewProxyRow, string> = {
  protocol: 'protocol', host: 'host', port: 'port', username: 'username', passwordEncrypted: 'password_encrypted',
};

type Row = Record<string, string | number | null>;

function toProfile(r: Row): Profile {
  return {
    id: r.id as string, name: r.name as string, groupId: r.group_id as string | null, notes: r.notes as string,
    seed: r.seed as number, platform: r.platform as Profile['platform'],
    platformVersion: r.platform_version as string | null, brand: r.brand as string,
    hardwareConcurrency: r.hardware_concurrency as number | null,
    screenWidth: r.screen_width as number | null, screenHeight: r.screen_height as number | null,
    screenScale: r.screen_scale as number | null, lang: r.lang as string,
    acceptLang: r.accept_lang as string, timezone: r.timezone as string, proxyId: r.proxy_id as string | null,
    engineVersion: r.engine_version as string | null, createdAt: r.created_at as number,
    lastLaunchedAt: r.last_launched_at as number | null,
  };
}

function toExtension(r: Row): Extension {
  return {
    id: r.id as string, name: r.name as string, version: r.version as string,
    path: r.path as string, createdAt: r.created_at as number,
  };
}

function toProxy(r: Row): Proxy {
  return {
    id: r.id as string, protocol: r.protocol as Proxy['protocol'], host: r.host as string, port: r.port as number,
    username: r.username as string | null, passwordEncrypted: r.password_encrypted as string | null,
    lastCheckedAt: r.last_checked_at as number | null, lastStatus: r.last_status as Proxy['lastStatus'],
    lastIp: r.last_ip as string | null, lastCountry: r.last_country as string | null,
    lastTimezone: r.last_timezone as string | null, lastError: r.last_error as string | null,
  };
}

export class ProfileStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    const { user_version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (user_version > MIGRATIONS.length) {
      this.db.close();
      throw new Error('Cơ sở dữ liệu được tạo bởi bản ứng dụng mới hơn. Hãy cập nhật ứng dụng.');
    }
    for (let i = user_version; i < MIGRATIONS.length; i++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[i]);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
      });
    }
  }

  close(): void {
    this.db.close();
  }

  /** Chạy fn trong một transaction. Không được gọi lồng nhau. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // SQLite có thể đã tự rollback; không để lỗi ROLLBACK che lỗi gốc.
      }
      throw err;
    }
  }

  private patch(table: string, cols: Record<string, string>, id: string, patch: Record<string, unknown>): void {
    const keys = Object.keys(patch).filter((k) => Object.hasOwn(cols, k) && patch[k] !== undefined);
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${cols[k]} = ?`).join(', ');
    const values = keys.map((k) => patch[k] as string | number | null);
    this.db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...values, id);
  }

  createGroup(name: string): Group {
    const g = { id: randomUUID(), name };
    this.db.prepare('INSERT INTO grp (id, name) VALUES (?, ?)').run(g.id, g.name);
    return g;
  }

  listGroups(): Group[] {
    return (this.db.prepare('SELECT id, name FROM grp ORDER BY name').all() as Row[]).map((r) => ({
      id: r.id as string, name: r.name as string,
    }));
  }

  renameGroup(id: string, name: string): void {
    this.db.prepare('UPDATE grp SET name = ? WHERE id = ?').run(name, id);
  }

  deleteGroup(id: string): void {
    this.transaction(() => {
      this.db.prepare('UPDATE profile SET group_id = NULL WHERE group_id = ?').run(id);
      this.db.prepare('DELETE FROM group_extension WHERE group_id = ?').run(id);
      this.db.prepare('DELETE FROM grp WHERE id = ?').run(id);
    });
  }

  createProxy(input: NewProxyRow): Proxy {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO proxy (id, protocol, host, port, username, password_encrypted) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.protocol, input.host, input.port, input.username, input.passwordEncrypted);
    return this.getProxy(id)!;
  }

  getProxy(id: string): Proxy | null {
    const r = this.db.prepare('SELECT * FROM proxy WHERE id = ?').get(id) as Row | undefined;
    return r ? toProxy(r) : null;
  }

  listProxies(): Proxy[] {
    return (this.db.prepare('SELECT * FROM proxy ORDER BY host, port').all() as Row[]).map(toProxy);
  }

  updateProxy(id: string, patch: ProxyRowPatch): Proxy {
    this.patch('proxy', PROXY_COLS, id, patch);
    return this.getProxy(id)!;
  }

  saveProxyCheck(id: string, r: ProxyCheckRecord): void {
    this.db
      .prepare('UPDATE proxy SET last_checked_at = ?, last_status = ?, last_ip = ?, last_country = ?, last_timezone = ?, last_error = ? WHERE id = ?')
      .run(Date.now(), r.ok ? 'ok' : 'fail', r.ip, r.country, r.timezone, r.error, id);
  }

  clearProxyCheck(id: string): void {
    this.db
      .prepare('UPDATE proxy SET last_checked_at = NULL, last_status = NULL, last_ip = NULL, last_country = NULL, last_timezone = NULL, last_error = NULL WHERE id = ?')
      .run(id);
  }

  deleteProxy(id: string): void {
    this.transaction(() => {
      this.db.prepare('UPDATE profile SET proxy_id = NULL WHERE proxy_id = ?').run(id);
      this.db.prepare('DELETE FROM proxy WHERE id = ?').run(id);
    });
  }

  createProfile(input: NewProfile): Profile {
    const d = hostDefaults();
    const p: Profile = {
      id: randomUUID(), name: input.name, groupId: input.groupId ?? null, notes: input.notes ?? '',
      seed: randomSeed(), platform: input.platform ?? d.platform, platformVersion: input.platformVersion ?? null,
      brand: input.brand ?? 'Chrome', hardwareConcurrency: input.hardwareConcurrency ?? null,
      screenWidth: input.screenWidth ?? null, screenHeight: input.screenHeight ?? null, screenScale: input.screenScale ?? null,
      lang: input.lang ?? d.lang, acceptLang: input.acceptLang ?? d.acceptLang, timezone: input.timezone ?? d.timezone,
      proxyId: input.proxyId ?? null, engineVersion: null, createdAt: Date.now(), lastLaunchedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO profile (id, name, group_id, notes, seed, platform, platform_version, brand, hardware_concurrency,
           screen_width, screen_height, screen_scale, lang, accept_lang, timezone, proxy_id, engine_version, created_at, last_launched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.id, p.name, p.groupId, p.notes, p.seed, p.platform, p.platformVersion, p.brand, p.hardwareConcurrency,
        p.screenWidth, p.screenHeight, p.screenScale, p.lang, p.acceptLang, p.timezone, p.proxyId, p.engineVersion, p.createdAt, p.lastLaunchedAt);
    return p;
  }

  getProfile(id: string): Profile | null {
    const r = this.db.prepare('SELECT * FROM profile WHERE id = ?').get(id) as Row | undefined;
    return r ? toProfile(r) : null;
  }

  listProfiles(filter: ProfileFilter = {}): Profile[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.search) {
      where.push('name LIKE ?');
      params.push(`%${filter.search}%`);
    }
    if (filter.groupId === null) where.push('group_id IS NULL');
    else if (filter.groupId !== undefined) {
      where.push('group_id = ?');
      params.push(filter.groupId);
    }
    const sql = `SELECT * FROM profile ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, name`;
    return (this.db.prepare(sql).all(...params) as Row[]).map(toProfile);
  }

  updateProfile(id: string, patch: ProfilePatch): Profile {
    this.patch('profile', PROFILE_COLS, id, patch);
    return this.getProfile(id)!;
  }

  setSeed(id: string, seed: number): void {
    this.db.prepare('UPDATE profile SET seed = ?, fp_key = NULL, fp_snapshot = NULL WHERE id = ?').run(seed, id);
  }

  /** Kết quả đo vân tay đã lưu, kèm khoá tham số lúc đo (để biết còn đúng không). */
  getFingerprintSnapshots(): Record<string, { key: string; snapshot: FingerprintSnapshot }> {
    const rows = this.db.prepare('SELECT id, fp_key, fp_snapshot FROM profile WHERE fp_snapshot IS NOT NULL').all() as Row[];
    const out: Record<string, { key: string; snapshot: FingerprintSnapshot }> = {};
    for (const r of rows) {
      try {
        out[r.id as string] = { key: r.fp_key as string, snapshot: JSON.parse(r.fp_snapshot as string) };
      } catch {
        // bỏ qua dữ liệu hỏng
      }
    }
    return out;
  }

  saveFingerprintSnapshot(id: string, key: string, snapshot: FingerprintSnapshot): void {
    this.db.prepare('UPDATE profile SET fp_key = ?, fp_snapshot = ? WHERE id = ?').run(key, JSON.stringify(snapshot), id);
  }

  deleteProfile(id: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM profile_extension WHERE profile_id = ?').run(id);
      this.db.prepare('DELETE FROM profile WHERE id = ?').run(id);
    });
  }

  createExtension(input: { id: string; name: string; version: string; path: string }): Extension {
    this.db
      .prepare('INSERT INTO extension (id, name, version, path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(input.id, input.name, input.version, input.path, Date.now());
    return this.getExtension(input.id)!;
  }

  getExtension(id: string): Extension | null {
    const r = this.db.prepare('SELECT * FROM extension WHERE id = ?').get(id) as Row | undefined;
    return r ? toExtension(r) : null;
  }

  listExtensions(): Extension[] {
    return (this.db.prepare('SELECT * FROM extension ORDER BY created_at, rowid').all() as Row[]).map(toExtension);
  }

  deleteExtension(id: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM profile_extension WHERE extension_id = ?').run(id);
      this.db.prepare('DELETE FROM group_extension WHERE extension_id = ?').run(id);
      this.db.prepare('DELETE FROM extension WHERE id = ?').run(id);
    });
  }

  /** Thay toàn bộ extension gán riêng cho hồ sơ. Không tự mở transaction: người gọi bọc. */
  setProfileExtensions(profileId: string, extensionIds: string[]): void {
    this.db.prepare('DELETE FROM profile_extension WHERE profile_id = ?').run(profileId);
    const insert = this.db.prepare('INSERT INTO profile_extension (profile_id, extension_id) VALUES (?, ?)');
    for (const extId of extensionIds) insert.run(profileId, extId);
  }

  /** Thay toàn bộ extension gán cho nhóm. Không tự mở transaction: người gọi bọc. */
  setGroupExtensions(groupId: string, extensionIds: string[]): void {
    this.db.prepare('DELETE FROM group_extension WHERE group_id = ?').run(groupId);
    const insert = this.db.prepare('INSERT INTO group_extension (group_id, extension_id) VALUES (?, ?)');
    for (const extId of extensionIds) insert.run(groupId, extId);
  }

  private links(sql: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const r of this.db.prepare(sql).all() as Row[]) (out[r.owner as string] ??= []).push(r.extension_id as string);
    return out;
  }

  profileExtensionLinks(): Record<string, string[]> {
    return this.links('SELECT profile_id AS owner, extension_id FROM profile_extension ORDER BY rowid');
  }

  groupExtensionLinks(): Record<string, string[]> {
    return this.links('SELECT group_id AS owner, extension_id FROM group_extension ORDER BY rowid');
  }

  /** Extension gán riêng cho hồ sơ cộng với extension của nhóm nó, không trùng. */
  extensionsForProfile(profileId: string): Extension[] {
    const sql = `SELECT * FROM extension WHERE id IN (SELECT extension_id FROM profile_extension WHERE profile_id = ?)
      OR id IN (SELECT ge.extension_id FROM group_extension ge JOIN profile p ON p.group_id = ge.group_id WHERE p.id = ?)
      ORDER BY created_at, rowid`;
    return (this.db.prepare(sql).all(profileId, profileId) as Row[]).map(toExtension);
  }

  markLaunched(id: string, engineVersion: string): void {
    this.db.prepare('UPDATE profile SET engine_version = ?, last_launched_at = ? WHERE id = ?').run(engineVersion, Date.now(), id);
  }
}
