import { createHash, timingSafeEqual } from 'node:crypto';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CookieImportResult, CoreInfo, Group, Profile, ProfileFilter, ProfileInput, ProfileUpdate, ProfileView, ProxyView, RunInfo } from '@bf/core';
import { DEFAULT_PORT } from './token';

/** Những gì máy chủ cần ở lõi. Đối tượng Core thật thoả mãn giao diện này. */
export interface ApiCore {
  info(): CoreInfo;
  listProfiles(filter?: ProfileFilter): ProfileView[];
  getProfile(id: string): ProfileView;
  createProfile(input: ProfileInput): Profile;
  updateProfile(id: string, patch: ProfileUpdate): Profile;
  deleteProfile(id: string): void;
  launch(id: string, opts?: { headless?: boolean }): Promise<RunInfo>;
  stop(id: string): Promise<void>;
  importCookies(id: string, text: string): Promise<CookieImportResult>;
  exportCookies(id: string): Promise<{ count: number; json: string }>;
  listGroups(): Group[];
  listProxies(): ProxyView[];
  checkProxy(id: string): Promise<ProxyView>;
}

export interface ApiServerOptions {
  core: ApiCore;
  token: string;
  /** Mặc định DEFAULT_PORT; 0 để hệ điều hành chọn cổng trống. */
  port?: number;
  /**
   * Gọi khi một request kết thúc bằng 500 do toHttp. Chỉ mang tên lỗi, mã lỗi hệ thống và tuyến khớp
   * (mẫu của route, không phải URL thật): không bao giờ có thông báo lỗi hay mã hồ sơ.
   */
  onError?: (info: { method: string; route: string; name: string; code?: string }) => void;
}

export interface ApiServer {
  port: number;
  address: string;
  close(): Promise<void>;
}

// Cố định: không có tuỳ chọn nào để nghe trên địa chỉ khác.
const HOST = '127.0.0.1';
const MAX_BODY = 6_000_000;
const PROFILE_FIELDS = new Set([
  'name', 'groupId', 'notes', 'platform', 'platformVersion', 'brand', 'hardwareConcurrency',
  'lang', 'acceptLang', 'timezone', 'proxyId', 'extensionIds',
]);
const NEED_OBJECT = 'Thân yêu cầu phải là một đối tượng JSON';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

/** So sánh thời gian hằng; băm trước để hai vế luôn cùng độ dài. */
function sameToken(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}),
    // Từ chối sớm thì thân request có thể chưa được đọc: đóng kết nối thay vì dùng lại.
    ...(status === 401 || status === 403 || status === 413 ? { Connection: 'close' } : {}),
  });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size <= MAX_BODY) chunks.push(buf);
  }
  if (size > MAX_BODY) throw new HttpError(413, 'Nội dung quá lớn (tối đa 6 MB)');
  if (size === 0) return undefined;
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Content-Type phải là application/json');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON không hợp lệ');
  }
}

function profileFields(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw new HttpError(400, NEED_OBJECT);
  for (const key of Object.keys(body)) {
    if (!PROFILE_FIELDS.has(key)) throw new HttpError(400, `Trường không được hỗ trợ: ${key.slice(0, 50)}`);
  }
  return body;
}

function toHttp(err: unknown): { status: number; message: string } {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  // Lỗi của lõi là Error thường với thông báo tiếng Việt. Mọi thứ khác (lỗi lập trình, lỗi hệ thống có mã)
  // có thể mang chi tiết nội bộ, nên không trả ra ngoài.
  const programming = err instanceof TypeError || err instanceof RangeError || err instanceof ReferenceError || err instanceof SyntaxError;
  if (!(err instanceof Error) || programming || typeof (err as { code?: unknown }).code === 'string') {
    return { status: 500, message: 'Lỗi nội bộ' };
  }
  return { status: err.message.startsWith('Không tìm thấy') ? 404 : 400, message: err.message };
}

interface Ctx {
  id: string;
  query: URLSearchParams;
  body: unknown;
}

interface Route {
  method: string;
  path: RegExp;
  status: number;
  run(ctx: Ctx): unknown;
}

