import http from 'node:http';
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

function validTimezone(tz: unknown): string | null {
  if (typeof tz !== 'string' || tz === '') return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

function getViaProxy(proxyPort: number, url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: url, headers: { Host: new URL(url).host } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (body.length < 65536) body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Hết thời gian chờ')));
    req.on('error', reject);
    req.end();
  });
}

function fail(error: string, started: number): ProxyCheckResult {
  return { ok: false, ip: null, country: null, timezone: null, error, ms: Date.now() - started };
}

/** Gửi đúng một request HTTP qua proxy tới dịch vụ tra IP. Không bao giờ reject. */
export async function checkProxy(upstream: Upstream, opts: CheckOptions = {}): Promise<ProxyCheckResult> {
  const started = Date.now();
  const lookupUrl = opts.lookupUrl ?? DEFAULT_LOOKUP_URL;
  let protocol = '';
  try {
    protocol = new URL(lookupUrl).protocol;
  } catch {
    protocol = '';
  }
  if (protocol !== 'http:') return fail('Địa chỉ tra IP phải dùng http://', started);

  let bridge: ProxyBridge | null = null;
  try {
    bridge = await ProxyBridge.open(upstream);
    const res = await getViaProxy(bridge.port, lookupUrl, opts.timeoutMs ?? 10_000);
    if (res.status === 407) return fail('Proxy từ chối tài khoản hoặc mật khẩu', started);
    if (res.status < 200 || res.status >= 300) return fail(`Proxy hoặc dịch vụ tra IP trả mã ${res.status}`, started);
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      return fail('Dịch vụ tra IP trả dữ liệu không đọc được', started);
    }
    if (typeof json !== 'object' || json === null) return fail('Dịch vụ tra IP trả dữ liệu không đọc được', started);
    if (typeof json.status === 'string' && json.status !== 'success') {
      return fail(`Dịch vụ tra IP báo lỗi: ${typeof json.message === 'string' ? json.message : json.status}`, started);
    }
    const ip = typeof json.query === 'string' ? json.query : typeof json.ip === 'string' ? json.ip : null;
    if (!ip) return fail('Dịch vụ tra IP không trả địa chỉ IP', started);
    const country = typeof json.countryCode === 'string' ? json.countryCode : typeof json.country === 'string' ? json.country : null;
    return { ok: true, ip, country, timezone: validTimezone(json.timezone), error: null, ms: Date.now() - started };
  } catch (err) {
    const message = (err as Error).message;
    return fail(message === 'Hết thời gian chờ' ? message : 'Không kết nối được qua proxy', started);
  } finally {
    await bridge?.close().catch(() => {});
  }
}
