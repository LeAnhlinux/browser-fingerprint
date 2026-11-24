import net from 'node:net';
import { Server } from 'proxy-chain';
import type { ProxyProtocol } from './types';

export interface Upstream {
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

export function upstreamUrl(u: Upstream): string {
  const auth = u.username ? `${encodeURIComponent(u.username)}:${encodeURIComponent(u.password ?? '')}@` : '';
  // "socks5h" để proxy tự phân giải tên miền. Với "socks5", thư viện chuyển tiếp trang http:// tự tra DNS trên máy,
  // làm lộ tên miền đang truy cập cho DNS của nhà mạng.
  const scheme = u.protocol === 'socks5' ? 'socks5h' : u.protocol;
  return `${scheme}://${auth}${u.host}:${u.port}`;
}

export class ProxyBridge {
  private constructor(private server: Server) {}

  static async open(u: Upstream): Promise<ProxyBridge> {
    const upstreamProxyUrl = upstreamUrl(u);
    const server = new Server({
      port: 0,
      host: '127.0.0.1',
      prepareRequestFunction: () => ({ upstreamProxyUrl }),
    });
    await server.listen();
    return new ProxyBridge(server);
  }

  get port(): number {
    return this.server.port;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async close(): Promise<void> {
    await this.server.close(true);
  }
}

export function assertReachable(host: string, port: number, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error(`Hết thời gian kết nối ${host}:${port}`)));
    socket.once('error', fail);
    socket.once('connect', () => {
      socket.end();
      resolve();
    });
  });
}
