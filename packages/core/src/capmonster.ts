import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** Địa chỉ API của CapMonster Cloud (theo tài liệu chính thức). */
export const CAPMONSTER_API = 'https://api.capmonster.cloud';
/** Link tải gói extension Chrome mới nhất, lấy từ tài liệu chính thức của CapMonster. */
export const CAPMONSTER_EXTENSION_URL = 'https://zenno.link/chrome-actual-build';

export const SOLVE_TIMEOUT_DEFAULT_MS = 120_000;
export const SOLVE_TIMEOUT_MIN_MS = 10_000;
export const SOLVE_TIMEOUT_MAX_MS = 280_000;
const MAX_TASK_JSON = 1_000_000;
const MAX_ZIP_BYTES = 50_000_000;
const REQUEST_TIMEOUT_MS = 30_000;

type FetchFn = typeof fetch;

export interface CapMonsterOptions {
  fetchImpl?: FetchFn;
  baseUrl?: string;
  /** Khoảng nghỉ giữa các lần hỏi kết quả. */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface SolveResult {
  taskId: number;
  solution: unknown;
  cost: number | null;
}

const MESSAGES: Record<string, string> = {
  ERROR_KEY_DOES_NOT_EXIST: 'API key CapMonster không đúng',
  ERROR_ZERO_BALANCE: 'Tài khoản CapMonster hết tiền',
  ERROR_NO_SLOT_AVAILABLE: 'CapMonster đang quá tải, thử lại sau',
  ERROR_CAPTCHA_UNSOLVABLE: 'CapMonster không giải được captcha này',
  ERROR_IP_BANNED: 'IP của máy này đang bị CapMonster chặn tạm thời',
  ERROR_NO_SUCH_CAPCHA_ID: 'CapMonster không tìm thấy task',
  WRONG_CAPTCHA_ID: 'CapMonster không tìm thấy task',
  ERROR_TASK_NOT_SUPPORTED: 'CapMonster không hỗ trợ loại captcha này',
  ERROR_DOMAIN_NOT_ALLOWED: 'CapMonster không giải captcha cho tên miền này',
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Thông báo lỗi tiếng Việt cho người dùng; không mang key hay nội dung request. */
function errorFrom(data: Record<string, unknown>): Error {
  const code = typeof data.errorCode === 'string' ? data.errorCode.slice(0, 80) : '';
  const known = MESSAGES[code];
  if (known) return new Error(known);
  const desc = typeof data.errorDescription === 'string' ? data.errorDescription.slice(0, 200) : '';
  return new Error(`CapMonster báo lỗi${code ? ` ${code}` : ''}${desc ? `: ${desc}` : ''}`);
}

async function call(method: string, body: Record<string, unknown>, opts: CapMonsterOptions, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${opts.baseUrl ?? CAPMONSTER_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
  } catch {
    throw new Error('Không kết nối được tới CapMonster');
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`CapMonster trả lời không hợp lệ (HTTP ${res.status})`);
  }
  if (!isRecord(data)) throw new Error(`CapMonster trả lời không hợp lệ (HTTP ${res.status})`);
  if (data.errorId !== 0 && data.errorId !== undefined) throw errorFrom(data);
  if (!res.ok) throw new Error(`CapMonster trả lời lỗi HTTP ${res.status}`);
  return data;
}

export async function getBalance(clientKey: string, opts: CapMonsterOptions = {}): Promise<number> {
  const data = await call('getBalance', { clientKey }, opts);
  if (typeof data.balance !== 'number') throw new Error('CapMonster trả lời không hợp lệ');
  return data.balance;
}

/** Kiểm tra object task do script gửi: phải là đối tượng có type, không quá lớn. Nội dung còn lại do CapMonster kiểm. */
export function checkTask(task: unknown): Record<string, unknown> {
  if (!isRecord(task) || typeof task.type !== 'string' || task.type.trim() === '') {
    throw new Error('task phải là một đối tượng có trường "type" (xem tài liệu CapMonster: RecaptchaV2Task, TurnstileTask…)');
  }
  if (JSON.stringify(task).length > MAX_TASK_JSON) throw new Error('task quá lớn');
  return task;
}

export function checkSolveTimeout(ms: unknown): number {
  if (ms === undefined) return SOLVE_TIMEOUT_DEFAULT_MS;
  if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < SOLVE_TIMEOUT_MIN_MS || ms > SOLVE_TIMEOUT_MAX_MS) {
    throw new Error(`Thời gian chờ phải từ ${SOLVE_TIMEOUT_MIN_MS / 1000} đến ${SOLVE_TIMEOUT_MAX_MS / 1000} giây`);
  }
  return ms;
}

