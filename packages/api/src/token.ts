import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

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

/**
 * Thư mục duy nhất mà các công cụ file của MCP được đọc và ghi: BF_MCP_FILE_DIR (đường dẫn tuyệt đối),
 * không thì thư mục `mcp-files` cạnh file token.
 */
export function mcpFilesDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BF_MCP_FILE_DIR) {
    if (!isAbsolute(env.BF_MCP_FILE_DIR)) throw new Error('BF_MCP_FILE_DIR phải là đường dẫn tuyệt đối');
    return resolve(env.BF_MCP_FILE_DIR);
  }
  return join(dirname(env.BF_API_TOKEN_FILE || tokenPath(defaultDataDir())), 'mcp-files');
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
  } catch (e) {
    // Windows: bảo vệ dựa vào ACL riêng của thư mục dữ liệu, chmod không đổi ACL.
    if (process.platform === 'win32') return;
    throw new Error(`Không đặt được quyền riêng tư cho file token tại ${file} (${(e as NodeJS.ErrnoException).code ?? 'lỗi không rõ'})`);
  }
}

/** Phía app: đọc token đang có, hoặc sinh mới. Token mới không bao giờ nằm trong file có quyền rộng hơn 0600. */
export function loadOrCreateToken(file: string): string {
  const existing = readValid(file);
  if (existing) {
    restrict(file);
    return existing;
  }
  const token = randomBytes(32).toString('hex');
  // Ghi vào file tạm mới (tạo độc quyền, 0600) rồi đổi tên đè lên đích: không bao giờ ghi vào inode cũ có quyền lỏng.
  const tmp = join(dirname(file), `.api-token.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, `${token}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return token;
}

/** Phía CLI và MCP: chỉ đọc. Không bao giờ tạo file, không bao giờ đưa nội dung file vào thông báo lỗi. */
export function readToken(file: string): string {
  const token = readValid(file);
  if (!token) throw new Error(`Không đọc được token của API tại ${file}. Hãy mở app Browser Fingerprint ít nhất một lần.`);
  return token;
}
