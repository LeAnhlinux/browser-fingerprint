import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server as ProxyServer } from 'proxy-chain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Core } from '../../src/core';

const ENGINES_DIR = join(__dirname, '..', '..', '.engines');

const CANVAS_HASH = `(async () => {
  const c = document.createElement('canvas');
  c.width = 240; c.height = 60;
  const g = c.getContext('2d');
  g.textBaseline = 'top';
  g.font = '16px Arial';
  g.fillStyle = '#f60';
  g.fillRect(10, 10, 100, 30);
  g.fillStyle = '#069';
  g.fillText('fingerprint ✓ 123', 4, 20);
  // crypto.subtle không có trên about:blank (ngữ cảnh không an toàn), nên dùng hash thuần JS (cyrb53).
  const str = c.toDataURL();
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0') + ':' + str.length;
})()`;

interface Target {
  webSocketDebuggerUrl: string;
}

async function evaluate(cdpPort: number, expression: string, url = 'about:blank'): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const target = (await res.json()) as Target;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.addEventListener('open', () =>
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })),
    );
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== 1) return;
      ws.close();
      if (msg.result?.exceptionDetails) reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
      else resolve(msg.result?.result?.value);
    });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket lỗi')));
  });
}

let core: Core;

beforeAll(async () => {
  core = new Core({
    dataDir: mkdtempSync(join(tmpdir(), 'bf-e2e-')),
    enginesDir: ENGINES_DIR,
    secrets: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
  });
  await core.init();
  if (!core.info().engineInstalled) await core.installEngine();
});

afterAll(async () => {
  await core.shutdown();
});

describe('dấu vân tay với nhân thật', () => {
  it('hai hồ sơ khác seed cho hash canvas khác nhau', async () => {
    const a = core.createProfile({ name: 'a' });
    const b = core.createProfile({ name: 'b' });
    const [ra, rb] = await Promise.all([core.launch(a.id), core.launch(b.id)]);
    const [ha, hb] = await Promise.all([evaluate(ra.cdpPort, CANVAS_HASH), evaluate(rb.cdpPort, CANVAS_HASH)]);
    await Promise.all([core.stop(a.id), core.stop(b.id)]);
    expect(typeof ha).toBe('string');
    expect(ha).not.toBe(hb);
  });

  it('cùng một hồ sơ cho hash canvas giống nhau giữa hai lần mở', async () => {
    const p = core.createProfile({ name: 'stable' });
    const first = await evaluate((await core.launch(p.id)).cdpPort, CANVAS_HASH);
    await core.stop(p.id);
    const second = await evaluate((await core.launch(p.id)).cdpPort, CANVAS_HASH);
    await core.stop(p.id);
    expect(second).toBe(first);
  });

  it('múi giờ và ngôn ngữ của hồ sơ có hiệu lực', async () => {
    const p = core.createProfile({ name: 'tz', timezone: 'Asia/Tokyo', lang: 'ja-JP', acceptLang: 'ja-JP,ja' });
    const { cdpPort } = await core.launch(p.id);
    const tz = await evaluate(cdpPort, 'Intl.DateTimeFormat().resolvedOptions().timeZone');
    const lang = await evaluate(cdpPort, 'navigator.language');
    await core.stop(p.id);
    expect(tz).toBe('Asia/Tokyo');
    expect(lang).toBe('ja-JP');
  });

  it('request của trình duyệt đi qua proxy có xác thực', async () => {
    const seenHosts: string[] = [];
    const upstream = new ProxyServer({
      port: 0,
      host: '127.0.0.1',
      prepareRequestFunction: ({ username, password, hostname }) => {
        if (username === 'user' && password === 'pass') seenHosts.push(hostname);
        return { requestAuthentication: username !== 'user' || password !== 'pass' };
      },
    });
    await upstream.listen();
    try {
      const x = core.createProxy({ protocol: 'http', host: '127.0.0.1', port: upstream.port, username: 'user', password: 'pass' });
      const p = core.createProfile({ name: 'proxied', proxyId: x.id });
      const { cdpPort } = await core.launch(p.id);
      await evaluate(cdpPort, 'document.readyState', 'http://bf-proxy-check.test/');
      await new Promise((r) => setTimeout(r, 2000));
      await core.stop(p.id);
      expect(seenHosts).toContain('bf-proxy-check.test');
    } finally {
      await upstream.close(true);
    }
  });
});
