import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { extractArchive } from './engine-extract';

export interface EngineRelease {
  version: string;
  url: string;
  sha256: string;
  archive: 'dmg' | 'zip';
}

export type ExtractFn = (archivePath: string, destDir: string, kind: 'dmg' | 'zip') => Promise<string>;

export class EngineError extends Error {}

const BASE = 'https://github.com/adryfish/fingerprint-chromium/releases/download';

export const ENGINE_MANIFEST: Partial<Record<NodeJS.Platform, EngineRelease>> = {
  darwin: {
    version: '148.0.7778.215',
    url: `${BASE}/148.0.7778.215/ungoogled-chromium_148.0.7778.215-1.1_macos.dmg`,
    sha256: 'b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679',
    archive: 'dmg',
  },
  win32: {
    version: '150.0.7871.186',
    url: `${BASE}/150.0.7871.186/ungoogled-chromium_150.0.7871.186-1.1_windows_x64.zip`,
    sha256: '4d549c326e51ebbabf562fd365eb5380d9d4a81200da2c60f075c688d9a77e03',
    archive: 'zip',
  },
};

export interface EngineOptions {
  enginesDir: string;
  platform?: NodeJS.Platform;
  manifest?: Partial<Record<NodeJS.Platform, EngineRelease>>;
  fetchImpl?: typeof fetch;
  extract?: ExtractFn;
}

const MARKER = 'executable.txt';

export class EngineManager {
  private enginesDir: string;
  private platform: NodeJS.Platform;
  private manifest: Partial<Record<NodeJS.Platform, EngineRelease>>;
  private fetchImpl: typeof fetch;
  private extract: ExtractFn;

  constructor(opts: EngineOptions) {
    this.enginesDir = opts.enginesDir;
    this.platform = opts.platform ?? process.platform;
    this.manifest = opts.manifest ?? ENGINE_MANIFEST;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.extract = opts.extract ?? extractArchive;
  }

  release(): EngineRelease {
    const r = this.manifest[this.platform];
    if (!r) throw new EngineError(`Chưa hỗ trợ hệ điều hành ${this.platform}`);
    return r;
  }

  executablePath(): string | null {
    const dir = join(this.enginesDir, this.release().version);
    const marker = join(dir, MARKER);
    if (!existsSync(marker)) return null;
    const exe = join(dir, readFileSync(marker, 'utf8').trim());
    return existsSync(exe) ? exe : null;
  }

  async install(onProgress?: (received: number, total: number) => void): Promise<string> {
    const rel = this.release();
    await mkdir(this.enginesDir, { recursive: true });
    const tmp = join(this.enginesDir, `${rel.version}.download`);
    const dest = join(this.enginesDir, rel.version);
    try {
      const res = await this.fetchImpl(rel.url);
      if (!res.ok || !res.body) throw new EngineError(`Tải nhân thất bại (HTTP ${res.status})`);
      const total = Number(res.headers.get('content-length') ?? 0);
      const hash = createHash('sha256');
      let received = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          received += chunk.length;
          onProgress?.(received, total);
          cb(null, chunk);
        },
      });
      // pipeline đóng/huỷ mọi stream khi có lỗi, không treo và không để lỗi chưa được bắt
      await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(tmp));
      if (hash.digest('hex') !== rel.sha256) throw new EngineError('SHA-256 của nhân không khớp, đã huỷ file tải');
      await rm(dest, { recursive: true, force: true });
      await mkdir(dest, { recursive: true });
      const exe = await this.extract(tmp, dest, rel.archive);
      await writeFile(join(dest, MARKER), relative(dest, exe));
      return exe;
    } catch (err) {
      await rm(dest, { recursive: true, force: true });
      throw err instanceof EngineError ? err : new EngineError(`Cài nhân thất bại: ${(err as Error).message}`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}
