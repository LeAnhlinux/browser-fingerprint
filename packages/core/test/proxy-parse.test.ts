import { describe, expect, it } from 'vitest';
import { parseProxyList } from '../src/proxy-parse';

describe('parseProxyList', () => {
  it('nhận bốn định dạng', () => {
    const r = parseProxyList(
      ['socks5://u1:p1@1.1.1.1:1080', 'u2:p2@2.2.2.2:8080', '3.3.3.3:3128:u3:p3', 'proxy.example.com:8000'].join('\n'),
    );
    expect(r.errors).toEqual([]);
    expect(r.proxies).toEqual([
      { line: 1, protocol: 'socks5', host: '1.1.1.1', port: 1080, username: 'u1', password: 'p1' },
      { line: 2, protocol: 'http', host: '2.2.2.2', port: 8080, username: 'u2', password: 'p2' },
      { line: 3, protocol: 'http', host: '3.3.3.3', port: 3128, username: 'u3', password: 'p3' },
      { line: 4, protocol: 'http', host: 'proxy.example.com', port: 8000, username: null, password: null },
    ]);
  });

  it('dùng giao thức mặc định khi dòng không ghi', () => {
    expect(parseProxyList('1.1.1.1:1080', 'socks5').proxies[0].protocol).toBe('socks5');
  });

  it('socks5h được coi là socks5; http ghi hoa vẫn nhận', () => {
    const r = parseProxyList('socks5h://1.1.1.1:1\nHTTP://2.2.2.2:2');
    expect(r.proxies.map((p) => p.protocol)).toEqual(['socks5', 'http']);
  });

  it('bỏ qua dòng trống, dòng chú thích và khoảng trắng thừa; số dòng vẫn tính theo văn bản gốc', () => {
    const r = parseProxyList('\n# chú thích\n   1.1.1.1:80  \r\n\n2.2.2.2:81');
    expect(r.proxies.map((p) => [p.line, p.host])).toEqual([
      [3, '1.1.1.1'],
      [5, '2.2.2.2'],
    ]);
  });

  it('mật khẩu chứa dấu hai chấm và @', () => {
    expect(parseProxyList('1.1.1.1:80:user:pa:ss').proxies[0].password).toBe('pa:ss');
    expect(parseProxyList('user:p@ss@1.1.1.1:80').proxies[0]).toMatchObject({ username: 'user', password: 'p@ss', host: '1.1.1.1' });
  });

  it('giải mã phần tài khoản dạng URL khi có giao thức', () => {
    expect(parseProxyList('http://us%40er:p%3Ass@1.1.1.1:80').proxies[0]).toMatchObject({ username: 'us@er', password: 'p:ss' });
  });

  it('báo lỗi theo dòng và không lộ nội dung dòng', () => {
    const r = parseProxyList(['ftp://1.1.1.1:21', 'khong-co-cong', '1.1.1.1:99999', '1.1.1.1:80:chiuser', ':pw@1.1.1.1:80', '1.1.1.1:80'].join('\n'));
    expect(r.proxies.map((p) => p.line)).toEqual([6]);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 4, 5]);
    expect(r.errors[0].reason).toBe('Giao thức chưa hỗ trợ');
    expect(r.errors[2].reason).toBe('Cổng không hợp lệ');
    for (const e of r.errors) {
      expect(e.reason).not.toMatch(/1\.1\.1\.1|chiuser|pw/);
    }
  });

  it('văn bản rỗng cho kết quả rỗng', () => {
    expect(parseProxyList('  \n ')).toEqual({ proxies: [], errors: [] });
  });

  const AMBIGUOUS = 'Dòng có thể hiểu theo hai cách, hãy ghi dạng giao_thức://user:pass@host:port';

  it('định dạng host:port:user:pass giữ nguyên @ trong tài khoản và mật khẩu', () => {
    expect(parseProxyList('1.1.1.1:80:me@x.com:pw').proxies[0]).toMatchObject({
      host: '1.1.1.1', port: 80, username: 'me@x.com', password: 'pw',
    });
    expect(parseProxyList('1.1.1.1:80:user:pa@ss').proxies[0]).toMatchObject({
      host: '1.1.1.1', port: 80, username: 'user', password: 'pa@ss',
    });
  });

  it('dạng user:pass@host:port với tài khoản chứa @', () => {
    expect(parseProxyList('me@x.com:pw@1.1.1.1:80').proxies[0]).toMatchObject({
      host: '1.1.1.1', port: 80, username: 'me@x.com', password: 'pw',
    });
  });

  it('dòng hiểu được theo hai cách bị từ chối, không đoán', () => {
    const r = parseProxyList('1.1.1.1:80:me@x.com:1234\nuser:1234:x@host:80');
    expect(r.proxies).toEqual([]);
    expect(r.errors).toEqual([
      { line: 1, reason: AMBIGUOUS },
      { line: 2, reason: AMBIGUOUS },
    ]);
  });

  it('kiểm tra cổng', () => {
    expect(parseProxyList('h:0').errors).toHaveLength(1);
    expect(parseProxyList('h:65536').errors).toHaveLength(1);
    expect(parseProxyList('h:00080').proxies[0].port).toBe(80);
  });

  it('mật khẩu rỗng thành null', () => {
    expect(parseProxyList('u:@1.1.1.1:80').proxies[0]).toMatchObject({ username: 'u', password: null });
    expect(parseProxyList('1.1.1.1:80:u:').proxies[0]).toMatchObject({ username: 'u', password: null });
  });

  it('dạng URL và địa chỉ không hợp lệ', () => {
    expect(parseProxyList('http://u:p@1.1.1.1:80/').proxies[0]).toMatchObject({ host: '1.1.1.1', port: 80, username: 'u', password: 'p' });
    expect(parseProxyList('http://1.1.1.1:80/path').errors).toHaveLength(1);
    expect(parseProxyList('[::1]:80').errors).toHaveLength(1);
    expect(parseProxyList('my host:80').errors).toHaveLength(1);
    expect(parseProxyList('a/b:80').errors).toHaveLength(1);
  });

  it('không lý do lỗi nào chứa host, tài khoản hay mật khẩu của đầu vào', () => {
    const lines = [
      'ftp://secrethost:21',
      'secrethost:80:secretuser',
      'secrethost:99999',
      ':secretpw@secrethost:80',
      '1.1.1.1:80:secret@user.com:1234',
      'secretuser:1234:x@secrethost:80',
      'secretuser:secretpw@my secrethost:80',
      'http://secretuser:secretpw@secrethost:80/path',
      '[::1]:80:secretuser:secretpw',
    ];
    const r = parseProxyList(lines.join('\n'));
    expect(r.proxies).toEqual([]);
    expect(r.errors).toHaveLength(lines.length);
    for (const e of r.errors) {
      expect(e.reason).not.toMatch(/secret|1\.1\.1\.1|user\.com|::1/);
    }
  });
});
