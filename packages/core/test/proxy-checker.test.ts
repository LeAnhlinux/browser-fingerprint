import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as ProxyServer } from 'proxy-chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkProxy } from '../src/proxy-checker';

let lookup: http.Server;
let lookupUrl: string;
let body: string;
let status: number;
let upstream: ProxyServer;

beforeEach(async () => {
  body = JSON.stringify({ status: 'success', query: '203.0.113.7', countryCode: 'US', timezone: 'America/Chicago' });
  status = 200;
  lookup = http.createServer((_req, res) => {
    res.statusCode = status;
    res.end(body);
  });
  await new Promise<void>((r) => lookup.listen(0, '127.0.0.1', r));
  lookupUrl = `http://127.0.0.1:${(lookup.address() as AddressInfo).port}/json`;
  upstream = new ProxyServer({
    port: 0,
    host: '127.0.0.1',
    prepareRequestFunction: ({ username, password }) => ({ requestAuthentication: username !== 'user' || password !== 'pass' }),
  });
  await upstream.listen();
});

afterEach(async () => {
  await upstream.close(true).catch(() => {});
  lookup.closeAllConnections();
  await new Promise<void>((r) => lookup.close(() => r()));
});

const good = () => ({ protocol: 'http' as const, host: '127.0.0.1', port: upstream.port, username: 'user', password: 'pass' });