/** Tạo task rồi hỏi kết quả tới khi xong hoặc hết giờ. */
export async function solveTask(clientKey: string, task: unknown, timeoutMs = SOLVE_TIMEOUT_DEFAULT_MS, opts: CapMonsterOptions = {}): Promise<SolveResult> {
  const checked = checkTask(task);
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 3000;
  const deadline = now() + timeoutMs;
  const late = (): Error => new Error(`CapMonster chưa giải xong sau ${Math.round(timeoutMs / 1000)} giây`);
  // Mỗi lần gọi không được vượt quá thời gian còn lại, để tổng thời gian không quá timeoutMs.
  const remaining = (): number => Math.min(REQUEST_TIMEOUT_MS, deadline - now());
  const created = await call('createTask', { clientKey, task: checked }, opts, remaining());
  const taskId = created.taskId;
  if (typeof taskId !== 'number') throw new Error('CapMonster không trả mã task');
  for (;;) {
    if (now() + pollMs >= deadline) throw late();
    await sleep(pollMs);
    let r: Record<string, unknown>;
    try {
      r = await call('getTaskResult', { clientKey, taskId }, opts, remaining());
    } catch (err) {
      if (now() >= deadline) throw late();
      throw err;
    }
    if (r.status === 'ready') return { taskId, solution: r.solution ?? null, cost: typeof r.cost === 'number' ? r.cost : null };
    if (r.status !== 'processing') throw new Error('CapMonster trả trạng thái không rõ');
  }
}

const SETTINGS_FILE = 'defaultSettings.json';

async function readSettings(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = JSON.parse((await readFile(join(dir, SETTINGS_FILE), 'utf8')).replace(/^﻿/, ''));
    return isRecord(data) && typeof data.clientKey === 'string' ? data : null;
  } catch {
    return null;
  }
}

/** Extension CapMonster nhận theo nội dung: tên có "CapMonster" và có file cài đặt mặc định với trường clientKey. */
export async function isCapMonsterExtension(dir: string, name: string): Promise<boolean> {
  return /capmonster/i.test(name) && (await readSettings(dir)) !== null;
}

/**
 * Ghi key vào defaultSettings.json của extension (cách CapMonster hướng dẫn). Extension đọc lại file này mỗi lần khởi động;
 * key người dùng tự gõ trong popup (lưu trong storage của hồ sơ) vẫn được ưu tiên hơn.
 */
export async function applyCapMonsterKey(dir: string, clientKey: string): Promise<void> {
  const settings = await readSettings(dir);
  if (!settings || settings.clientKey === clientKey) return;
  settings.clientKey = clientKey;
  const target = join(dir, SETTINGS_FILE);
  const tmp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(settings, null, 4), { mode: 0o600 });
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function readLimited(res: Response): Promise<Buffer> {
  if (Number(res.headers.get('content-length')) > MAX_ZIP_BYTES) throw new Error('Gói extension quá lớn');
  if (!res.body) return Buffer.alloc(0);
  // Đọc dần và dừng ngay khi vượt giới hạn, kể cả khi máy chủ không báo Content-Length.
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_ZIP_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('Gói extension quá lớn');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

const isZip = (b: Buffer): boolean => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const DOWNLOAD_FAILED =
  'Không tải được gói extension CapMonster tự động. Hãy tải file zip theo hướng dẫn trên trang docs.capmonster.cloud rồi thêm ở trang Extension (nút "Thêm file .crx/.zip…").';

/**
 * Tải gói extension Chrome theo link chính thức. Link hiện dẫn tới một trang Google Drive, nên đổi sang
 * đường tải thẳng của Drive. Chỉ nhận file zip thật.
 */
export async function downloadCapMonsterZip(destFile: string, opts: { fetchImpl?: FetchFn; url?: string } = {}): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const get = async (url: string): Promise<Response> => {
    try {
      return await doFetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    } catch {
      throw new Error(DOWNLOAD_FAILED);
    }
  };
  let res = await get(opts.url ?? CAPMONSTER_EXTENSION_URL);
  if (!res.ok) throw new Error(DOWNLOAD_FAILED);
  let buf = await readLimited(res);
  if (!isZip(buf)) {
    const drive = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,100})(?:\/|$)/.exec(res.url);
    if (!drive) throw new Error(DOWNLOAD_FAILED);
    res = await get(`https://drive.usercontent.google.com/download?id=${drive[1]}&export=download`);
    if (!res.ok) throw new Error(DOWNLOAD_FAILED);
    buf = await readLimited(res);
    if (!isZip(buf)) throw new Error(DOWNLOAD_FAILED);
  }
  await writeFile(destFile, buf);
}
