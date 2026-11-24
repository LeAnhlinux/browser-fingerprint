import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { ProfileUpdate, ProfileView, ProxyView } from '@bf/core';
import { type ApiClient, ApiError } from './client';

export interface CliIo {
  client: ApiClient;
  out(line: string): void;
  err(line: string): void;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
}

const USAGE = `Cách dùng: bf <lệnh> [tuỳ chọn]

  info
  list [--search <chuỗi>] [--group <mã nhóm|none>]
  show <mã hồ sơ>
  create <tên> [--group <mã|none>] [--proxy <mã|none>] [--timezone <tz>] [--lang <tag>] [--accept-lang <ds>] [--notes <chuỗi>]
  update <mã hồ sơ> [--name <tên>] [các tuỳ chọn như create]
  delete <mã hồ sơ>
  start <mã hồ sơ> [--headless]      in địa chỉ CDP (ws://...) của trình duyệt
  stop <mã hồ sơ>
  cookies export <mã hồ sơ> [-o <file>]   không có -o thì in phiên đăng nhập ra màn hình (stdout)
  cookies import <mã hồ sơ> <file>
  groups
  proxies
  proxy check <mã proxy>
  captcha balance                    số dư CapMonster (key nhập trong app: Cài đặt → CapMonster)
  captcha solve <task JSON|@file> [--timeout <giây>]
                                     giải captcha qua CapMonster; task theo tài liệu API CapMonster,
                                     ví dụ '{"type":"TurnstileTask","websiteURL":"...","websiteKey":"..."}'

Tuỳ chọn chung: --json (in JSON), -h/--help
App Browser Fingerprint phải đang mở. Biến môi trường: BF_API_PORT, BF_API_TOKEN_FILE.`;

class UsageError extends Error {}

const OPTIONS = {
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  headless: { type: 'boolean' },
  search: { type: 'string' },
  group: { type: 'string' },
  proxy: { type: 'string' },
  name: { type: 'string' },
  timezone: { type: 'string' },
  lang: { type: 'string' },
  'accept-lang': { type: 'string' },
  notes: { type: 'string' },
  output: { type: 'string', short: 'o' },
  timeout: { type: 'string' },
} as const;

type Values = { [K in keyof typeof OPTIONS]?: string | boolean };

function ref(value: string | boolean | undefined): string | null | undefined {
  if (typeof value !== 'string') return undefined;
  return value === 'none' ? null : value;
}

/** Chỉ các trường người dùng thực sự nêu trên dòng lệnh. */
function profileFields(v: Values): ProfileUpdate {
  const fields: ProfileUpdate = {};
  if (typeof v.name === 'string') fields.name = v.name;
  const groupId = ref(v.group);
  if (groupId !== undefined) fields.groupId = groupId;
  const proxyId = ref(v.proxy);
  if (proxyId !== undefined) fields.proxyId = proxyId;
  if (typeof v.timezone === 'string') fields.timezone = v.timezone;
  if (typeof v.lang === 'string') fields.lang = v.lang;
  if (typeof v['accept-lang'] === 'string') fields.acceptLang = v['accept-lang'];
  if (typeof v.notes === 'string') fields.notes = v.notes;
  return fields;
}

function profileLine(p: ProfileView): string {
  const status = p.run ? (p.run.headless ? 'đang chạy ẩn' : 'đang chạy') : 'sẵn sàng';
  return `${p.id}\t${p.name}\t${status}`;
}

function proxyLine(x: ProxyView): string {
  const status =
    x.lastStatus === 'ok'
      ? ['sống', x.lastIp, x.lastCountry, x.lastTimezone].filter(Boolean).join(' · ')
      : x.lastStatus === 'fail'
        ? `lỗi: ${x.lastError ?? 'không rõ'}`
        : 'chưa kiểm tra';
  return `${x.id}\t${x.protocol}://${x.host}:${x.port}\t${status}`;
}

function need(args: string[], count: number): void {
  if (args.length !== count) throw new UsageError('Sai số tham số');
}

