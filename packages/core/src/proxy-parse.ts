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

// Lý do lỗi không bao giờ chứa nội dung dòng: dòng có thể mang mật khẩu.
function parseLine(raw: string, defaultProtocol: ProxyProtocol): Omit<ParsedProxy, 'line'> {
  let rest = raw;
  let protocol = defaultProtocol;
  let hasScheme = false;
  const scheme = /^([a-z0-9+.-]+):\/\/(.*)$/i.exec(rest);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s === 'http') protocol = 'http';
    else if (s === 'socks5' || s === 'socks5h') protocol = 'socks5';
    else throw new Error('Giao thức chưa hỗ trợ');
    rest = scheme[2].replace(/\/+$/, '');
    hasScheme = true;
  }

  let username: string | null = null;
  let password: string | null = null;
  let hostPort: string;
  const at = rest.lastIndexOf('@');
  if (at >= 0) {
    const cred = rest.slice(0, at);
    hostPort = rest.slice(at + 1);
    const colon = cred.indexOf(':');
    username = colon >= 0 ? cred.slice(0, colon) : cred;
    password = colon >= 0 ? cred.slice(colon + 1) : null;
    if (hasScheme) {
      username = decode(username);
      if (password !== null) password = decode(password);
    }
  } else {
    const parts = rest.split(':');
    if (parts.length === 2) {
      hostPort = rest;
    } else if (parts.length >= 4) {
      hostPort = `${parts[0]}:${parts[1]}`;
      username = parts[2];
      password = parts.slice(3).join(':');
    } else {
      throw new Error('Sai định dạng');
    }
  }

  const hp = hostPort.split(':');
  if (hp.length !== 2 || hp[0] === '') throw new Error('Sai định dạng địa chỉ (IPv6 chưa hỗ trợ trong danh sách)');
  if (!/^\d+$/.test(hp[1])) throw new Error('Cổng không hợp lệ');
  const port = Number(hp[1]);
  if (port < 1 || port > 65535) throw new Error('Cổng không hợp lệ');
  if (username === '') throw new Error('Thiếu tài khoản');
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
      errors.push({ line: index + 1, reason: (err as Error).message });
    }
  });
  return { proxies, errors };
}
