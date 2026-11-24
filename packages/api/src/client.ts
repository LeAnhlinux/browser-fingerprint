import type { CookieImportResult, CoreInfo, Group, ProfileInput, ProfileUpdate, ProfileView, ProxyView, RunInfo, SolveResult } from '@bf/core';
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
  /** Thời gian chờ tối đa cho một request, tính bằng mili giây. Mặc định 120 giây. */
  timeoutMs?: number;
}

const REQUEST_TIMEOUT_MS = 120_000;
/** Bằng thời gian giải mặc định của lõi (chỉ import kiểu từ @bf/core để CLI không kéo theo cả lõi). */
const SOLVE_TIMEOUT_DEFAULT_MS = 120_000;
const TIMED_OUT = 'App không trả lời kịp thời gian';
const BAD_REPLY = 'Máy chủ API trả lời không hợp lệ';
const NOT_RUNNING = 'Không kết nối được tới app. Hãy mở Browser Fingerprint trước (API chỉ chạy khi app đang mở).';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class ApiClient {
  private base: string;
  private token: string | (() => string);
  private timeoutMs: number;

  constructor(opts: ApiClientOptions) {
    this.base = `http://127.0.0.1:${opts.port ?? DEFAULT_PORT}/v1`;
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    let token: string;
    try {
      token = typeof this.token === 'function' ? this.token() : this.token;
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : 'Không đọc được token của API', 0);
    }
    // Token chỉ gửi tới đúng địa chỉ này: không theo chuyển hướng, không chờ vô hạn.
    const signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        redirect: 'error',
        signal,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (signal.aborted) throw new ApiError(TIMED_OUT, 0);
      const cause = isRecord(err) && isRecord(err.cause) ? err.cause : undefined;
      if (typeof cause?.message === 'string' && cause.message.includes('redirect')) throw new ApiError(BAD_REPLY, 0);
      throw new ApiError(NOT_RUNNING, 0);
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (signal.aborted) throw new ApiError(TIMED_OUT, 0);
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

  captchaBalance(): Promise<{ balance: number }> {
    return this.request('GET', '/captcha/balance');
  }

  /** Giải captcha qua CapMonster bằng key lưu trong app; task theo định dạng API CapMonster. */
  solveCaptcha(task: unknown, timeoutMs?: number): Promise<SolveResult> {
    // Chờ dư hơn thời gian giải để app (luôn dừng trong timeoutMs) kịp trả lỗi hết giờ của chính nó.
    const wait = Math.max(this.timeoutMs, (timeoutMs ?? SOLVE_TIMEOUT_DEFAULT_MS) + 30_000);
    return this.request('POST', '/captcha/solve', timeoutMs === undefined ? { task } : { task, timeoutMs }, wait);
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
