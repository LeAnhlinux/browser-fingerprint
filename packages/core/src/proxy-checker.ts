import http from 'node:http';
import net from 'node:net';
import { ProxyBridge, type Upstream } from './proxy-bridge';

export const DEFAULT_LOOKUP_URL = 'http://ip-api.com/json/?fields=status,message,query,countryCode,timezone';

export interface ProxyCheckResult {
  ok: boolean;
  ip: string | null;
  country: string | null;
  timezone: string | null;
  error: string | null;
  ms: number;
}

export interface CheckOptions {
  lookupUrl?: string;
  timeoutMs?: number;
}

const MAX_BODY = 16 * 1024;
const TIMEOUT = 'Hết thời gian chờ';
const UNREADABLE = 'Dịch vụ tra IP trả dữ liệu không đọc được';
const OVERSIZE = Symbol('oversize');

function validTimezone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function validCountry(c: unknown): string | null {
  return typeof c === 'string' && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : null;
}

function getViaProxy(proxyPort: number, url: string, signal: AbortSignal): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: url, headers: { Host: new URL(url).host } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (body.length + chunk.length > MAX_BODY) {
          reject(OVERSIZE);
          req.destroy();
          return;
        }
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      res.on('error', reject);
    });
    const abort = () => req.destroy();
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    req.on('error', reject);
    req.end();
  });
}

function fail(error: string, started: number): ProxyCheckResult {
  return { ok: false, ip: null, country: null, timezone: null, error, ms: Date.now() - started };
}

/** Gửi đúng một request HTTP qua proxy tới dịch vụ tra IP. Không bao giờ reject. `timeoutMs` là hạn chót cho cả lần kiểm tra. */
export async function checkProxy(upstream: Upstream, opts: CheckOptions = {}): Promise<ProxyCheckResult> {
  const started = Date.now();
  const lookupUrl = opts.lookupUrl ?? DEFAULT_LOOKUP_URL;
  let parsed: URL | null = null;
  try {
    parsed = new URL(lookupUrl);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== 'http:') return fail('Địa chỉ tra IP phải dùng http://', started);
  if (parsed.username || parsed.password) return fail('Địa chỉ tra IP không được chứa tài khoản', started);

  const ctl = new AbortController();
  let bridge: ProxyBridge | null = null;
  let timer: NodeJS.Timeout | undefined;

  const run = async (): Promise<ProxyCheckResult> => {
    const opened = await ProxyBridge.open(upstream);
    if (ctl.signal.aborted) {
      await opened.close().catch(() => {});
      throw new Error(TIMEOUT);
    }
    bridge = opened;
    const res = await getViaProxy(opened.port, lookupUrl, ctl.signal);
    if (res.status === 407) return fail('Proxy từ chối tài khoản hoặc mật khẩu', started);
    if (res.status < 200 || res.status >= 300) return fail(`Proxy hoặc dịch vụ tra IP trả mã ${res.status}`, started);
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      return fail(UNREADABLE, started);
    }
    if (typeof json !== 'object' || json === null) return fail(UNREADABLE, started);
    if (typeof json.status === 'string' && json.status !== 'success') {
      const detail = typeof json.message === 'string' ? json.message : json.status;
      return fail(`Dịch vụ tra IP báo lỗi: ${detail.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120)}`, started);
    }
    const ip = typeof json.query === 'string' ? json.query : typeof json.ip === 'string' ? json.ip : null;
    if (!ip || net.isIP(ip) === 0) return fail('Dịch vụ tra IP không trả địa chỉ IP', started);
    const country = validCountry(json.countryCode ?? json.country);
    return { ok: true, ip, country, timezone: validTimezone(json.timezone), error: null, ms: Date.now() - started };
  };

  const work = run();
  work.catch(() => {});
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new Error(TIMEOUT));
    }, opts.timeoutMs ?? 10_000);
  });

  try {
    return await Promise.race([work, deadline]);
  } catch (err) {
    if (err === OVERSIZE) return fail(UNREADABLE, started);
    return fail((err as Error).message === TIMEOUT ? TIMEOUT : 'Không kết nối được qua proxy', started);
  } finally {
    clearTimeout(timer);
    ctl.abort();
    await (bridge as ProxyBridge | null)?.close().catch(() => {});
  }
}
