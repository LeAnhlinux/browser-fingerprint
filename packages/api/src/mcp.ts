import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ProfileInput, ProfileUpdate } from '@bf/core';
import { ApiError, type ApiClient } from './client';

export interface McpDeps {
  client: ApiClient;
  /** Thư mục duy nhất (đường dẫn tuyệt đối) mà import_cookies và export_cookies được đọc và ghi. */
  filesDir: string;
}

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'browser-fingerprint', version: '0.1.0' };
const INSTRUCTIONS =
  'Điều khiển app Browser Fingerprint đang mở trên máy này: quản lý hồ sơ trình duyệt tách biệt, khởi động để lấy địa chỉ CDP, nhập và xuất cookie qua file. ' +
  'App phải đang mở. Kết quả của công cụ không bao giờ chứa giá trị cookie; cookie chỉ đi qua file trong một thư mục cố định.';

/** Giới hạn của lõi app cho văn bản cookie; đọc quá mức này là vô ích. */
export const MAX_COOKIE_FILE_BYTES = 5_000_000;

/**
 * Đọc file cookie do mô hình chỉ định (đầu vào không tin cậy): chỉ file thường, không quá giới hạn.
 * stat trước khi mở để không chạm vào FIFO/thiết bị; mở với O_NONBLOCK phòng file bị thay giữa chừng;
 * kiểm lại trên handle đã mở và đọc có chặn trên nên không bao giờ nạp quá giới hạn vào bộ nhớ.
 */
export async function readCookieFile(path: string): Promise<string> {
  const before = await stat(path);
  if (!before.isFile()) throw new Error('not a regular file');
  if (before.size > MAX_COOKIE_FILE_BYTES) throw new Error('file too large');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const after = await handle.stat();
    if (!after.isFile()) throw new Error('not a regular file');
    const buffer = Buffer.alloc(MAX_COOKIE_FILE_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_COOKIE_FILE_BYTES) throw new Error('file too large');
    return buffer.toString('utf8', 0, total);
  } finally {
    await handle.close();
  }
}

/** Lỗi do người gọi công cụ: thành kết quả isError, không phải lỗi giao thức. */
class ToolError extends Error {}

type Args = Record<string, unknown>;

interface Tool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  annotations?: Record<string, boolean>;
  run(args: Args, deps: McpDeps): Promise<unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value === '') throw new ToolError(`Thiếu tham số: ${key}`);
  return value;
}

const FILE_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
// Tên thiết bị của Windows: mở "NUL.json" hay "con" không tạo file mà ghi vào thiết bị.
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const BAD_FILE_NAME =
  'fileName không hợp lệ: chỉ là tên file (1-100 ký tự gồm chữ, số, dấu chấm, gạch ngang, gạch dưới), không bắt đầu hoặc kết thúc bằng dấu chấm, không phải đường dẫn';

/** Tên file do mô hình đưa (không tin cậy): chỉ một thành phần đơn giản, không bao giờ thoát được khỏi thư mục. */
function fileNameArg(args: Args): string {
  const name = str(args, 'fileName');
  if (!FILE_NAME_RE.test(name) || name.startsWith('.') || name.endsWith('.') || WINDOWS_DEVICE_RE.test(name)) throw new ToolError(BAD_FILE_NAME);
  return name;
}

/** Tạo thư mục file của MCP (0700) nếu chưa có, và siết quyền nếu đã có. */
async function ensureFilesDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await chmod(dir, 0o700);
    } catch (e) {
      // Windows: bảo vệ dựa vào ACL, chmod không đổi ACL (như token.ts).
      if (process.platform !== 'win32') throw e;
    }
  } catch {
    throw new ToolError(`Không chuẩn bị được thư mục file của MCP: ${dir}`);
  }
}

