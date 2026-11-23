import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openCdp } from '../../src/cdp';
import { Core } from '../../src/core';
import { extensionIdFromKey } from '../../src/crx';
import { makeCrx3, makeKey } from '../helpers/crx';

const ENGINES_DIR = join(__dirname, '..', '..', '.engines');
const FUTURE = Math.floor(Date.now() / 1000) + 30 * 86_400;

let core: Core;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'bf-engine-p3-'));
  core = new Core({
    dataDir: join(tmp, 'data'),
    secrets: { encrypt: (s) => s, decrypt: (s) => s },
    enginesDir: ENGINES_DIR,
  });
  await core.init();
  if (!core.info().engineInstalled) throw new Error('Chưa cài nhân: chạy test/engine/install.test.ts trước');
});

afterAll(async () => {
  await core.shutdown();
});

const extensionFiles = (name: string): Record<string, Uint8Array> => ({
  'manifest.json': strToU8(JSON.stringify({ manifest_version: 3, name, version: '1.0', background: { service_worker: 'sw.js' } })),
  'sw.js': strToU8('console.log("sẵn sàng")'),
});

async function extensionTargets(cdpUrl: string, wanted: number): Promise<string[]> {
  const cdp = await openCdp(cdpUrl);
  try {
    let urls: string[] = [];
    for (let i = 0; i < 100; i++) {
      const { targetInfos } = await cdp.call<{ targetInfos: { url: string }[] }>('Target.getTargets');
      urls = targetInfos.map((t) => t.url).filter((u) => u.startsWith('chrome-extension://'));
      if (urls.length >= wanted) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    return urls;
  } finally {
    cdp.close();
  }
}

describe('nhân thật: cookie', () => {
  it('hồ sơ chưa chạy: nhập JSON, bỏ cookie phiên, cookie còn sau khi đóng và xuất lại được', async () => {
    const p = core.createProfile({ name: 'cookie-dung' });
    const r = await core.importCookies(p.id, JSON.stringify([
      { domain: '.example.com', name: 'sid', value: 'abc', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: FUTURE },
      { domain: 'www.example.com', name: 'host', value: '1', hostOnly: true, expirationDate: FUTURE },
      { domain: 'example.org', name: '__Host-h', value: '2', secure: true, path: '/', expirationDate: FUTURE },
      { domain: '.example.com', name: 'phien', value: 'x' },
    ]));
    expect(r).toMatchObject({ imported: 3, failed: 0, sessionSkipped: 1, errors: [] });
    expect(core.launcher.status(p.id)).toBeNull();
    const out = JSON.parse((await core.exportCookies(p.id)).json) as { name: string; domain: string; hostOnly: boolean; sameSite: string; httpOnly: boolean }[];
    expect(out.map((c) => c.name).sort()).toEqual(['__Host-h', 'host', 'sid']);
    expect(out.find((c) => c.name === 'sid')).toMatchObject({ domain: '.example.com', hostOnly: false, sameSite: 'no_restriction', httpOnly: true });
    expect(out.find((c) => c.name === 'host')).toMatchObject({ domain: 'www.example.com', hostOnly: true });
    expect(core.launcher.status(p.id)).toBeNull();
  });

  it('hồ sơ đang chạy: nhập cả cookie phiên, định dạng Netscape, không dừng hồ sơ', async () => {
    const p = core.createProfile({ name: 'cookie-chay' });
    await core.launch(p.id);
    try {
      const text = [`.example.net\tTRUE\t/\tTRUE\t${FUTURE}\ttok\txyz`, 'example.net\tFALSE\t/\tFALSE\t0\tphien\t1'].join('\n');
      const r = await core.importCookies(p.id, text);
      expect(r).toMatchObject({ format: 'netscape', imported: 2, failed: 0, sessionSkipped: 0 });
      expect(core.launcher.status(p.id)).not.toBeNull();
      const out = JSON.parse((await core.exportCookies(p.id)).json) as { name: string; session: boolean }[];
      expect(out.find((c) => c.name === 'phien')).toMatchObject({ session: true });
      expect(out.find((c) => c.name === 'tok')).toMatchObject({ session: false });
    } finally {
      await core.stop(p.id);
    }
  });

  it('xuất từ hồ sơ này rồi nhập vào hồ sơ khác cho cùng bộ cookie', async () => {
    const a = core.createProfile({ name: 'nguon' });
    const b = core.createProfile({ name: 'dich' });
    await core.importCookies(a.id, JSON.stringify([{ domain: '.example.com', name: 'k', value: 'v', expirationDate: FUTURE, secure: true, sameSite: 'lax' }]));
    const exported = await core.exportCookies(a.id);
    expect(await core.importCookies(b.id, exported.json)).toMatchObject({ imported: exported.count, failed: 0, errors: [] });
    expect(JSON.parse((await core.exportCookies(b.id)).json)).toEqual(JSON.parse(exported.json));
  });
});

describe('nhân thật: extension', () => {
  it('extension từ file .crx được nạp với đúng ID tính từ khoá công khai', async () => {
    const key = makeKey();
    const crx = join(tmp, 'vi.crx');
    writeFileSync(crx, makeCrx3(Buffer.from(zipSync(extensionFiles('Ví CRX'))), key));
    const ext = await core.addExtension(crx);
    expect(ext.name).toBe('Ví CRX');
    const p = core.createProfile({ name: 'co-vi', extensionIds: [ext.id] });
    const run = await core.launch(p.id);
    try {
      const urls = await extensionTargets(run.cdpUrl, 1);
      expect(urls.some((u) => u.startsWith(`chrome-extension://${extensionIdFromKey(key)}/`))).toBe(true);
    } finally {
      await core.stop(p.id);
    }
  });

  it('extension gán theo nhóm (từ thư mục) cộng extension riêng đều được nạp; hồ sơ ngoài nhóm thì không', async () => {
    const dir = mkdtempSync(join(tmp, 'ext-src-'));
    for (const [name, data] of Object.entries(extensionFiles('Ví thư mục'))) writeFileSync(join(dir, name), data);
    const fromFolder = await core.addExtension(dir);
    const zip = join(tmp, 'khac.zip');
    writeFileSync(zip, Buffer.from(zipSync(extensionFiles('Ví zip'))));
    const fromZip = await core.addExtension(zip);
    const g = core.createGroup('airdrop');
    core.setGroupExtensions(g.id, [fromFolder.id]);
    const inGroup = core.createProfile({ name: 'trong-nhom', groupId: g.id, extensionIds: [fromZip.id] });
    const outside = core.createProfile({ name: 'ngoai-nhom' });
    const a = await core.launch(inGroup.id);
    const b = await core.launch(outside.id);
    try {
      expect(new Set((await extensionTargets(a.cdpUrl, 2)).map((u) => u.split('/')[2])).size).toBe(2);
      expect(await extensionTargets(b.cdpUrl, 1)).toEqual([]);
    } finally {
      await core.stop(inGroup.id);
      await core.stop(outside.id);
    }
  });
});
