import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineManager } from '../../src/engine';

export const ENGINES_DIR = join(__dirname, '..', '..', '.engines');

describe('nhân thật', () => {
  it('tải, kiểm SHA-256, giải nén và chạy được --version', async () => {
    const m = new EngineManager({ enginesDir: ENGINES_DIR });
    const exe = m.executablePath() ?? (await m.install());
    const out = execFileSync(exe, ['--version'], { encoding: 'utf8' });
    expect(out).toContain(m.release().version);
  });
});
