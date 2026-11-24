import type { ScreenSpec } from './fingerprint';

export interface PageKeeper {
  close(): void;
}

/** Những gì cần áp cho mọi tab: màn hình giả và/hoặc một script chạy trước script của trang. */
export interface PageSpec {
  screen: ScreenSpec | null;
  script: string | null;
}

export interface PageKeeperOptions {
  timeoutMs?: number;
  WebSocketImpl?: new (url: string) => WebSocket;
}

type Msg = { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; error?: unknown };

/**
 * Giữ một kết nối CDP suốt lúc hồ sơ chạy để mọi tab nhận màn hình giả và script giả lập.
 * Nhân tự gắn phiên này vào từng tab và iframe mới, tạm dừng nó đến khi ta cài xong,
 * nên cả script chạy sớm nhất của trang cũng chỉ thấy bản giả.
 */
export function startPageKeeper(cdpUrl: string, spec: PageSpec, opts: PageKeeperOptions = {}): Promise<PageKeeper> {
  const Ws = opts.WebSocketImpl ?? WebSocket;
  const timeoutMs = opts.timeoutMs ?? 5000;
  return new Promise((resolve, reject) => {
    const ws = new Ws(cdpUrl);
    let nextId = 0;
    let ready = false;
    const pending = new Map<number, (m: Msg) => void>();
    const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Msg> =>
      new Promise((res) => {
        const id = ++nextId;
        pending.set(id, res);
        try {
          ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        } catch {
          pending.delete(id);
          res({ id, error: 'closed' });
        }
      });
    const fail = (message: string): void => {
      if (ready) return;
      ready = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // đã đóng
      }
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('Hết thời gian gắn vào tab'), timeoutMs);

    // Gửi liền các lệnh, không chờ trả lời từng lệnh: với tab đang tạm dừng, nhân có thể chỉ trả lời
    // sau khi tab chạy tiếp, nên chờ thì tab treo mãi. Nhân xử lý lệnh của một phiên theo thứ tự,
    // nên mọi thứ được cài trước khi tab chạy tiếp.
    const onAttached = (sessionId: string, type: string): void => {
      const frame = type === 'page' || type === 'iframe';
      if (type === 'page' && spec.screen) {
        const s = spec.screen;
        void send(
          'Emulation.setDeviceMetricsOverride',
          { width: 0, height: 0, deviceScaleFactor: s.scale, mobile: false, screenWidth: s.width, screenHeight: s.height },
          sessionId,
        );
      }
      if (frame && spec.script) {
        // Nhân chỉ chạy script này cho trang mới khi miền Page đã bật (đo trên nhân thật: thiếu Page.enable thì script không chạy).
        // runImmediately: tab đã mở sẵn trước khi gắn (tab đầu tiên) cũng nhận script ngay.
        void send('Page.enable', {}, sessionId);
        void send('Page.addScriptToEvaluateOnNewDocument', { source: spec.script, runImmediately: true }, sessionId);
      }
      if (frame) void send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
      void send('Runtime.runIfWaitingForDebugger', {}, sessionId);
    };

    ws.addEventListener('message', (ev) => {
      let m: Msg;
      try {
        m = JSON.parse(String((ev as MessageEvent).data));
      } catch {
        return;
      }
      if (typeof m.id === 'number') {
        const res = pending.get(m.id);
        pending.delete(m.id);
        res?.(m);
        return;
      }
      if (m.method === 'Target.attachedToTarget' && m.params) {
        const sessionId = m.params.sessionId as string;
        const type = (m.params.targetInfo as { type?: string } | undefined)?.type ?? '';
        onAttached(sessionId, type);
      }
    });
    ws.addEventListener('error', () => fail('Không kết nối được CDP để gắn vào tab'));
    ws.addEventListener('close', () => {
      for (const res of pending.values()) res({ error: 'closed' });
      pending.clear();
      fail('Mất kết nối CDP khi gắn vào tab');
    });
    ws.addEventListener('open', () => {
      void send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }).then((r) => {
        if (r.error) {
          fail('Nhân từ chối tự gắn vào tab');
          return;
        }
        if (ready) return;
        ready = true;
        clearTimeout(timer);
        resolve({
          close: () => {
            try {
              ws.close();
            } catch {
              // đã đóng
            }
          },
        });
      });
    });
  });
}