const ID = { type: 'string', description: 'Mã hồ sơ (trường id trong kết quả list_profiles)' };
const PROFILE_PROPS = {
  name: { type: 'string', description: 'Tên hồ sơ' },
  groupId: { type: ['string', 'null'], description: 'Mã nhóm (xem list_groups); null để bỏ nhóm' },
  proxyId: { type: ['string', 'null'], description: 'Mã proxy (xem list_proxies); null để không dùng proxy' },
  timezone: { type: 'string', description: 'Múi giờ IANA, ví dụ America/New_York; nên khớp vùng của proxy' },
  lang: { type: 'string', description: 'Ngôn ngữ giao diện, ví dụ en-US' },
  acceptLang: { type: 'string', description: 'Giá trị Accept-Language, ví dụ en-US,en' },
  notes: { type: 'string', description: 'Ghi chú tự do' },
};

function profileFields(args: Args, skip: string[] = []): ProfileUpdate {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (skip.includes(key)) continue;
    if (!Object.hasOwn(PROFILE_PROPS, key)) throw new ToolError(`Tham số không được hỗ trợ: ${key.slice(0, 50)}`);
    fields[key] = value;
  }
  return fields as ProfileUpdate;
}

const READ_ONLY = { readOnlyHint: true };

const TOOLS: Tool[] = [
  {
    name: 'list_profiles',
    description: 'Liệt kê các hồ sơ trình duyệt, kèm trạng thái chạy và địa chỉ CDP nếu đang chạy. Lọc theo tên hoặc theo nhóm.',
    inputSchema: {
      type: 'object',
      properties: { search: { type: 'string', description: 'Chuỗi cần có trong tên' }, groupId: { type: ['string', 'null'], description: 'Mã nhóm; null để lấy hồ sơ chưa gán nhóm' } },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    run: (args, { client }) =>
      client.listProfiles({
        ...(typeof args.search === 'string' ? { search: args.search } : {}),
        ...(typeof args.groupId === 'string' || args.groupId === null ? { groupId: args.groupId } : {}),
      }),
  },
  {
    name: 'get_profile',
    description: 'Xem đầy đủ một hồ sơ: dấu vân tay, proxy, nhóm, extension và trạng thái chạy.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
    annotations: READ_ONLY,
    run: (args, { client }) => client.getProfile(str(args, 'id')),
  },
  {
    name: 'create_profile',
    description: 'Tạo một hồ sơ trình duyệt mới với dấu vân tay ngẫu nhiên cố định. Chỉ cần tên; các trường khác mặc định theo máy.',
    inputSchema: { type: 'object', properties: PROFILE_PROPS, required: ['name'], additionalProperties: false },
    run: (args, { client }) => {
      const name = str(args, 'name');
      return client.createProfile({ ...profileFields(args), name } as ProfileInput);
    },
  },
  {
    name: 'update_profile',
    description: 'Sửa một hồ sơ. Chỉ các trường được nêu mới đổi; dấu vân tay (seed) không đổi được.',
    inputSchema: { type: 'object', properties: { id: ID, ...PROFILE_PROPS }, required: ['id'], additionalProperties: false },
    run: (args, { client }) => client.updateProfile(str(args, 'id'), profileFields(args, ['id'])),
  },
  {
    name: 'delete_profile',
    description: 'Xoá vĩnh viễn một hồ sơ cùng toàn bộ dữ liệu trình duyệt của nó (cookie, phiên đăng nhập, dữ liệu extension). Không khôi phục được. Hồ sơ phải đang dừng.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
    annotations: { destructiveHint: true },
    run: (args, { client }) => client.deleteProfile(str(args, 'id')),
  },
  {
    name: 'start_profile',
    description: 'Khởi động trình duyệt của một hồ sơ (qua proxy của nó nếu có) và trả về cdpUrl để nối Playwright/Puppeteer. Đang chạy rồi thì trả phiên hiện có. Lưu ý: cdpUrl cho toàn quyền điều khiển trình duyệt đó, kể cả đọc cookie của nó.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, headless: { type: 'boolean', description: 'true để chạy không cửa sổ' } },
      required: ['id'],
      additionalProperties: false,
    },
    run: (args, { client }) => {
      if (args.headless !== undefined && typeof args.headless !== 'boolean') throw new ToolError('Tham số headless phải là true hoặc false');
      return client.startProfile(str(args, 'id'), args.headless === undefined ? {} : { headless: args.headless });
    },
  },
  {
    name: 'stop_profile',
    description: 'Dừng trình duyệt của một hồ sơ. Hồ sơ không chạy thì không làm gì.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
    run: (args, { client }) => client.stopProfile(str(args, 'id')),
  },
  {
    name: 'import_cookies',
    description: 'Nhập cookie vào một hồ sơ từ một file (JSON kiểu extension cookie hoặc Netscape cookies.txt) nằm trong thư mục file của MCP; chỉ nhận tên file, không nhận đường dẫn. Kết quả là số cookie đã nhập, không có giá trị cookie.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, fileName: { type: 'string', description: 'Tên file cookie trong thư mục file của MCP (1-100 ký tự: chữ, số, ., -, _; không bắt đầu bằng dấu chấm)' } },
      required: ['id', 'fileName'],
      additionalProperties: false,
    },
    run: async (args, { client, filesDir }) => {
      const id = str(args, 'id');
      const path = join(filesDir, fileNameArg(args));
      await ensureFilesDir(filesDir);
      let text: string;
      try {
        // Một liên kết trong thư mục không được dẫn việc đọc ra ngoài.
        if ((await lstat(path)).isSymbolicLink()) throw new Error('symlink');
        text = await readCookieFile(path);
      } catch {
        throw new ToolError(`Không đọc được file: ${path}`);
      }
      return client.importCookies(id, text);
    },
  },
  {
    name: 'export_cookies',
    description: 'Xuất cookie của một hồ sơ ra một file JSON mới trong thư mục file của MCP (chỉ chủ máy đọc được), chỉ nhận tên file; trả về số lượng và đường dẫn đầy đủ. File đã có thì không ghi đè. Kết quả không chứa giá trị cookie, nhưng file tương đương mật khẩu.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, fileName: { type: 'string', description: 'Tên file sẽ tạo trong thư mục file của MCP (1-100 ký tự: chữ, số, ., -, _; không bắt đầu bằng dấu chấm); file không được tồn tại sẵn' } },
      required: ['id', 'fileName'],
      additionalProperties: false,
    },
    run: async (args, { client, filesDir }) => {
      const id = str(args, 'id');
      const path = join(filesDir, fileNameArg(args));
      await ensureFilesDir(filesDir);
      // Giữ chỗ đích TRƯỚC khi xuất (có thể mở một trình duyệt ẩn): 'wx' thất bại nếu đã có gì ở đó,
      // kể cả liên kết; 0600 vì file cookie chỉ chủ máy được đọc.
      let handle;
      try {
        handle = await open(path, 'wx', 0o600);
      } catch (err) {
        if (isRecord(err) && err.code === 'EEXIST') throw new ToolError(`File đã tồn tại, hãy chọn tên khác: ${path}`);
        throw new ToolError(`Không ghi được file: ${path}`);
      }
      try {
        const { count, cookies } = await client.exportCookies(id);
        try {
          await handle.writeFile(JSON.stringify(cookies, null, 2));
        } catch {
          throw new ToolError(`Không ghi được file: ${path}`);
        }
        return { count, filePath: path };
      } catch (err) {
        await rm(path, { force: true }).catch(() => undefined);
        throw err;
      } finally {
        await handle.close().catch(() => undefined);
      }
    },
  },
  {
    name: 'list_groups',
    description: 'Liệt kê các nhóm hồ sơ (mã và tên) để dùng làm groupId khi tạo hoặc lọc hồ sơ.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    run: (_args, { client }) => client.listGroups(),
  },
  {
    name: 'list_proxies',
    description: 'Liệt kê các proxy đã lưu kèm kết quả kiểm tra gần nhất (IP, quốc gia, múi giờ). Không bao giờ trả mật khẩu proxy.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    run: (_args, { client }) => client.listProxies(),
  },
  {
    name: 'check_proxy',
    description: 'Kiểm tra một proxy còn sống không bằng cách gửi một request tra IP qua chính nó; trả về IP, quốc gia và múi giờ.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Mã proxy (xem list_proxies)' } }, required: ['id'], additionalProperties: false },
    run: (args, { client }) => client.checkProxy(str(args, 'id')),
  },
  {
    name: 'captcha_balance',
    description: 'Xem số dư tài khoản CapMonster Cloud (USD). API key được nhập trong app (Cài đặt → CapMonster), công cụ không bao giờ trả key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    run: (_args, { client }) => client.captchaBalance(),
  },
  {
    name: 'solve_captcha',
    description:
      'Giải một captcha qua CapMonster Cloud (tốn tiền trong tài khoản CapMonster của người dùng) và trả về lời giải (token hoặc chữ) cùng chi phí. ' +
      'task theo đúng định dạng API createTask của CapMonster, ví dụ {"type":"RecaptchaV2Task","websiteURL":"...","websiteKey":"..."} hoặc TurnstileTask, ImageToTextTask...',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'object', description: 'Object task theo tài liệu CapMonster, bắt buộc có trường type' },
        timeoutSeconds: { type: 'integer', description: 'Thời gian chờ tối đa, 10-280 giây (mặc định 120)' },
      },
      required: ['task'],
      additionalProperties: false,
    },
    run: (args, { client }) => {
      if (!isRecord(args.task)) throw new ToolError('Thiếu tham số: task (đối tượng)');
      const seconds = args.timeoutSeconds;
      if (seconds !== undefined && (typeof seconds !== 'number' || !Number.isInteger(seconds))) throw new ToolError('timeoutSeconds phải là số nguyên');
      return client.solveCaptcha(args.task, seconds === undefined ? undefined : seconds * 1000);
    },
  },
];