async function dispatch(positionals: string[], v: Values, io: CliIo): Promise<void> {
  const { client } = io;
  const json = v.json === true;
  const print = (value: unknown): void => io.out(JSON.stringify(value, null, 2));
  const [command, ...args] = positionals;

  switch (command) {
    case 'info': {
      need(args, 0);
      const info = await client.info();
      if (json) return print(info);
      io.out(`Nhân: ${info.engineVersion} (${info.engineInstalled ? 'đã cài' : 'chưa cài'})`);
      io.out(`Hệ điều hành: ${info.hostPlatform}`);
      io.out(`API: v${info.apiVersion}`);
      return;
    }
    case 'list': {
      need(args, 0);
      const groupId = ref(v.group);
      const profiles = await client.listProfiles({
        ...(typeof v.search === 'string' ? { search: v.search } : {}),
        ...(groupId !== undefined ? { groupId } : {}),
      });
      if (json) return print(profiles);
      for (const p of profiles) io.out(profileLine(p));
      return;
    }
    case 'show':
      need(args, 1);
      return print(await client.getProfile(args[0]));
    case 'create': {
      need(args, 1);
      const created = await client.createProfile({ ...profileFields(v), name: args[0] });
      return json ? print(created) : io.out(created.id);
    }
    case 'update': {
      need(args, 1);
      const fields = profileFields(v);
      if (Object.keys(fields).length === 0) throw new UsageError('Chưa nêu thay đổi nào');
      const updated = await client.updateProfile(args[0], fields);
      return json ? print(updated) : io.out(profileLine(updated));
    }
    case 'delete':
      need(args, 1);
      await client.deleteProfile(args[0]);
      return json ? print({ ok: true }) : io.out(`Đã xoá ${args[0]}`);
    case 'start': {
      need(args, 1);
      const run = await client.startProfile(args[0], v.headless === true ? { headless: true } : {});
      return json ? print(run) : io.out(run.cdpUrl);
    }
    case 'stop':
      need(args, 1);
      await client.stopProfile(args[0]);
      return json ? print({ ok: true }) : io.out(`Đã dừng ${args[0]}`);
    case 'cookies': {
      const [action, id, file] = args;
      if (action === 'export') {
        need(args, 2);
        const { count, cookies } = await client.exportCookies(id);
        if (typeof v.output !== 'string') return print(cookies);
        await io.writeFile(v.output, JSON.stringify(cookies, null, 2));
        return json ? print({ count, file: v.output }) : io.out(`Đã lưu ${count} cookie vào ${v.output}`);
      }
      if (action === 'import') {
        need(args, 3);
        let text: string;
        try {
          text = await io.readFile(file);
        } catch {
          throw new ApiError(`Không đọc được file ${file}`, 0);
        }
        const r = await client.importCookies(id, text);
        if (json) return print(r);
        io.out(`Đã nhập ${r.imported} cookie; ${r.failed} bị từ chối; bỏ qua ${r.sessionSkipped} cookie phiên; ${r.errors.length} lỗi phân tích`);
        for (const e of r.errors) io.out(`${r.format === 'netscape' ? 'Dòng' : 'Mục'} ${e.index}: ${e.reason}`);
        return;
      }
      throw new UsageError('Lệnh cookies cần export hoặc import');
    }
    case 'groups': {
      need(args, 0);
      const groups = await client.listGroups();
      if (json) return print(groups);
      for (const g of groups) io.out(`${g.id}\t${g.name}`);
      return;
    }
    case 'proxies': {
      need(args, 0);
      const proxies = await client.listProxies();
      if (json) return print(proxies);
      for (const x of proxies) io.out(proxyLine(x));
      return;
    }
    case 'proxy': {
      if (args[0] !== 'check') throw new UsageError('Lệnh proxy cần check');
      need(args, 2);
      const checked = await client.checkProxy(args[1]);
      return json ? print(checked) : io.out(proxyLine(checked));
    }
    case 'captcha': {
      if (args[0] === 'balance') {
        need(args, 1);
        const { balance } = await client.captchaBalance();
        return json ? print({ balance }) : io.out(`Số dư CapMonster: $${balance}`);
      }
      if (args[0] !== 'solve') throw new UsageError('Lệnh captcha cần balance hoặc solve');
      need(args, 2);
      let text = args[1];
      if (text.startsWith('@')) {
        try {
          text = await io.readFile(text.slice(1));
        } catch {
          throw new ApiError(`Không đọc được file ${text.slice(1)}`, 0);
        }
      }
      let task: unknown;
      try {
        task = JSON.parse(text);
      } catch {
        throw new UsageError('task phải là JSON hợp lệ');
      }
      let timeoutMs: number | undefined;
      if (typeof v.timeout === 'string') {
        const seconds = Number(v.timeout);
        if (!Number.isInteger(seconds) || seconds <= 0) throw new UsageError('--timeout phải là số giây nguyên dương');
        timeoutMs = seconds * 1000;
      }
      const r = await client.solveCaptcha(task, timeoutMs);
      return json ? print(r) : io.out(JSON.stringify(r.solution, null, 2));
    }
    default:
      throw new UsageError(`Không có lệnh: ${String(command).slice(0, 40)}`);
  }
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    let parsed: { values: Values; positionals: string[] };
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    } catch {
      throw new UsageError('Tuỳ chọn không hợp lệ');
    }
    if (parsed.values.help === true) {
      io.out(USAGE);
      return 0;
    }
    if (parsed.positionals.length === 0) throw new UsageError('Thiếu lệnh');
    await dispatch(parsed.positionals, parsed.values, io);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(e.message);
      io.err(USAGE);
      return 2;
    }
    io.err(`Lỗi: ${e instanceof Error ? e.message : 'không rõ'}`);
    return 1;
  }
}

/**
 * Ghi file chứa bí mật (cookie phiên đăng nhập) với quyền 0600 cả khi file đích đã tồn tại:
 * ghi vào file tạm mới tạo độc quyền 0600 cùng thư mục rồi đổi tên đè lên đích,
 * nên dữ liệu không bao giờ nằm trong file có quyền rộng hơn.
 */
export async function writePrivateFile(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, data, { mode: 0o600, flag: 'wx' });
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
