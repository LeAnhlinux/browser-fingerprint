import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PORT = 47800;
const APP_DIR_NAME = 'Browser Fingerprint';
const TOKEN_FILE = 'api-token';
const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Thư mục dữ liệu mặc định của app (trùng với app.getPath('userData') của Electron). */
export function defaultDataDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', APP_DIR_NAME);
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), APP_DIR_NAME);
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), APP_DIR_NAME);
}

export function tokenPath(dataDir: string): string {
  return join(dataDir, TOKEN_FILE);
}

function readValid(file: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const token = raw.trim();
  return TOKEN_RE.test(token) ? token : null;
}

function restrict(file: string): void {
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows không có quyền kiểu POSIX; bỏ qua.
  }
}

/** Phía app: đọc token đang có, hoặc sinh mới. File luôn được siết về quyền 0600. */
export function loadOrCreateToken(file: string): string {
  const existing = readValid(file);
  if (existing) {
    restrict(file);
    return existing;
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  restrict(file);
  return token;
}

/** Phía CLI và MCP: chỉ đọc. Không bao giờ tạo file, không bao giờ đưa nội dung file vào thông báo lỗi. */
export function readToken(file: string): string {
  const token = readValid(file);
  if (!token) throw new Error(`Không đọc được token của API tại ${file}. Hãy mở app Browser Fingerprint ít nhất một lần.`);
  return token;
}
