export interface CookieParam {
  name: string;
  value: string;
  /** Có dấu chấm đầu: áp dụng cho cả tên miền con. Không có: chỉ đúng host đó. */
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  /** Giây kể từ epoch. Không có nghĩa là cookie phiên. */
  expires?: number;
}

export interface CookieParseResult {
  format: 'json' | 'netscape';
  cookies: CookieParam[];
  errors: { index: number; reason: string }[];
}

export interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: string;
}

export interface ExportedCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'no_restriction' | 'lax' | 'strict' | 'unspecified';
  hostOnly: boolean;
  session: boolean;
  expirationDate?: number;
}

export const MAX_COOKIES = 10_000;
const TOO_MANY = `Quá nhiều cookie (tối đa ${MAX_COOKIES})`;
const CONTROL = /[\u0000-\u001f\u007f]/;
const HOST_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Lỗi của riêng một cookie: thành một dòng trong errors, không làm hỏng cả lần phân tích. */
class Reject extends Error {}

interface RawCookie {
  name: unknown;
  value: unknown;
  domain: unknown;
  path: unknown;
  secure: boolean;
  httpOnly: boolean;
  sameSite: unknown;
  expires: unknown;
  hostOnly: boolean | undefined;
  session: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function cookieKey(c: { name: string; domain: string; path: string }): string {
  return `${c.name}\n${c.domain}\n${c.path}`;
}

function sameSiteOf(v: unknown): CookieParam['sameSite'] {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s === 'strict') return 'Strict';
  if (s === 'lax') return 'Lax';
  if (s === 'none' || s === 'no_restriction') return 'None';
  return undefined;
}

function expiresOf(raw: RawCookie, nowSec: number): number | undefined {
  if (raw.session || raw.expires === undefined || raw.expires === null || raw.expires === '') return undefined;
  let e = typeof raw.expires === 'string' ? Number(raw.expires) : raw.expires;
  if (typeof e !== 'number' || !Number.isFinite(e)) throw new Reject('Hạn cookie không hợp lệ');
  if (e > 1e11) e /= 1000; // một số công cụ ghi mili giây
  if (e <= 0) return undefined;
  if (e <= nowSec) throw new Reject('Cookie đã hết hạn');
  return Math.floor(e);
}

function build(raw: RawCookie, nowSec: number): CookieParam {
  const name = raw.name;
  if (typeof name !== 'string' || name === '' || CONTROL.test(name) || /[;=\s]/.test(name)) throw new Reject('Tên cookie không hợp lệ');
  const value = typeof raw.value === 'number' ? String(raw.value) : raw.value;
  if (typeof value !== 'string' || CONTROL.test(value) || value.includes(';')) throw new Reject('Giá trị cookie không hợp lệ');
  if (name.length + value.length > 4096) throw new Reject('Cookie quá dài (tối đa 4096 ký tự)');
  if (typeof raw.domain !== 'string') throw new Reject('Tên miền không hợp lệ');
  const lowered = raw.domain.trim().toLowerCase();
  const host = lowered.replace(/^\./, '');
  if (host.length > 253 || !HOST_RE.test(host)) throw new Reject('Tên miền không hợp lệ');
  const hostOnly = IPV4_RE.test(host) || (raw.hostOnly ?? !lowered.startsWith('.'));
  const path = raw.path === undefined || raw.path === null || raw.path === '' ? '/' : raw.path;
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > 1024 || CONTROL.test(path) || path.includes(';')) {
    throw new Reject('Đường dẫn cookie không hợp lệ');
  }
  const prefix = name.toLowerCase();
  if (prefix.startsWith('__secure-') && !raw.secure) throw new Reject('Cookie __Secure- phải có cờ Secure');
  if (prefix.startsWith('__host-') && (!raw.secure || path !== '/' || !hostOnly)) {
    throw new Reject('Cookie __Host- phải có Secure, đường dẫn / và không áp dụng cho tên miền con');
  }
  const expires = expiresOf(raw, nowSec);
  let sameSite = sameSiteOf(raw.sameSite);
  // Nhân nhận SameSite=None thiếu Secure nhưng không lưu cookie; bỏ thuộc tính để cookie vẫn vào được.
  if (sameSite === 'None' && !raw.secure) sameSite = undefined;
  return {
    name,
    value,
    domain: hostOnly ? host : `.${host}`,
    path,
    secure: raw.secure,
    httpOnly: raw.httpOnly,
    ...(sameSite ? { sameSite } : {}),
    ...(expires !== undefined ? { expires } : {}),
  };
}

