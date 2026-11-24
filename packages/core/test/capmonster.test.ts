import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCapMonsterKey, checkSolveTimeout, downloadCapMonsterZip, getBalance, isCapMonsterExtension, solveTask } from '../src/capmonster';

type Call = { url: string; body: Record<string, unknown> };

/** fetch giả trả lần lượt các phản hồi JSON đã định. */
function fakeApi(replies: unknown[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const noSleep = { sleep: async () => {}, pollMs: 1 };

describe('API CapMonster', () => {
  it('lấy số dư bằng clientKey', async () => {
    const { fetchImpl, calls } = fakeApi([{ errorId: 0, balance: 12.5 }]);
    expect(await getBalance('KEY12345', { fetchImpl })).toBe(12.5);
    expect(calls[0]).toEqual({ url: 'https://api.capmonster.cloud/getBalance', body: { clientKey: 'KEY12345' } });
  });

  it('dịch mã lỗi quen thuộc sang tiếng Việt, không lộ key', async () => {
    const { fetchImpl } = fakeApi([{ errorId: 1, errorCode: 'ERROR_KEY_DOES_NOT_EXIST' }]);
    await expect(getBalance('KEY12345', { fetchImpl })).rejects.toThrow('API key CapMonster không đúng');
    const other = fakeApi([{ errorId: 1, errorCode: 'ERROR_SOMETHING', errorDescription: 'mô tả' }]);
    const err = await getBalance('KEY12345', { fetchImpl: other.fetchImpl }).catch((e: Error) => e);
    expect((err as Error).message).toBe('CapMonster báo lỗi ERROR_SOMETHING: mô tả');
    expect((err as Error).message).not.toContain('KEY12345');
  });

  it('lỗi mạng thành thông báo dễ hiểu', async () => {
    const { fetchImpl } = fakeApi([new TypeError('fetch failed')]);
    const err = await getBalance('KEY12345', { fetchImpl }).catch((e: Error) => e);
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as Error).message).toBe('Không kết nối được tới CapMonster');
  });

  it('tạo task rồi hỏi tới khi xong', async () => {
    const task = { type: 'TurnstileTask', websiteURL: 'https://a.example', websiteKey: 'k' };
    const { fetchImpl, calls } = fakeApi([
      { errorId: 0, taskId: 77 },
      { errorId: 0, status: 'processing' },
      { errorId: 0, status: 'ready', solution: { token: 'T' }, cost: 0.0013 },
    ]);
    const r = await solveTask('KEY12345', task, 60_000, { fetchImpl, ...noSleep });
    expect(r).toEqual({ taskId: 77, solution: { token: 'T' }, cost: 0.0013 });
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['createTask', 'getTaskResult', 'getTaskResult']);
    expect(calls[0].body).toEqual({ clientKey: 'KEY12345', task });
    expect(calls[1].body).toEqual({ clientKey: 'KEY12345', taskId: 77 });
  });

  it('hết giờ thì dừng hỏi', async () => {
    let t = 0;
    const { fetchImpl, calls } = fakeApi([{ errorId: 0, taskId: 1 }, ...Array(50).fill({ errorId: 0, status: 'processing' })]);
    const p = solveTask('KEY12345', { type: 'X' }, 10_000, { fetchImpl, pollMs: 3000, sleep: async (ms) => void (t += ms), now: () => t });
    await expect(p).rejects.toThrow('chưa giải xong sau 10 giây');
    expect(calls.length).toBeLessThan(6);
  });

  it('mỗi lần gọi bị giới hạn bởi thời gian còn lại; lỗi do hết giờ báo là hết giờ', async () => {
    let t = 0;
    const timeouts: number[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      timeouts.push(t);
      if (url.endsWith('createTask')) return new Response(JSON.stringify({ errorId: 0, taskId: 1 }));
      // getTaskResult treo tới khi bị huỷ do hết giờ.
      t += 20_000;
      void init;
      throw new Error('aborted');
    }) as unknown as typeof fetch;
    const p = solveTask('KEY12345', { type: 'X' }, 15_000, { fetchImpl, pollMs: 1000, sleep: async (ms) => void (t += ms), now: () => t });
    await expect(p).rejects.toThrow('chưa giải xong sau 15 giây');
  });

  it('kiểm tra task và thời gian chờ trước khi gọi', async () => {
    const { fetchImpl, calls } = fakeApi([]);
    await expect(solveTask('KEY12345', { websiteURL: 'x' }, 60_000, { fetchImpl })).rejects.toThrow('trường "type"');
    await expect(solveTask('KEY12345', 'chuỗi', 60_000, { fetchImpl })).rejects.toThrow('trường "type"');
    expect(calls).toHaveLength(0);
    expect(checkSolveTimeout(undefined)).toBe(120_000);
    expect(() => checkSolveTimeout(5000)).toThrow('10 đến 280 giây');
    expect(() => checkSolveTimeout(300_000)).toThrow('10 đến 280 giây');
  });
});

function fakeExtension(name = 'CapMonster Cloud', settings: unknown = { isEnabled: true, clientKey: '', captchaList: ['ReCaptcha2'] }): string {
  const dir = mkdtempSync(join(tmpdir(), 'bf-cm-'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name, version: '1.0' }));
  writeFileSync(join(dir, 'defaultSettings.json'), JSON.stringify(settings));
  return dir;
}

describe('extension CapMonster', () => {
  it('nhận theo tên và file cài đặt mặc định', async () => {
    expect(await isCapMonsterExtension(fakeExtension(), 'CapMonster Cloud — automated captcha solver')).toBe(true);
    expect(await isCapMonsterExtension(fakeExtension(), 'Khác')).toBe(false);
    expect(await isCapMonsterExtension(fakeExtension('x', { foo: 1 }), 'CapMonster')).toBe(false);
  });

  it('ghi key vào defaultSettings.json, giữ các thiết lập khác', async () => {
    const dir = fakeExtension();
    await applyCapMonsterKey(dir, 'KEY12345');
    const saved = JSON.parse(readFileSync(join(dir, 'defaultSettings.json'), 'utf8'));
    expect(saved).toEqual({ isEnabled: true, clientKey: 'KEY12345', captchaList: ['ReCaptcha2'] });
    await applyCapMonsterKey(dir, '');
    expect(JSON.parse(readFileSync(join(dir, 'defaultSettings.json'), 'utf8')).clientKey).toBe('');
  });
});

describe('tải gói extension', () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

  it('đi theo trang Google Drive sang đường tải thẳng', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url.startsWith('https://zenno.link/')) {
        const r = new Response('<html>Drive</html>', { status: 200 });
        Object.defineProperty(r, 'url', { value: 'https://drive.google.com/file/d/AbCdEfGhIjKl_123/view?usp=drive_link' });
        return r;
      }
      return new Response(zip, { status: 200 });
    }) as unknown as typeof fetch;
    const dest = join(mkdtempSync(join(tmpdir(), 'bf-cmz-')), 'a.zip');
    await downloadCapMonsterZip(dest, { fetchImpl });
    expect(urls[1]).toBe('https://drive.usercontent.google.com/download?id=AbCdEfGhIjKl_123&export=download');
    expect(readFileSync(dest)).toEqual(zip);
  });

  it('không phải zip thì báo cách tải tay', async () => {
    const fetchImpl = (async () => new Response('<html>khác</html>', { status: 200 })) as unknown as typeof fetch;
    const dest = join(mkdtempSync(join(tmpdir(), 'bf-cmz-')), 'a.zip');
    await expect(downloadCapMonsterZip(dest, { fetchImpl })).rejects.toThrow('Thêm file .crx/.zip');
  });
});
