import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as ProxyServer } from 'proxy-chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProxyBridge, assertReachable, upstreamUrl } from '../src/proxy-bridge';

let target: http.Server;
let targetPort: number;
let targetHits: number;
let upstream: ProxyServer;
let upstreamHits: number;

function getVia(proxyPort: number, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: url, headers: { Host: new URL(url).host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeEach(async () => {
  targetHits = 0;
  upstreamHits = 0;
  target = http.createServer((_req, res) => {
    targetHits++;
    res.end('hello');
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  targetPort = (target.address() as AddressInfo).port;
  upstream = new ProxyServer({
    port: 0,
    host: '127.0.0.1',
    prepareRequestFunction: ({ username, password }) => {
      upstreamHits++;
      return { requestAuthentication: username !== 'user' || password !== 'p@ss' };
    },
  });
  await upstream.listen();
});

afterEach(async () => {
  await upstream.close(true).catch(() => {});
  await new Promise<void>((r) => target.close(() => r()));
});

describe('ProxyBridge', () => {
  it('upstreamUrl mã hoá ký tự đặc biệt trong tài khoản', () => {
    expect(upstreamUrl({ protocol: 'socks5', host: 'h', port: 1080, username: 'u@x', password: 'p:1' })).toBe('socks5://u%40x:p%3A1@h:1080');
    expect(upstreamUrl({ protocol: 'http', host: 'h', port: 8080, username: null, password: null })).toBe('http://h:8080');
  });

  it('chuyển tiếp qua proxy có xác thực mà phía trình duyệt không cần mật khẩu', async () => {
    const bridge = await ProxyBridge.open({ protocol: 'http', host: '127.0.0.1', port: upstream.port, username: 'user', password: 'p@ss' });
    expect(bridge.url).toBe(`http://127.0.0.1:${bridge.port}`);
    const res = await getVia(bridge.port, `http://127.0.0.1:${targetPort}/`);
    expect(res).toEqual({ status: 200, body: 'hello' });
    expect(upstreamHits).toBe(1);
    await bridge.close();
  });

  it('proxy thật chết thì trả lỗi, không đi trực tiếp', async () => {
    const bridge = await ProxyBridge.open({ protocol: 'http', host: '127.0.0.1', port: upstream.port, username: 'user', password: 'p@ss' });
    await upstream.close(true);
    const res = await getVia(bridge.port, `http://127.0.0.1:${targetPort}/`);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(targetHits).toBe(0);
    await bridge.close();
  });

  it('assertReachable: resolve với cổng mở, reject với cổng đóng', async () => {
    await expect(assertReachable('127.0.0.1', targetPort)).resolves.toBeUndefined();
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    await expect(assertReachable('127.0.0.1', port, 1000)).rejects.toThrow();
  });
});
