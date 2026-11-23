import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCdp } from './cdp';
import type { FingerprintSnapshot } from './types';

export type ProbeResult = Omit<FingerprintSnapshot, 'measuredAt' | 'engineVersion'>;

const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

const READ = `(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    cores: navigator.hardwareConcurrency ?? null,
    memory: navigator.deviceMemory ?? null,
    gpuVendor: ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : null,
    gpuRenderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null,
    languages: [...navigator.languages],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
})()`;

/**
 * Mở ẩn nhân với đúng tham số vân tay của hồ sơ, trên một thư mục dữ liệu tạm (không đụng dữ liệu hồ sơ,
 * chạy được cả khi hồ sơ đang mở), rồi đọc lại những gì trang web thấy.
 * Trang đo nằm trên 127.0.0.1 (trang "an toàn" nên deviceMemory có giá trị). Mọi kết nối ra ngoài
 * bị đẩy vào một proxy chết, để lần đo không gửi gì ra Internet bằng IP thật.
 */
export async function probeFingerprint(exe: string, fingerprintArgs: string[], timeoutMs = 20_000): Promise<ProbeResult> {
  const dir = await mkdtemp(join(tmpdir(), 'bf-probe-'));
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const child = spawn(
    exe,
    [
      `--user-data-dir=${dir}`,
      ...fingerprintArgs,
      '--headless=new',
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--proxy-server=http://127.0.0.1:9',
    ],
    { stdio: 'ignore' },
  );
  const exited = new Promise<never>((_, reject) => {
    child.once('exit', (code) => reject(new Error(`Nhân thoát khi đo (mã ${code})`)));
    child.once('error', (e) => reject(new Error(`Không chạy được nhân: ${e.message}`)));
  });
  exited.catch(() => {});
  const work = async (): Promise<ProbeResult> => {
    let cdpPort = 0;
    let path = '';
    const deadline = Date.now() + timeoutMs;
    while (!cdpPort) {
      if (Date.now() > deadline) throw new Error('Nhân không mở cổng CDP kịp thời gian');
      const raw = await readFile(join(dir, 'DevToolsActivePort'), 'utf8').catch(() => '');
      const [p, pth] = raw.split('\n');
      if (Number(p) > 0 && pth) {
        cdpPort = Number(p);
        path = pth.trim();
      } else await new Promise((r) => setTimeout(r, 100));
    }
    const browser = await openCdp(`ws://127.0.0.1:${cdpPort}${path}`);
    try {
      const { targetId } = await browser.call<{ targetId: string }>('Target.createTarget', { url: `http://127.0.0.1:${port}/` });
      // openCdp không hỗ trợ phiên con, nên mở thẳng websocket của tab.
      const page = await openCdp(`ws://127.0.0.1:${cdpPort}/devtools/page/${targetId}`);
      try {
        for (let i = 0; i < 50; i++) {
          const r = await page.call<{ result: { value?: string } }>('Runtime.evaluate', {
            expression: 'location.href + "|" + document.readyState',
            returnByValue: true,
          });
          if (String(r.result.value).startsWith(`http://127.0.0.1:${port}/|complete`)) break;
          await new Promise((res) => setTimeout(res, 100));
        }
        const r = await page.call<{ result: { value?: ProbeResult } }>('Runtime.evaluate', { expression: READ, returnByValue: true });
        if (!r.result.value) throw new Error('Không đọc được thông số từ trang đo');
        return r.result.value;
      } finally {
        page.close();
      }
    } finally {
      browser.close();
    }
  };
  try {
    return await Promise.race([work(), exited]);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    server.close();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
