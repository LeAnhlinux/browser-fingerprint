import { describe, expect, it } from 'vitest';
import { type CdpCookie, cookieKey, parseCookies, toExportCookies } from '../src/cookie-parse';

const NOW = 1_800_000_000;
const FUTURE = NOW + 86_400;

describe('parseCookies: JSON', () => {
  it('đọc mảng kiểu extension cookie và chuẩn hoá tên miền', () => {
    const text = JSON.stringify([
      { domain: '.Example.com', name: 'sid', value: 'abc', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: FUTURE + 0.5, hostOnly: false },
      { domain: 'www.example.com', name: 'pref', value: 'x y', hostOnly: true, session: true },
    ]);
    const r = parseCookies(text, NOW);
    expect(r.format).toBe('json');
    expect(r.errors).toEqual([]);
    expect(r.cookies).toEqual([
      { name: 'sid', value: 'abc', domain: '.example.com', path: '/', secure: true, httpOnly: true, sameSite: 'None', expires: FUTURE },
      { name: 'pref', value: 'x y', domain: 'www.example.com', path: '/', secure: false, httpOnly: false },
    ]);
  });

  it('nhận đối tượng có trường cookies, trường expires, và hạn tính bằng mili giây', () => {
    const r = parseCookies(JSON.stringify({ cookies: [{ domain: '.a.com', name: 'n', value: 1, expires: FUTURE * 1000, sameSite: 'Lax' }] }), NOW);
    expect(r.cookies).toEqual([{ name: 'n', value: '1', domain: '.a.com', path: '/', secure: false, httpOnly: false, sameSite: 'Lax', expires: FUTURE }]);
  });

  it('không có hostOnly thì suy từ dấu chấm đầu; địa chỉ IP luôn là host-only', () => {
    const r = parseCookies(JSON.stringify([
      { domain: 'a.com', name: 'h', value: '1', expirationDate: FUTURE },
      { domain: '.a.com', name: 'd', value: '1', expirationDate: FUTURE },
      { domain: '.10.0.0.1', name: 'ip', value: '1', hostOnly: false, expirationDate: FUTURE },
    ]), NOW);
    expect(r.cookies.map((c) => c.domain)).toEqual(['a.com', '.a.com', '10.0.0.1']);
  });

  it('hạn bằng 0, âm hoặc thiếu là cookie phiên; session = true thắng hạn', () => {
    const r = parseCookies(JSON.stringify([
      { domain: '.a.com', name: 'a', value: '1', expirationDate: 0 },
      { domain: '.a.com', name: 'b', value: '1', expires: -1 },
      { domain: '.a.com', name: 'c', value: '1' },
      { domain: '.a.com', name: 'd', value: '1', expirationDate: FUTURE, session: true },
    ]), NOW);
    expect(r.errors).toEqual([]);
    expect(r.cookies.every((c) => c.expires === undefined)).toBe(true);
  });

  it('SameSite=None không có Secure thì bỏ SameSite để cookie không bị rơi im lặng', () => {
    const r = parseCookies(JSON.stringify([{ domain: '.a.com', name: 'a', value: '1', sameSite: 'None', secure: false, expirationDate: FUTURE }]), NOW);
    expect(r.cookies[0].sameSite).toBeUndefined();
  });

  it('báo lỗi theo số thứ tự mục, không lộ giá trị cookie', () => {
    const secret = 'GIA-TRI-BI-MAT';
    const r = parseCookies(JSON.stringify([
      { domain: '.a.com', name: 'ok', value: '1', expirationDate: FUTURE },
      { domain: '.a.com', name: 'old', value: secret, expirationDate: NOW - 10 },
      { domain: 'bad domain', name: 'x', value: secret },
      { domain: '.a.com', name: '', value: secret },
      { domain: '.a.com', name: 'v', value: `${secret};x` },
      { domain: '.a.com', name: 'p', value: secret, path: 'khong-co-gach' },
      { domain: '.a.com', name: '__Secure-s', value: secret, secure: false },
      { domain: '.a.com', name: '__Host-h', value: secret, secure: true, path: '/' },
      'không phải đối tượng',
      { domain: '.a.com', name: 'e', value: secret, expirationDate: 'abc' },
    ]), NOW);
    expect(r.cookies.map((c) => c.name)).toEqual(['ok']);
    expect(r.errors.map((e) => e.index)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.errors[0].reason).toBe('Cookie đã hết hạn');
    expect(r.errors[1].reason).toBe('Tên miền không hợp lệ');
    expect(JSON.stringify(r.errors)).not.toContain(secret);
  });

  it('cookie __Host- hợp lệ được nhận', () => {
    const r = parseCookies(JSON.stringify([{ domain: 'a.com', name: '__Host-h', value: '1', secure: true, path: '/', expirationDate: FUTURE }]), NOW);
    expect(r.errors).toEqual([]);
    expect(r.cookies[0].domain).toBe('a.com');
  });

  it('cookie trùng tên, tên miền, đường dẫn: mục sau thắng', () => {
    const r = parseCookies(JSON.stringify([
      { domain: '.a.com', name: 'k', value: 'cũ', expirationDate: FUTURE },
      { domain: '.a.com', name: 'k', value: 'mới', expirationDate: FUTURE },
    ]), NOW);
    expect(r.cookies).toHaveLength(1);
    expect(r.cookies[0].value).toBe('mới');
  });

  it('ném lỗi khi JSON hỏng, không phải mảng, rỗng hoặc quá nhiều cookie', () => {
    expect(() => parseCookies('[{', NOW)).toThrow('JSON cookie không hợp lệ');
    expect(() => parseCookies('{"a":1}', NOW)).toThrow('JSON cookie phải là một mảng cookie');
    expect(() => parseCookies('   ', NOW)).toThrow('Chưa có nội dung cookie');
    const many = JSON.stringify(Array.from({ length: 10_001 }, (_, i) => ({ domain: '.a.com', name: `n${i}`, value: '1' })));
    expect(() => parseCookies(many, NOW)).toThrow('Quá nhiều cookie (tối đa 10000)');
  });

  it('bỏ BOM ở đầu nội dung', () => {
    const r = parseCookies(`﻿[{"domain":".a.com","name":"a","value":"1"}]`, NOW);
    expect(r.cookies).toHaveLength(1);
  });
});

