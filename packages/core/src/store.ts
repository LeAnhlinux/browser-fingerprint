import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hostDefaults, randomSeed } from './fingerprint';
import type { Group, Profile, Proxy } from './types';

export type NewProfile = { name: string } & Partial<
  Pick<Profile, 'groupId' | 'notes' | 'platform' | 'platformVersion' | 'brand' | 'hardwareConcurrency' | 'lang' | 'acceptLang' | 'timezone' | 'proxyId'>
>;
export type ProfilePatch = Partial<
  Pick<Profile, 'name' | 'groupId' | 'notes' | 'platform' | 'platformVersion' | 'brand' | 'hardwareConcurrency' | 'lang' | 'acceptLang' | 'timezone' | 'proxyId'>
>;
export type ProfileFilter = { search?: string; groupId?: string | null };

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
];

const PROFILE_COLS: Record<keyof ProfilePatch, string> = {
  name: 'name', groupId: 'group_id', notes: 'notes', platform: 'platform',
  platformVersion: 'platform_version', brand: 'brand', hardwareConcurrency: 'hardware_concurrency',
  lang: 'lang', acceptLang: 'accept_lang', timezone: 'timezone', proxyId: 'proxy_id',
};
const PROXY_COLS: Record<keyof Omit<Proxy, 'id'>, string> = {
  protocol: 'protocol', host: 'host', port: 'port', username: 'username', passwordEncrypted: 'password_encrypted',
};

type Row = Record<string, string | number | null>;

function toProfile(r: Row): Profile {
  return {
    id: r.id as string, name: r.name as string, groupId: r.group_id as string | null, notes: r.notes as string,
    seed: r.seed as number, platform: r.platform as Profile['platform'],
    platformVersion: r.platform_version as string | null, brand: r.brand as string,
    hardwareConcurrency: r.hardware_concurrency as number | null, lang: r.lang as string,
    acceptLang: r.accept_lang as string, timezone: r.timezone as string, proxyId: r.proxy_id as string | null,
    engineVersion: r.engine_version as string | null, createdAt: r.created_at as number,
    lastLaunchedAt: r.last_launched_at as number | null,
  };
}

function toProxy(r: Row): Proxy {
  return {
    id: r.id as string, protocol: r.protocol as Proxy['protocol'], host: r.host as string, port: r.port as number,
    username: r.username as string | null, passwordEncrypted: r.password_encrypted as string | null,
  };
}

export class ProfileStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    const { user_version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
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
      this.db.exec('ROLLBACK');
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
      this.db.prepare('DELETE FROM grp WHERE id = ?').run(id);
    });
  }

  createProxy(input: Omit<Proxy, 'id'>): Proxy {
    const x: Proxy = { id: randomUUID(), ...input };
    this.db
      .prepare('INSERT INTO proxy (id, protocol, host, port, username, password_encrypted) VALUES (?, ?, ?, ?, ?, ?)')
      .run(x.id, x.protocol, x.host, x.port, x.username, x.passwordEncrypted);
    return x;
  }

  getProxy(id: string): Proxy | null {
    const r = this.db.prepare('SELECT * FROM proxy WHERE id = ?').get(id) as Row | undefined;
    return r ? toProxy(r) : null;
  }

  listProxies(): Proxy[] {
    return (this.db.prepare('SELECT * FROM proxy ORDER BY host, port').all() as Row[]).map(toProxy);
  }

  updateProxy(id: string, patch: Partial<Omit<Proxy, 'id'>>): Proxy {
    this.patch('proxy', PROXY_COLS, id, patch);
    return this.getProxy(id)!;
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
      lang: input.lang ?? d.lang, acceptLang: input.acceptLang ?? d.acceptLang, timezone: input.timezone ?? d.timezone,
      proxyId: input.proxyId ?? null, engineVersion: null, createdAt: Date.now(), lastLaunchedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO profile (id, name, group_id, notes, seed, platform, platform_version, brand, hardware_concurrency,
           lang, accept_lang, timezone, proxy_id, engine_version, created_at, last_launched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.id, p.name, p.groupId, p.notes, p.seed, p.platform, p.platformVersion, p.brand, p.hardwareConcurrency,
        p.lang, p.acceptLang, p.timezone, p.proxyId, p.engineVersion, p.createdAt, p.lastLaunchedAt);
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

  deleteProfile(id: string): void {
    this.db.prepare('DELETE FROM profile WHERE id = ?').run(id);
  }

  markLaunched(id: string, engineVersion: string): void {
    this.db.prepare('UPDATE profile SET engine_version = ?, last_launched_at = ? WHERE id = ?').run(engineVersion, Date.now(), id);
  }
}
