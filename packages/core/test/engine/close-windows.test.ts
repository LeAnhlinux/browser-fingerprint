import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openCdp } from '../../src/cdp';
import { Core } from '../../src/core';

const ENGINES_DIR = join(__dirname, '..', '..', '.engines');

let core: Core;

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'bf-engine-close-'));
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

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return cond();
}

describe('nhân thật: đóng hết cửa sổ', () => {
  it('đóng mọi tab của hồ sơ có cửa sổ thì hồ sơ tự dừng', async () => {
    const p = core.createProfile({ name: 'dong-cua-so' });
    const run = await core.launch(p.id);
    const cdp = await openCdp(run.cdpUrl);
    try {
      type T = { targetId: string; type: string };
      let pages: T[] = [];
      for (let i = 0; i < 50 && pages.length === 0; i++) {
        const { targetInfos } = await cdp.call<{ targetInfos: T[] }>('Target.getTargets');
        pages = targetInfos.filter((t) => t.type === 'page');
        if (pages.length === 0) await new Promise((r) => setTimeout(r, 100));
      }
      expect(pages.length).toBeGreaterThan(0);
      // Chờ bộ theo dõi thấy tab trước khi đóng.
      await new Promise((r) => setTimeout(r, 1500));
      expect(core.getProfile(p.id)!.run).not.toBeNull();
      for (const t of pages) await cdp.call('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
    } finally {
      cdp.close();
    }
    expect(await waitFor(() => core.getProfile(p.id)!.run === null, 10_000)).toBe(true);
  }, 30_000);

  it('lần mở ẩn không có tab vẫn chạy bình thường', async () => {
    const p = core.createProfile({ name: 'an' });
    await core.launch(p.id, { headless: true });
    await new Promise((r) => setTimeout(r, 3000));
    expect(core.getProfile(p.id)!.run).not.toBeNull();
    await core.stop(p.id);
  }, 30_000);
});
