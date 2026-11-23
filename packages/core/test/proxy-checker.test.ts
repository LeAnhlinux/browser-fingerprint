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
});
