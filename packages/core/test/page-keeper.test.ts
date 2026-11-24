import { describe, expect, it } from 'vitest';
import { startPageKeeper } from '../src/page-keeper';

type Sent = { id: number; method: string; params: Record<string, unknown>; sessionId?: string };

/** WebSocket giả: ghi lại lệnh đã gửi, tự trả lời thành công, cho phép đẩy sự kiện từ nhân. */
function fakeWs() {
  const sent: Sent[] = [];
  let instance: { emit: (type: string, data?: unknown) => void } | null = null;
  class Ws {
    private listeners = new Map<string, ((ev: { data?: string }) => void)[]>();
    constructor(public url: string) {
      instance = { emit: (type, data) => this.emit(type, data) };
      queueMicrotask(() => this.emit('open'));
    }
    addEventListener(type: string, fn: (ev: { data?: string }) => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    send(raw: string): void {
      const m = JSON.parse(raw) as Sent;
      sent.push(m);
      queueMicrotask(() => this.emit('message', { id: m.id, result: {} }));
    }
    close(): void {}
    private emit(type: string, data?: unknown): void {
      for (const fn of this.listeners.get(type) ?? []) fn(data === undefined ? {} : { data: JSON.stringify(data) });
    }
  }
  const attach = (sessionId: string, type: string): void =>
    instance!.emit('message', { method: 'Target.attachedToTarget', params: { sessionId, targetInfo: { type } } });
  return { Ws: Ws as unknown as new (url: string) => WebSocket, sent, attach };
}

const of = (sent: Sent[], sessionId: string): string[] => sent.filter((m) => m.sessionId === sessionId).map((m) => m.method);

describe('startPageKeeper', () => {
  it('tab và iframe nhận script trước khi chạy tiếp; màn hình giả chỉ đặt cho tab', async () => {
    const f = fakeWs();
    const screen = { width: 1920, height: 1080, scale: 2 };
    const k = await startPageKeeper('ws://x', { screen, script: 'SCRIPT' }, { WebSocketImpl: f.Ws });
    f.attach('p1', 'page');
    f.attach('f1', 'iframe');
    f.attach('w1', 'service_worker');
    expect(of(f.sent, 'p1')).toEqual([
      'Emulation.setDeviceMetricsOverride',
      'Page.enable',
      'Page.addScriptToEvaluateOnNewDocument',
      'Target.setAutoAttach',
      'Runtime.runIfWaitingForDebugger',
    ]);
    expect(of(f.sent, 'f1')).toEqual(['Page.enable', 'Page.addScriptToEvaluateOnNewDocument', 'Target.setAutoAttach', 'Runtime.runIfWaitingForDebugger']);
    expect(of(f.sent, 'w1')).toEqual(['Runtime.runIfWaitingForDebugger']);
    const add = f.sent.find((m) => m.sessionId === 'p1' && m.method === 'Page.addScriptToEvaluateOnNewDocument')!;
    expect(add.params).toEqual({ source: 'SCRIPT', runImmediately: true });
    k.close();
  });

  it('chỉ có script, không có màn hình giả', async () => {
    const f = fakeWs();
    const k = await startPageKeeper('ws://x', { screen: null, script: 'S' }, { WebSocketImpl: f.Ws });
    f.attach('p1', 'page');
    expect(of(f.sent, 'p1')).toEqual(['Page.enable', 'Page.addScriptToEvaluateOnNewDocument', 'Target.setAutoAttach', 'Runtime.runIfWaitingForDebugger']);
    k.close();
  });

  it('chỉ có màn hình giả, không chèn script', async () => {
    const f = fakeWs();
    const k = await startPageKeeper('ws://x', { screen: { width: 800, height: 600, scale: 1 }, script: null }, { WebSocketImpl: f.Ws });
    f.attach('p1', 'page');
    expect(of(f.sent, 'p1')).toEqual(['Emulation.setDeviceMetricsOverride', 'Target.setAutoAttach', 'Runtime.runIfWaitingForDebugger']);
    k.close();
  });
});