function collect(format: CookieParseResult['format'], items: { index: number; make: () => RawCookie }[], nowSec: number): CookieParseResult {
  const byKey = new Map<string, CookieParam>();
  const errors: CookieParseResult['errors'] = [];
  for (const item of items) {
    try {
      const cookie = build(item.make(), nowSec);
      const key = cookieKey(cookie);
      byKey.delete(key); // mục sau thắng và giữ vị trí của nó
      byKey.set(key, cookie);
    } catch (err) {
      if (!(err instanceof Reject)) throw err;
      errors.push({ index: item.index, reason: err.message });
    }
  }
  if (byKey.size > MAX_COOKIES) throw new Error(TOO_MANY);
  return { format, cookies: [...byKey.values()], errors };
}

function parseJson(text: string, nowSec: number): CookieParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON cookie không hợp lệ');
  }
  const list = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.cookies) ? data.cookies : null;
  if (!list) throw new Error('JSON cookie phải là một mảng cookie');
  if (list.length > MAX_COOKIES) throw new Error(TOO_MANY);
  return collect(
    'json',
    list.map((item: unknown, i: number) => ({
      index: i + 1,
      make: (): RawCookie => {
        if (!isRecord(item)) throw new Reject('Mục không phải là một cookie');
        return {
          name: item.name,
          value: item.value,
          domain: item.domain,
          path: item.path,
          secure: item.secure === true,
          httpOnly: item.httpOnly === true,
          sameSite: item.sameSite,
          expires: item.expirationDate ?? item.expires,
          hostOnly: typeof item.hostOnly === 'boolean' ? item.hostOnly : undefined,
          session: item.session === true,
        };
      },
    })),
    nowSec,
  );
}

function parseNetscape(text: string, nowSec: number): CookieParseResult {
  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_COOKIES * 2) throw new Error(TOO_MANY);
  const items: { index: number; make: () => RawCookie }[] = [];
  lines.forEach((rawLine, i) => {
    let line = rawLine;
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (line.trim() === '' || line.startsWith('#')) {
      return;
    }
    items.push({
      index: i + 1,
      make: (): RawCookie => {
        const f = line.split('\t');
        if (f.length !== 7) throw new Reject('Sai định dạng: cần 7 cột cách nhau bằng tab');
        const domain = f[0].trim();
        const subdomains = f[1].trim().toUpperCase() === 'TRUE' || domain.startsWith('.');
        return {
          name: f[5],
          value: f[6],
          domain,
          path: f[2],
          secure: f[3].trim().toUpperCase() === 'TRUE',
          httpOnly,
          sameSite: undefined,
          expires: f[4].trim(),
          hostOnly: !subdomains,
          session: false,
        };
      },
    });
  });
  return collect('netscape', items, nowSec);
}

export function parseCookies(text: string, nowSec: number = Date.now() / 1000): CookieParseResult {
  const body = text.replace(/^\uFEFF/, '');
  const trimmed = body.trim();
  if (trimmed === '') throw new Error('Chưa có nội dung cookie');
  return trimmed.startsWith('[') || trimmed.startsWith('{') ? parseJson(trimmed, nowSec) : parseNetscape(body, nowSec);
}

export function toExportCookies(cookies: CdpCookie[]): ExportedCookie[] {
  return cookies.map((c) => {
    const s = (c.sameSite ?? '').toLowerCase();
    const sameSite: ExportedCookie['sameSite'] = s === 'none' ? 'no_restriction' : s === 'lax' ? 'lax' : s === 'strict' ? 'strict' : 'unspecified';
    return {
      domain: c.domain,
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite,
      hostOnly: !c.domain.startsWith('.'),
      session: c.session,
      ...(c.session ? {} : { expirationDate: c.expires }),
    };
  });
}
