export type Platform = 'macos' | 'windows' | 'linux';
export type ProxyProtocol = 'http' | 'socks5';

export interface Profile {
  id: string;
  name: string;
  groupId: string | null;
  notes: string;
  seed: number;
  platform: Platform;
  platformVersion: string | null;
  brand: string;
  hardwareConcurrency: number | null;
  lang: string;
  acceptLang: string;
  timezone: string;
  proxyId: string | null;
  engineVersion: string | null;
  createdAt: number;
  lastLaunchedAt: number | null;
}

export interface Group {
  id: string;
  name: string;
}

export interface Proxy {
  id: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  passwordEncrypted: string | null;
}

export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}
