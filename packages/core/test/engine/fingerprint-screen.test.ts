import { mkdtempSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openCdp } from '../../src/cdp';
import { Core } from '../../src/core';

const ENGINES_DIR = join(__dirname, '..', '..', '.engines');

let core: Core;
let inner: Server;
let outer: Server;
let page = '';

const READ = `JSON.stringify([screen.width, screen.height, devicePixelRatio, matchMedia('(device-width: 1366px)').matches])`;

beforeAll(async () => {
  core = new Core({
    dataDir: join(mkdtempSync(join(tmpdir(), 'bf-engine-fp-')), 'data'),
    secrets: { encrypt: (s) => s, decrypt: (s) => s },
    enginesDir: ENGINES_DIR,
  });
  await core.init();
  if (!core.info().engineInstalled) throw new Error('Chưa cài nhân: chạy test/engine/install.test.ts trước');
  // Iframe ở 127.0.0.1, trang chứa ở localhost: hai "site" khác nhau.
  inner = createServer((_q, r) => {
    r.setHeader('content-type', 'text/html');
    r.end(`<script>parent.postMessage(${READ}, '*')</script>`);
  });
  await new Promise<void>((r) => inner.listen(0, '127.0.0.1', r));
  outer = createServer((_q, r) => {
    r.setHeader('content-type', 'text/html');
    r.end(`<script>window.EARLY = ${READ}; addEventListener('message', (e) => { window.IFR = e.data });</script>
      <iframe src="http://127.0.0.1:${(inner.address() as AddressInfo).port}/"></iframe><a id="moi" href="/?tab" target="_blank">tab</a>`);
  });
  await new Promise<void>((r) => outer.listen(0, '127.0.0.1', r));
  page = `http://localhost:${(outer.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await core.shutdown();
  inner.close();
  outer.close();
});

describe('nhân thật: đo vân tay', () => {
  it('đọc được GPU, CPU, RAM; đổi vân tay thì ra bộ khác', async () => {
    const p = core.createProfile({ name: 'do', platform: 'windows', timezone: 'Asia/Tokyo', lang: 'ja-JP', acceptLang: 'ja-JP,ja' });
    const a = await core.measureFingerprint(p.id);
    expect(a.userAgent).toContain('Windows NT');
    expect(a.userAgent).not.toContain('Headless');
    expect(a.platform).toBe('Win32');
    expect(a.cores).toBeGreaterThan(0);
    expect([8, 16, 32]).toContain(a.memory);
    expect(a.gpuRenderer).toMatch(/ANGLE/);
    expect(a.timezone).toBe('Asia/Tokyo');
    expect(a.languages[0]).toBe('ja-JP');
    expect(core.getProfile(p.id).fingerprint?.gpuRenderer).toBe(a.gpuRenderer);
    // Vài seed khác nhau phải ra ít nhất hai bộ (GPU, nhân CPU) khác nhau.
    const seen = new Set([`${a.gpuRenderer}|${a.cores}`]);
    for (let i = 0; i < 3; i++) {
      core.regenerateFingerprint(p.id);
      const b = await core.measureFingerprint(p.id);
      seen.add(`${b.gpuRenderer}|${b.cores}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  }, 120_000);
});

describe('nhân thật: màn hình giả', () => {
  it('trang chính, script chạy sớm, iframe khác site, tab có sẵn, tab mới và tab mở từ link đều thấy màn hình giả', async () => {
    const p = core.createProfile({ name: 'manhinh', screenWidth: 1366, screenHeight: 768, screenScale: 2 });
    const run = await core.launch(p.id, { headless: true });
    const browser = await openCdp(run.cdpUrl);
    try {
      const want = JSON.stringify([1366, 768, 2, true]);
      // Tab có sẵn lúc khởi động (người dùng gõ địa chỉ vào đây) và tab mở mới theo kiểu Playwright:
      // tạo tab trống rồi mới điều hướng.
      const { targetInfos } = await browser.call<{ targetInfos: { targetId: string; type: string }[] }>('Target.getTargets');
      const first = targetInfos.find((t) => t.type === 'page')!.targetId;
      const { targetId: second } = await browser.call<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
      for (const targetId of [first, second]) {
        const cdp = await openCdp(`ws://127.0.0.1:${run.cdpPort}/devtools/page/${targetId}`);
        try {
          await cdp.call('Page.navigate', { url: page });
          let ifr: unknown;
          for (let i = 0; i < 50 && !ifr; i++) {
            await new Promise((r) => setTimeout(r, 100));
            ifr = (await cdp.call<{ result: { value?: string } }>('Runtime.evaluate', { expression: 'window.IFR', returnByValue: true })).result.value;
          }
          const early = (await cdp.call<{ result: { value?: string } }>('Runtime.evaluate', { expression: 'window.EARLY', returnByValue: true })).result.value;
          expect(early).toBe(want);
          expect(ifr).toBe(want);
        } finally {
          cdp.close();
        }
      }
      // Bấm link mở tab mới như người dùng: tab mới không được treo và cũng thấy màn hình giả.
      const opener = await openCdp(`ws://127.0.0.1:${run.cdpPort}/devtools/page/${first}`);
      try {
        await opener.call('Runtime.evaluate', { expression: "document.getElementById('moi').click()", userGesture: true });
      } finally {
        opener.close();
      }
      let opened: string | undefined;
      for (let i = 0; i < 50 && !opened; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const { targetInfos: now } = await browser.call<{ targetInfos: { targetId: string; type: string; url: string }[] }>('Target.getTargets');
        opened = now.find((t) => t.type === 'page' && t.url.endsWith('?tab'))?.targetId;
      }
      expect(opened).toBeDefined();
      const tab = await openCdp(`ws://127.0.0.1:${run.cdpPort}/devtools/page/${opened}`, { timeoutMs: 3000 });
      try {
        let early: string | undefined;
        for (let i = 0; i < 30 && !early; i++) {
          early = (await tab.call<{ result: { value?: string } }>('Runtime.evaluate', { expression: 'window.EARLY', returnByValue: true })).result.value;
          if (!early) await new Promise((r) => setTimeout(r, 100));
        }
        expect(early).toBe(want);
      } finally {
        tab.close();
      }
    } finally {
      browser.close();
      await core.stop(p.id);
    }
  }, 60_000);
});