describe('parseCookies: Netscape', () => {
  it('đọc 7 cột cách nhau bằng tab, kể cả dòng #HttpOnly_ và giá trị rỗng', () => {
    const text = [
      '# Netscape HTTP Cookie File',
      '',
      `.example.com\tTRUE\t/\tTRUE\t${FUTURE}\tsid\tabc`,
      `#HttpOnly_www.example.com\tFALSE\t/app\tFALSE\t${FUTURE}\ttok\txyz`,
      `example.org\tFALSE\t/\tFALSE\t0\tsess\t`,
    ].join('\n');
    const r = parseCookies(text, NOW);
    expect(r.format).toBe('netscape');
    expect(r.errors).toEqual([]);
    expect(r.cookies).toEqual([
      { name: 'sid', value: 'abc', domain: '.example.com', path: '/', secure: true, httpOnly: false, expires: FUTURE },
      { name: 'tok', value: 'xyz', domain: 'www.example.com', path: '/app', secure: false, httpOnly: true, expires: FUTURE },
      { name: 'sess', value: '', domain: 'example.org', path: '/', secure: false, httpOnly: false },
    ]);
  });

  it('cờ tên miền con TRUE thì thêm dấu chấm đầu; nhận xuống dòng kiểu Windows', () => {
    const r = parseCookies(`a.com\tTRUE\t/\tFALSE\t${FUTURE}\tn\tv\r\n`, NOW);
    expect(r.cookies[0].domain).toBe('.a.com');
    expect(r.cookies[0].value).toBe('v');
  });

  it('báo lỗi theo số dòng', () => {
    const text = [`.a.com\tTRUE\t/\tFALSE\t${FUTURE}\tok\t1`, 'dòng này không đủ cột', `.a.com\tTRUE\t/\tFALSE\t${NOW - 5}\told\t1`].join('\n');
    const r = parseCookies(text, NOW);
    expect(r.cookies.map((c) => c.name)).toEqual(['ok']);
    expect(r.errors).toEqual([
      { index: 2, reason: 'Sai định dạng: cần 7 cột cách nhau bằng tab' },
      { index: 3, reason: 'Cookie đã hết hạn' },
    ]);
  });
});

describe('toExportCookies', () => {
  const stored: CdpCookie[] = [
    { name: 'sid', value: 'abc', domain: '.example.com', path: '/', expires: FUTURE + 0.25, httpOnly: true, secure: true, session: false, sameSite: 'None' },
    { name: 'pref', value: '1', domain: 'www.example.com', path: '/', expires: -1, httpOnly: false, secure: false, session: true },
  ];

  it('xuất theo kiểu extension cookie', () => {
    expect(toExportCookies(stored)).toEqual([
      { domain: '.example.com', name: 'sid', value: 'abc', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction', hostOnly: false, session: false, expirationDate: FUTURE + 0.25 },
      { domain: 'www.example.com', name: 'pref', value: '1', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified', hostOnly: true, session: true },
    ]);
  });

  it('xuất rồi nhập lại cho đúng cookie ban đầu', () => {
    const r = parseCookies(JSON.stringify(toExportCookies(stored)), NOW);
    expect(r.errors).toEqual([]);
    expect(r.cookies.map(cookieKey)).toEqual(stored.map(cookieKey));
    expect(r.cookies[0]).toMatchObject({ sameSite: 'None', secure: true, httpOnly: true, expires: FUTURE });
    expect(r.cookies[1].expires).toBeUndefined();
  });
});
