export class CdpError extends Error {
  constructor(
    message: string,
    /** true: nhân trả lời lệnh bằng một lỗi; false: lỗi kết nối hoặc hết thời gian. */
    readonly protocol = false,
  ) {
    super(message);
  }
}

export interface CdpSession {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
}

export interface CdpOptions {
  timeoutMs?: number;
  WebSocketImpl?: new (url: string) => WebSocket;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const LOST = 'Mất kết nối CDP';

export function openCdp(url: string, opts: CdpOptions = {}): Promise<CdpSession> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const Ws = opts.WebSocketImpl ?? WebSocket;
  return new Promise((resolveOpen, rejectOpen) => {
    const ws = new Ws(url);
    const pending = new Map<number, Pending>();
    let nextId = 0;
    let opened = false;
    let dead = false;

    const failAll = (): void => {
      dead = true;
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new CdpError(LOST));
      }
      pending.clear();
    };

    const call = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (dead) {
          reject(new CdpError(LOST));
          return;
        }
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new CdpError(`Hết thời gian chờ lệnh CDP ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        try {
          ws.send(JSON.stringify({ id, method, params }));
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new CdpError(LOST));
        }
      });

    const openTimer = setTimeout(() => {
      if (opened) return;
      rejectOpen(new CdpError('Hết thời gian kết nối CDP'));
      ws.close();
    }, timeoutMs);

    ws.addEventListener('open', () => {
      opened = true;
      clearTimeout(openTimer);
      resolveOpen({ call, close: () => ws.close() });
    });
    ws.addEventListener('error', () => {
      clearTimeout(openTimer);
      if (!opened) rejectOpen(new CdpError('Không kết nối được CDP'));
      failAll();
    });
    ws.addEventListener('close', () => {
      clearTimeout(openTimer);
      failAll();
    });
    ws.addEventListener('message', (ev) => {
      let msg: { id?: number; result?: unknown; error?: { message?: unknown } };
      try {
        msg = JSON.parse(String((ev as MessageEvent).data));
      } catch {
        return;
      }
      if (typeof msg.id !== 'number') return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new CdpError(String(msg.error.message ?? 'Lỗi CDP'), true));
      else p.resolve(msg.result);
    });
  });
}
