import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
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

function connectVia(proxyPort: number, authority: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: authority });
    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('response', (res) => resolve(res.statusCode ?? 0));
    req.on('error', reject);
    req.end();
  });
}

/** Máy chủ SOCKS5 tối giản: ghi lại địa chỉ đích được yêu cầu rồi trả lỗi. */
async function fakeSocks5(): Promise<{ port: number; requests: { atyp: number; host: string }[]; close: () => Promise<void> }> {
  const requests: { atyp: number; host: string }[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.on('error', () => {});
    let buf = Buffer.alloc(0);
    let greeted = false;
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!greeted) {
        if (buf.length < 2 || buf.length < 2 + buf[1]) return;
        buf = buf.subarray(2 + buf[1]);
        greeted = true;
        s.write(Buffer.from([5, 0]));
      }
      if (buf.length < 5) return;
      const atyp = buf[3];
      let host = '';
      if (atyp === 3) {
        if (buf.length < 5 + buf[4] + 2) return;
        host = buf.subarray(5, 5 + buf[4]).toString();
      } else if (atyp === 1) {
        if (buf.length < 10) return;
        host = [...buf.subarray(4, 8)].join('.');
      } else host = 'ipv6';
      requests.push({ atyp, host });
      s.end(Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0]));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
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
    expect(upstreamUrl({ protocol: 'socks5', host: 'h', port: 1080, username: 'u@x', password: 'p:1' })).toBe('socks5h://u%40x:p%3A1@h:1080');
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

  it.each([
    ['http://', (port: number) => getVia(port, 'http://khong-duoc-tra-dns.invalid/')],
    ['https:// (CONNECT)', (port: number) => connectVia(port, 'khong-duoc-tra-dns.invalid:443')],
  ])('proxy SOCKS5: tên miền của trang %s được gửi nguyên cho proxy, máy không tự tra DNS', async (_label, request) => {
    const socks = await fakeSocks5();
    const bridge = await ProxyBridge.open({ protocol: 'socks5', host: '127.0.0.1', port: socks.port, username: null, password: null });
    await request(bridge.port).catch(() => {});
    expect(socks.requests).toEqual([{ atyp: 3, host: 'khong-duoc-tra-dns.invalid' }]);
    await bridge.close();
    await socks.close();
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
