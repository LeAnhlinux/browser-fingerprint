import { describe, expect, it } from 'vitest';
import { CdpError, openCdp } from '../src/cdp';

class FakeWs extends EventTarget {
  static last: FakeWs;
  sent: { id: number; method: string; params: unknown }[] = [];
  closed = false;
  constructor(public url: string) {
    super();
    FakeWs.last = this;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }
  open(): void {
    this.dispatchEvent(new Event('open'));
  }
  reply(msg: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) }));
  }
}
const Impl = FakeWs as unknown as new (url: string) => WebSocket;

async function connected(timeoutMs = 200) {
  const pending = openCdp('ws://x', { WebSocketImpl: Impl, timeoutMs });
  const ws = FakeWs.last;
  ws.open();
  return { cdp: await pending, ws };
}

describe('openCdp', () => {
  it('gửi lệnh có id tăng dần và trả đúng kết quả theo id', async () => {
    const { cdp, ws } = await connected();
    const a = cdp.call<{ v: number }>('A.one', { x: 1 });
    const b = cdp.call<{ v: number }>('B.two');
    expect(ws.sent).toEqual([
      { id: 1, method: 'A.one', params: { x: 1 } },
      { id: 2, method: 'B.two', params: {} },
    ]);
    ws.reply({ id: 2, result: { v: 2 } });
    ws.reply({ id: 1, result: { v: 1 } });
    expect(await a).toEqual({ v: 1 });
    expect(await b).toEqual({ v: 2 });
  });

  it('lỗi do nhân trả về là CdpError có protocol = true', async () => {
    const { cdp, ws } = await connected();
    const p = cdp.call('Storage.setCookies');
    ws.reply({ id: 1, error: { code: -32602, message: 'Invalid cookie fields' } });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CdpError);
    expect((err as CdpError).protocol).toBe(true);
    expect((err as CdpError).message).toBe('Invalid cookie fields');
  });

  it('lệnh không được trả lời thì hết thời gian, protocol = false', async () => {
    const { cdp } = await connected(30);
    const err = await cdp.call('X.slow').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CdpError);
    expect((err as CdpError).protocol).toBe(false);
    expect((err as CdpError).message).toContain('X.slow');
  });

  it('mất kết nối làm mọi lệnh đang chờ thất bại', async () => {
    const { cdp, ws } = await connected();
    const p = cdp.call('X.wait');
    ws.dispatchEvent(new Event('close'));
    await expect(p).rejects.toThrow('Mất kết nối CDP');
    await expect(cdp.call('X.after')).rejects.toThrow('Mất kết nối CDP');
  });

  it('không mở được kết nối thì từ chối, kể cả khi treo', async () => {
    const failing = openCdp('ws://x', { WebSocketImpl: Impl, timeoutMs: 200 });
    FakeWs.last.dispatchEvent(new Event('error'));
    await expect(failing).rejects.toThrow('Không kết nối được CDP');
    const hanging = openCdp('ws://x', { WebSocketImpl: Impl, timeoutMs: 30 });
    const ws = FakeWs.last;
    await expect(hanging).rejects.toThrow('Hết thời gian kết nối CDP');
    expect(ws.closed).toBe(true);
  });

  it('bỏ qua tin không phải JSON và sự kiện không có id', async () => {
    const { cdp, ws } = await connected();
    const p = cdp.call<{ ok: boolean }>('A.one');
    ws.dispatchEvent(new MessageEvent('message', { data: 'không phải json' }));
    ws.reply({ method: 'Target.targetCreated', params: {} });
    ws.reply({ id: 1, result: { ok: true } });
    expect(await p).toEqual({ ok: true });
  });

  it('close đóng socket', async () => {
    const { cdp, ws } = await connected();
    cdp.close();
    expect(ws.closed).toBe(true);
  });
});
