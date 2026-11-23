import type { ProxyProtocol } from './types';

export interface ParsedProxy {
  line: number;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

export interface ProxyParseError {
  line: number;
  reason: string;
}

export interface ProxyParseResult {
  proxies: ParsedProxy[];
  errors: ProxyParseError[];
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Chỉ lỗi thuộc lớp này mới được đưa lý do ra ngoài; lý do luôn là chuỗi cố định,
// không bao giờ chứa nội dung dòng (dòng có thể mang mật khẩu).
class ProxyLineError extends Error {}

const AMBIGUOUS = 'Dòng có thể hiểu theo hai cách, hãy ghi dạng giao_thức://user:pass@host:port';
const ADDRESS_ERROR = 'Sai định dạng địa chỉ (IPv6 chưa hỗ trợ trong danh sách)';
const HOST = /^[^\s/[\]@:]+$/;
const DIGITS = /^\d+$/;

function splitCredentials(cred: string): { username: string; password: string | null } {
  const colon = cred.indexOf(':');
  return colon >= 0
    ? { username: cred.slice(0, colon), password: cred.slice(colon + 1) }
    : { username: cred, password: null };
}

function isHostPort(value: string): boolean {
  const hp = value.split(':');
  return hp.length === 2 && HOST.test(hp[0]) && DIGITS.test(hp[1]);
}

function parseLine(raw: string, defaultProtocol: ProxyProtocol): Omit<ParsedProxy, 'line'> {
  let rest = raw;
  let protocol = defaultProtocol;
  let hasScheme = false;
  const scheme = /^([a-z0-9+.-]+):\/\/(.*)$/i.exec(rest);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s === 'http') protocol = 'http';
    else if (s === 'socks5' || s === 'socks5h') protocol = 'socks5';
    else throw new ProxyLineError('Giao thức chưa hỗ trợ');
    rest = scheme[2].replace(/\/+$/, '');
    hasScheme = true;
  }

  let username: string | null = null;
  let password: string | null = null;
  let hostPort: string;
  const at = rest.lastIndexOf('@');
  const parts = rest.split(':');
  // Không có giao thức: quyết định theo cách đọc nào hợp lệ về cấu trúc.
  const colonValid = !hasScheme && parts.length >= 4 && HOST.test(parts[0]) && DIGITS.test(parts[1]);
  const atValid = !hasScheme && at >= 0 && isHostPort(rest.slice(at + 1));
  if (colonValid && atValid) throw new ProxyLineError(AMBIGUOUS);

  if (colonValid || (hasScheme && at < 0 && parts.length >= 4)) {
    hostPort = `${parts[0]}:${parts[1]}`;
    username = parts[2];
    password = parts.slice(3).join(':');
  } else if (at >= 0) {
    hostPort = rest.slice(at + 1);
    ({ username, password } = splitCredentials(rest.slice(0, at)));
    if (hasScheme) {
      username = decode(username);
      if (password !== null) password = decode(password);
    }
  } else if (parts.length === 2) {
    hostPort = rest;
  } else {
    throw new ProxyLineError('Sai định dạng');
  }

  const hp = hostPort.split(':');
  if (hp.length !== 2 || !HOST.test(hp[0])) throw new ProxyLineError(ADDRESS_ERROR);
  if (!DIGITS.test(hp[1])) throw new ProxyLineError('Cổng không hợp lệ');
  const port = Number(hp[1]);
  if (port < 1 || port > 65535) throw new ProxyLineError('Cổng không hợp lệ');
  if (username === '') throw new ProxyLineError('Thiếu tài khoản');
  if (password === '') password = null;
  return { protocol, host: hp[0], port, username, password };
}

export function parseProxyList(text: string, defaultProtocol: ProxyProtocol = 'http'): ProxyParseResult {
  const proxies: ParsedProxy[] = [];
  const errors: ProxyParseError[] = [];
  text.split('\n').forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) return;
    try {
      proxies.push({ line: index + 1, ...parseLine(line, defaultProtocol) });
    } catch (err) {
      errors.push({ line: index + 1, reason: err instanceof ProxyLineError ? err.message : 'Sai định dạng' });
    }
  });
  return { proxies, errors };
}