describe('checkProxy', () => {
  it('proxy sống: trả IP, quốc gia, múi giờ', async () => {
    const r = await checkProxy(good(), { lookupUrl });
    expect(r).toMatchObject({ ok: true, ip: '203.0.113.7', country: 'US', timezone: 'America/Chicago', error: null });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('nhận cả tên trường ip/country thay cho query/countryCode', async () => {
    body = JSON.stringify({ ip: '198.51.100.9', country: 'DE', timezone: 'Europe/Berlin' });
    expect(await checkProxy(good(), { lookupUrl })).toMatchObject({ ok: true, ip: '198.51.100.9', country: 'DE', timezone: 'Europe/Berlin' });
  });

  it('sai mật khẩu thì báo lỗi, không ném', async () => {
    const r = await checkProxy({ ...good(), password: 'sai' }, { lookupUrl });
    expect(r.ok).toBe(false);
    expect(r.ip).toBeNull();
    expect(r.error).toBeTruthy();
    expect(r.error).not.toContain('sai');
  });

  it('proxy chết thì báo lỗi', async () => {
    await upstream.close(true);
    const r = await checkProxy(good(), { lookupUrl, timeoutMs: 3000 });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('dịch vụ tra IP trả status khác success thì báo lỗi kèm message', async () => {
    body = JSON.stringify({ status: 'fail', message: 'reserved range' });
    const r = await checkProxy(good(), { lookupUrl });
    expect(r).toMatchObject({ ok: false, error: 'Dịch vụ tra IP báo lỗi: reserved range' });
  });

  it('phản hồi không phải JSON thì báo lỗi', async () => {
    body = '<html>';
    expect(await checkProxy(good(), { lookupUrl })).toMatchObject({ ok: false, error: 'Dịch vụ tra IP trả dữ liệu không đọc được' });
  });

  it('múi giờ không hợp lệ thì bỏ múi giờ nhưng vẫn ok', async () => {
    body = JSON.stringify({ status: 'success', query: '203.0.113.7', countryCode: 'US', timezone: 'Sao/Hoa' });
    expect(await checkProxy(good(), { lookupUrl })).toMatchObject({ ok: true, ip: '203.0.113.7', timezone: null });
  });

  it('từ chối địa chỉ tra IP không phải http', async () => {
    expect(await checkProxy(good(), { lookupUrl: 'https://example.test/json' })).toMatchObject({
      ok: false,
      error: 'Địa chỉ tra IP phải dùng http://',
    });
  });

  it('hết thời gian chờ thì báo lỗi', async () => {
    lookup.removeAllListeners('request');
    lookup.on('request', () => {});
    const r = await checkProxy(good(), { lookupUrl, timeoutMs: 300 });
    expect(r).toMatchObject({ ok: false, error: 'Hết thời gian chờ' });
  });
  it('thông báo lỗi của dịch vụ tra IP bị làm sạch và cắt ngắn', async () => {
    const prefix = 'Dịch vụ tra IP báo lỗi: ';
    body = JSON.stringify({ status: 'fail', message: `a\nb\u0000c\u007fd${'x'.repeat(5000)}` });
    const r = await checkProxy(good(), { lookupUrl });
    expect(r.ok).toBe(false);
    expect(r.error!.startsWith(prefix)).toBe(true);
    expect(r.error).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(r.error!.length).toBeLessThanOrEqual(prefix.length + 120);
    body = JSON.stringify({ status: 'fail', message: { a: 1 } });
    expect((await checkProxy(good(), { lookupUrl })).error).toBe('Dịch vụ tra IP báo lỗi: fail');
  });

  it('phản hồi quá lớn thì báo lỗi nhanh', async () => {
    body = JSON.stringify({ status: 'success', query: '203.0.113.7', pad: 'y'.repeat(200_000) });
    const t = Date.now();
    const r = await checkProxy(good(), { lookupUrl });
    expect(r).toMatchObject({ ok: false, error: 'Dịch vụ tra IP trả dữ liệu không đọc được' });
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('IP phải hợp lệ; IPv6 được chấp nhận', async () => {
    for (const q of ['not-an-ip', '1'.repeat(10_000)]) {
      body = JSON.stringify({ status: 'success', query: q, countryCode: 'US' });
      expect(await checkProxy(good(), { lookupUrl })).toMatchObject({ ok: false, error: 'Dịch vụ tra IP không trả địa chỉ IP' });
    }
    body = JSON.stringify({ status: 'success', query: '2001:db8::1', countryCode: 'US' });
    expect(await checkProxy(good(), { lookupUrl })).toMatchObject({ ok: true, ip: '2001:db8::1' });
  });

  it('mã quốc gia không hợp lệ thì bỏ, hợp lệ thì viết hoa', async () => {
    for (const c of ['USA', 'U$', 'A'.repeat(5000)]) {
      body = JSON.stringify({ status: 'success', query: '203.0.113.7', countryCode: c });
      expect(await checkProxy(good(), { lookupUrl })).toMatchObject({ ok: true, country: null });
    }
    body = JSON.stringify({ status: 'success', query: '203.0.113.7', countryCode: 'us' });
    expect(await checkProxy(good(), { lookupUrl })).toMatchObject({ ok: true, country: 'US' });
    body = JSON.stringify({ status: 'success', query: '203.0.113.7', country: 'de' });
    expect(await checkProxy(good(), { lookupUrl })).toMatchObject({ ok: true, country: 'DE' });
  });

  it('proxy nhỏ giọt từng byte vẫn bị cắt bởi hạn chót tổng', async () => {
    let closed = false;
    let timer: NodeJS.Timeout | undefined;
    lookup.removeAllListeners('request');
    lookup.on('request', (_req, res) => {
      res.on('close', () => {
        closed = true;
        clearInterval(timer);
      });
      res.writeHead(200);
      res.write('{');
      timer = setInterval(() => res.write(' '), 50);
    });
    const t = Date.now();
    const r = await checkProxy(good(), { lookupUrl, timeoutMs: 400 });
    expect(r).toMatchObject({ ok: false, error: 'Hết thời gian chờ' });
    expect(Date.now() - t).toBeLessThan(2000);
    await new Promise((r2) => setTimeout(r2, 200));
    expect(closed).toBe(true);
  });

  it('chuẩn hoá múi giờ và từ chối giá trị lạ', async () => {
    body = JSON.stringify({ status: 'success', query: '203.0.113.7', timezone: 'america/chicago' });
    expect(await checkProxy(good(), { lookupUrl })).toMatchObject({ ok: true, timezone: 'America/Chicago' });
    for (const tz of ['+01:00', 'America/Chi cago', '--flag=1', 'A'.repeat(65)]) {
      body = JSON.stringify({ status: 'success', query: '203.0.113.7', timezone: tz });
      expect(await checkProxy(good(), { lookupUrl })).toMatchObject({ ok: true, timezone: null });
    }
  });

  it('từ chối địa chỉ tra IP có tài khoản, không gửi request', async () => {
    let hits = 0;
    lookup.removeAllListeners('request');
    lookup.on('request', () => hits++);
    const r = await checkProxy(good(), { lookupUrl: lookupUrl.replace('http://', 'http://user:pw@') });
    expect(r).toMatchObject({ ok: false, error: 'Địa chỉ tra IP không được chứa tài khoản' });
    expect(hits).toBe(0);
  });

  it('không đi theo chuyển hướng 302', async () => {
    let redirectHits = 0;
    const target = http.createServer((_q, res) => {
      redirectHits++;
      res.end('{}');
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}/x`;
    lookup.removeAllListeners('request');
    lookup.on('request', (_q, res) => {
      res.writeHead(302, { Location: targetUrl });
      res.end();
    });
    const r = await checkProxy(good(), { lookupUrl });
    expect(r).toMatchObject({ ok: false, error: 'Proxy hoặc dịch vụ tra IP trả mã 302' });
    target.closeAllConnections();
    await new Promise<void>((r2) => target.close(() => r2()));
    expect(redirectHits).toBe(0);
  });
});
