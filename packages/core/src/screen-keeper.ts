import type { ScreenSpec } from './fingerprint';

export interface ScreenKeeper {
  close(): void;
}

export interface ScreenKeeperOptions {
  timeoutMs?: number;
  WebSocketImpl?: new (url: string) => WebSocket;
}

type Msg = { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; error?: unknown };

/**
 * Giữ một kết nối CDP suốt lúc hồ sơ chạy để mọi tab nhận màn hình giả.
 * Nhân tự gắn phiên này vào từng tab mới và tạm dừng tab đến khi ta đặt xong màn hình,
 * nên cả script chạy sớm nhất của trang cũng chỉ thấy màn hình giả.
 */
export function startScreenKeeper(cdpUrl: string, screen: ScreenSpec, opts: ScreenKeeperOptions = {}): Promise<ScreenKeeper> {
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
    const timer = setTimeout(() => fail('Hết thời gian đặt màn hình giả'), timeoutMs);

    // Gửi liền ba lệnh, không chờ trả lời từng lệnh: với tab đang tạm dừng, nhân có thể chỉ trả lời
    // lệnh đặt màn hình sau khi tab chạy tiếp, nên chờ thì tab treo mãi. Nhân xử lý lệnh của một phiên theo thứ tự,
    // nên màn hình giả vẫn được đặt trước khi tab chạy tiếp.
    const onAttached = (sessionId: string, type: string): void => {
      if (type === 'page') {
        void send(
          'Emulation.setDeviceMetricsOverride',
          { width: 0, height: 0, deviceScaleFactor: screen.scale, mobile: false, screenWidth: screen.width, screenHeight: screen.height },
          sessionId,
        );
      }
      if (type === 'page' || type === 'iframe') {
        void send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
      }
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
    ws.addEventListener('error', () => fail('Không kết nối được CDP để đặt màn hình giả'));
    ws.addEventListener('close', () => {
      for (const res of pending.values()) res({ error: 'closed' });
      pending.clear();
      fail('Mất kết nối CDP khi đặt màn hình giả');
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