export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name);

function fail(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export function createMcpHandler(deps: McpDeps): (message: unknown) => Promise<unknown | null> {
  return async (message) => {
    if (!isRecord(message)) return fail(null, -32600, 'Invalid Request');
    const { id, method, params } = message;
    // Phản hồi gửi cho mình (không có method): bỏ qua.
    if (method === undefined && ('result' in message || 'error' in message)) return null;
    if (message.jsonrpc !== '2.0' || typeof method !== 'string') return fail(id, -32600, 'Invalid Request');
    // Thông báo (không có id) không bao giờ được trả lời.
    if (id === undefined) return null;
    const ok = (result: unknown): unknown => ({ jsonrpc: '2.0', id, result });

    if (method === 'initialize') {
      const wanted = isRecord(params) ? params.protocolVersion : undefined;
      return ok({
        protocolVersion: typeof wanted === 'string' && PROTOCOLS.includes(wanted) ? wanted : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') {
      return ok({ tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, ...(annotations ? { annotations } : {}) })) });
    }
    if (method === 'tools/call') {
      const tool = isRecord(params) ? TOOLS.find((t) => t.name === params.name) : undefined;
      if (!tool || !isRecord(params)) return fail(id, -32602, 'Unknown tool');
      const args = params.arguments === undefined ? {} : params.arguments;
      try {
        if (!isRecord(args)) throw new ToolError('arguments phải là một đối tượng');
        const result = await tool.run(args, deps);
        return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        // ToolError và ApiError mang thông báo dành cho người dùng; mọi lỗi khác không lộ chi tiết.
        const known = err instanceof ToolError || err instanceof ApiError;
        return ok({ content: [{ type: 'text', text: known ? (err as Error).message : 'Lỗi nội bộ của MCP server' }], isError: true });
      }
    }
    return fail(id, -32601, 'Method not found');
  };
}

export async function serveStdio(
  handler: (message: unknown) => Promise<unknown | null>,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  // Xử lý tuần tự để phản hồi ra đúng thứ tự yêu cầu.
  for await (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    let message: unknown;
    let reply: unknown | null;
    try {
      message = JSON.parse(line);
      reply = await handler(message);
    } catch {
      reply = fail(null, -32700, 'Parse error');
    }
    if (reply !== null) output.write(`${JSON.stringify(reply)}\n`);
  }
}