function buildRoutes(core: ApiCore): Route[] {
  const ID = '([^/]+)';
  const route = (method: string, path: string, run: Route['run'], status = 200): Route => ({
    method,
    path: new RegExp(`^/v1/${path}$`),
    status,
    run,
  });
  return [
    route('GET', 'info', () => ({ ...core.info(), apiVersion: 1 })),
    route('GET', 'profiles', ({ query }) => {
      const filter: ProfileFilter = {};
      const search = query.get('search');
      if (search) filter.search = search;
      const groupId = query.get('groupId');
      if (groupId) filter.groupId = groupId === 'none' ? null : groupId;
      return core.listProfiles(filter);
    }),
    route('POST', 'profiles', ({ body }) => core.getProfile(core.createProfile(profileFields(body) as unknown as ProfileInput).id), 201),
    route('GET', `profiles/${ID}`, ({ id }) => core.getProfile(id)),
    route('PATCH', `profiles/${ID}`, ({ id, body }) => {
      core.updateProfile(id, profileFields(body) as ProfileUpdate);
      return core.getProfile(id);
    }),
    route('DELETE', `profiles/${ID}`, ({ id }) => {
      core.deleteProfile(id);
      return { ok: true };
    }),
    route('POST', `profiles/${ID}/start`, ({ id, body }) => {
      const bad =
        body !== undefined &&
        (!isRecord(body) || Object.keys(body).some((k) => k !== 'headless') || (body.headless !== undefined && typeof body.headless !== 'boolean'));
      if (bad) throw new HttpError(400, 'Thân yêu cầu chỉ nhận { "headless": true | false }');
      // Gọi lại khi đang chạy thì trả phiên hiện có, để script gọi start nhiều lần vẫn an toàn.
      const running = core.getProfile(id).run;
      if (running) return running;
      return core.launch(id, { headless: isRecord(body) && body.headless === true });
    }),
    route('POST', `profiles/${ID}/stop`, async ({ id }) => {
      core.getProfile(id);
      await core.stop(id);
      return { ok: true };
    }),
    route('GET', `profiles/${ID}/cookies`, async ({ id }) => {
      const { count, json } = await core.exportCookies(id);
      return { count, cookies: JSON.parse(json) as unknown };
    }),
    route('POST', `profiles/${ID}/cookies`, ({ id, body }) => {
      if (!isRecord(body)) throw new HttpError(400, NEED_OBJECT);
      const hasText = typeof body.text === 'string';
      const hasList = Array.isArray(body.cookies);
      if (hasText === hasList || Object.keys(body).some((k) => k !== 'text' && k !== 'cookies')) {
        throw new HttpError(400, 'Thân yêu cầu phải có đúng một trong hai trường: "text" (chuỗi) hoặc "cookies" (mảng)');
      }
      return core.importCookies(id, hasText ? (body.text as string) : JSON.stringify(body.cookies));
    }),
    route('GET', 'groups', () => core.listGroups()),
    route('GET', 'proxies', () => core.listProxies()),
    route('POST', `proxies/${ID}/check`, ({ id }) => core.checkProxy(id)),
  ];
}

export function startApiServer(opts: ApiServerOptions): Promise<ApiServer> {
  const routes = buildRoutes(opts.core);
  const wanted = opts.port ?? DEFAULT_PORT;
  let port = 0;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let route = 'chưa khớp route';
    try {
      // Thứ tự là một phần của thiết kế: Host (chặn DNS rebinding), Origin (chặn trang web), rồi mới tới token.
      const host = String(req.headers.host ?? '').toLowerCase();
      if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) throw new HttpError(403, 'Host không hợp lệ');
      if (req.headers.origin !== undefined) throw new HttpError(403, 'Không nhận yêu cầu từ trang web');
      const auth = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ''));
      if (!auth || !sameToken(auth[1], opts.token)) throw new HttpError(401, 'Thiếu hoặc sai token');

      let url: URL;
      try {
        url = new URL(req.url ?? '/', `http://${HOST}`);
      } catch {
        throw new HttpError(400, 'Đường dẫn không hợp lệ');
      }
      const candidates = routes.map((r) => ({ r, match: r.path.exec(url.pathname) })).filter((c) => c.match !== null);
      if (candidates.length === 0) throw new HttpError(404, 'Không tìm thấy đường dẫn');
      const hit = candidates.find((c) => c.r.method === req.method);
      if (!hit) throw new HttpError(405, 'Phương thức không được hỗ trợ');
      route = hit.r.path.source;
      let id = '';
      try {
        id = decodeURIComponent(hit.match?.[1] ?? '');
      } catch {
        throw new HttpError(400, 'Mã không hợp lệ');
      }
      const body = req.method === 'POST' || req.method === 'PATCH' ? await readJson(req) : undefined;
      const result = await hit.r.run({ id, query: url.searchParams, body });
      send(res, hit.r.status, result);
    } catch (err) {
      const { status, message } = toHttp(err);
      if (status === 500 && opts.onError) {
        const code = (err as { code?: unknown } | null)?.code;
        try {
          opts.onError({
            method: String(req.method),
            route,
            name: err instanceof Error ? err.name : typeof err,
            ...(typeof code === 'string' ? { code } : {}),
          });
        } catch {
          // Trình ghi log hỏng không được làm hỏng phản hồi.
        }
      }
      send(res, status, { error: message });
    }
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => res.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(new Error(err.code === 'EADDRINUSE' ? `Cổng ${wanted} đang được dùng bởi chương trình khác` : 'Không mở được cổng cho API'));
    });
    server.listen(wanted, HOST, () => {
      const addr = server.address() as AddressInfo;
      port = addr.port;
      resolve({
        port,
        address: addr.address,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
