import type { CookieImportResult, CoreInfo, Group, ProfileInput, ProfileUpdate, ProfileView, ProxyView, RunInfo } from '@bf/core';
import { DEFAULT_PORT, defaultDataDir, readToken, tokenPath } from './token';

export class ApiError extends Error {
  constructor(
    message: string,
    /** Mã HTTP; 0 khi không kết nối được tới app hoặc không đọc được token. */
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  /** Chuỗi token, hoặc hàm trả token (được gọi lại ở mỗi request). */
  token: string | (() => string);
  port?: number;
}

const NOT_RUNNING = 'Không kết nối được tới app. Hãy mở Browser Fingerprint trước (API chỉ chạy khi app đang mở).';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class ApiClient {
  private base: string;
  private token: string | (() => string);

  constructor(opts: ApiClientOptions) {
    this.base = `http://127.0.0.1:${opts.port ?? DEFAULT_PORT}/v1`;
    this.token = opts.token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let token: string;
    try {
      token = typeof this.token === 'function' ? this.token() : this.token;
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : 'Không đọc được token của API', 0);
    }
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(NOT_RUNNING, 0);
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) throw new ApiError(isRecord(data) && typeof data.error === 'string' ? data.error : `Lỗi HTTP ${res.status}`, res.status);
    return data as T;
  }

  private profile(id: string): string {
    return `/profiles/${encodeURIComponent(id)}`;
  }

  info(): Promise<CoreInfo & { apiVersion: number }> {
    return this.request('GET', '/info');
  }

  listProfiles(filter: { search?: string; groupId?: string | null } = {}): Promise<ProfileView[]> {
    const query = new URLSearchParams();
    if (filter.search) query.set('search', filter.search);
    if (filter.groupId !== undefined) query.set('groupId', filter.groupId === null ? 'none' : filter.groupId);
    const qs = query.toString();
    return this.request('GET', `/profiles${qs ? `?${qs}` : ''}`);
  }

  getProfile(id: string): Promise<ProfileView> {
    return this.request('GET', this.profile(id));
  }

  createProfile(input: ProfileInput): Promise<ProfileView> {
    return this.request('POST', '/profiles', input);
  }

  updateProfile(id: string, patch: ProfileUpdate): Promise<ProfileView> {
    return this.request('PATCH', this.profile(id), patch);
  }

  deleteProfile(id: string): Promise<{ ok: true }> {
    return this.request('DELETE', this.profile(id));
  }

  startProfile(id: string, opts: { headless?: boolean } = {}): Promise<RunInfo> {
    return this.request('POST', `${this.profile(id)}/start`, opts.headless === undefined ? undefined : { headless: opts.headless });
  }

  stopProfile(id: string): Promise<{ ok: true }> {
    return this.request('POST', `${this.profile(id)}/stop`);
  }

  exportCookies(id: string): Promise<{ count: number; cookies: unknown[] }> {
    return this.request('GET', `${this.profile(id)}/cookies`);
  }

  importCookies(id: string, text: string): Promise<CookieImportResult> {
    return this.request('POST', `${this.profile(id)}/cookies`, { text });
  }

  listGroups(): Promise<Group[]> {
    return this.request('GET', '/groups');
  }

  listProxies(): Promise<ProxyView[]> {
    return this.request('GET', '/proxies');
  }

  checkProxy(id: string): Promise<ProxyView> {
    return this.request('POST', `/proxies/${encodeURIComponent(id)}/check`);
  }
}

/** Máy khách cho CLI và MCP: cổng và file token lấy từ biến môi trường, không thì dùng mặc định của app. */
export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): ApiClient {
  const raw = env.BF_API_PORT;
  const port = raw === undefined || raw === '' ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('BF_API_PORT không hợp lệ');
  const file = env.BF_API_TOKEN_FILE || tokenPath(defaultDataDir());
  return new ApiClient({ port, token: () => readToken(file) });
}
