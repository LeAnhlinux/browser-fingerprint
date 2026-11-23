import { type IncomingHttpHeaders, request } from 'node:http';
import type { ProfileView, ProxyView, RunInfo } from '@bf/core';
import type { ApiCore } from '../src/server';

export const TOKEN = 'a'.repeat(64);
export const COOKIE_SECRET = 'GIA-TRI-COOKIE-BI-MAT';

export type FakeCore = ApiCore & { calls: unknown[][]; lastCookieText: string };

const proxy = (): ProxyView =>
  ({ id: 'x1', protocol: 'http', host: 'proxy.example', port: 8080, username: 'u', hasPassword: true, lastCheckedAt: null, lastStatus: null, lastIp: null, lastCountry: null, lastTimezone: null, lastError: null }) as ProxyView;

/** Lõi giả trong bộ nhớ, đủ hành vi để kiểm máy chủ, máy khách, CLI và MCP mà không cần nhân. */
export function fakeCore(): FakeCore {
  const profiles = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const notFound = (): never => {
    throw new Error('Không tìm thấy hồ sơ');
  };
  const get = (id: string): Record<string, unknown> => profiles.get(id) ?? notFound();
  const view = (p: Record<string, unknown>): ProfileView => ({ ...p }) as unknown as ProfileView;
  const core: FakeCore = {
    calls: [],
    lastCookieText: '',
    info: () => ({ engineInstalled: true, engineVersion: '1.2.3', hostPlatform: 'macos' }),
    listProfiles: (filter = {}) =>
      [...profiles.values()]
        .filter((p) => !filter.search || String(p.name).includes(filter.search))
        .filter((p) => filter.groupId === undefined || p.groupId === filter.groupId)
        .map(view),
    getProfile: (id) => view(get(id)),
    createProfile: (input) => {
      core.calls.push(['createProfile', input]);
      if (input.name === 'boom') throw new TypeError('chi tiết lỗi lập trình bí mật');
      if (!input.name) throw new Error('Tên hồ sơ không được để trống');
      const id = `p${++seq}`;
      profiles.set(id, { id, groupId: null, proxyId: null, notes: '', extensionIds: [], run: null, ...input });
      return view(get(id));
    },
    updateProfile: (id, patch) => {
      core.calls.push(['updateProfile', id, patch]);
      Object.assign(get(id), patch);
      return view(get(id));
    },
    deleteProfile: (id) => {
      core.calls.push(['deleteProfile', id]);
      if (get(id).run) throw new Error('Hãy dừng hồ sơ trước khi xoá');
      profiles.delete(id);
    },
    launch: async (id, opts) => {
      core.calls.push(['launch', id, opts]);
      const run: RunInfo = { profileId: id, pid: 4242, cdpPort: 9333, cdpUrl: 'ws://127.0.0.1:9333/devtools/browser/abc', startedAt: 1, headless: opts?.headless === true };
      get(id).run = run;
      return run;
    },
    stop: async (id) => {
      core.calls.push(['stop', id]);
      const p = profiles.get(id);
      if (p) p.run = null;
    },
    importCookies: async (id, text) => {
      core.calls.push(['importCookies', id]);
      get(id);
      core.lastCookieText = text;
      return { format: 'json', imported: 1, failed: 0, sessionSkipped: 0, errors: [] };
    },
    exportCookies: async (id) => {
      core.calls.push(['exportCookies', id]);
      get(id);
      return { count: 1, json: JSON.stringify([{ domain: '.a.com', name: 'sid', value: COOKIE_SECRET, path: '/' }]) };
    },
    listGroups: () => [{ id: 'g1', name: 'airdrop' }],
    listProxies: () => [proxy()],
    checkProxy: async (id) => {
      core.calls.push(['checkProxy', id]);
      if (id !== 'x1') throw new Error('Không tìm thấy proxy');
      return { ...proxy(), lastStatus: 'ok', lastIp: '1.2.3.4', lastCountry: 'US', lastTimezone: 'America/Chicago', lastCheckedAt: 1 } as ProxyView;
    },
  };
  return core;
}

export interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: Record<string, unknown> & unknown[];
}

/** Gọi HTTP thô bằng node:http để đặt được cả header Host và Origin (fetch không cho đặt). */
export function http(
  port: number,
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {},
): Promise<HttpResult> {
  const payload = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  const token = opts.token === undefined ? TOKEN : opts.token;
  const headers: Record<string, string> = {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    ...opts.headers,
  };
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: json as HttpResult['json'] });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
