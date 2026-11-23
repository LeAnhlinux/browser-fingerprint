import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extensionIdFromKey, parseCrx } from '../src/crx';
import { makeCrx2, makeCrx3, makeKey } from './helpers/crx';

const zip = Buffer.from(zipSync({ 'manifest.json': strToU8('{}') }));
const BAD = 'File không phải .crx hoặc .zip hợp lệ';

describe('parseCrx', () => {
  it('file zip thường: trả nguyên, không có khoá', () => {
    const r = parseCrx(zip);
    expect(r.zip.equals(zip)).toBe(true);
    expect(r.publicKey).toBeNull();
  });

  it('CRX3: tách zip và chọn đúng khoá khớp crx_id trong số nhiều khoá', () => {
    const key = makeKey();
    const r = parseCrx(makeCrx3(zip, key, [makeKey()]));
    expect(r.zip.equals(zip)).toBe(true);
    expect(r.publicKey?.equals(key)).toBe(true);
  });

  it('CRX3 có phần đầu không đọc được: vẫn tách zip, khoá là null', () => {
    const broken = Buffer.from([0xff, 0xff, 0xff]);
    const head = Buffer.alloc(12);
    head.write('Cr24', 0, 'latin1');
    head.writeUInt32LE(3, 4);
    head.writeUInt32LE(broken.length, 8);
    const r = parseCrx(Buffer.concat([head, broken, zip]));
    expect(r.zip.equals(zip)).toBe(true);
    expect(r.publicKey).toBeNull();
  });

  it('CRX2: tách khoá và zip', () => {
    const key = makeKey();
    const r = parseCrx(makeCrx2(zip, key));
    expect(r.zip.equals(zip)).toBe(true);
    expect(r.publicKey?.equals(key)).toBe(true);
  });

  it('CRX2 có độ dài khoá bằng 0: không có khoá (null, không phải buffer rỗng)', () => {
    const head = Buffer.alloc(16);
    head.write('Cr24', 0, 'latin1');
    head.writeUInt32LE(2, 4);
    const r = parseCrx(Buffer.concat([head, zip]));
    expect(r.zip.equals(zip)).toBe(true);
    expect(r.publicKey).toBeNull();
  });

  it('từ chối file lạ, file cụt và phiên bản CRX không biết', () => {
    expect(() => parseCrx(Buffer.from('xin chào, đây không phải file nén'))).toThrow(BAD);
    expect(() => parseCrx(Buffer.alloc(0))).toThrow(BAD);
    const cut = makeCrx3(zip, makeKey()).subarray(0, 40);
    expect(() => parseCrx(cut)).toThrow(BAD);
    const v9 = makeCrx3(zip, makeKey());
    v9.writeUInt32LE(9, 4);
    expect(() => parseCrx(v9)).toThrow(BAD);
  });
});

describe('extensionIdFromKey', () => {
  it('cho 32 ký tự a-p, ổn định theo khoá', () => {
    const key = makeKey();
    const id = extensionIdFromKey(key);
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(extensionIdFromKey(key)).toBe(id);
    expect(extensionIdFromKey(makeKey())).not.toBe(id);
    const hex = createHash('sha256').update(key).digest('hex').slice(0, 32);
    expect(id).toBe([...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join(''));
  });
});
