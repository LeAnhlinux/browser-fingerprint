import { createHash } from 'node:crypto';

export interface CrxParts {
  zip: Buffer;
  /** Khoá công khai của extension (DER), dùng để giữ ID gốc; null nếu file không mang khoá. */
  publicKey: Buffer | null;
}

const BAD = 'File không phải .crx hoặc .zip hợp lệ';
const ZIP_MAGIC = 0x04034b50;

function readVarint(buf: Buffer, start: number): [value: number, next: number] {
  let value = 0;
  let pos = start;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new Error(BAD);
    const b = buf[pos++];
    value += (b & 0x7f) * 2 ** (7 * i);
    if (!(b & 0x80)) return [value, pos];
  }
  throw new Error(BAD);
}

/** Đọc một thông điệp protobuf, chỉ trả các trường length-delimited (đủ cho phần đầu CRX3). */
function lengthDelimited(buf: Buffer): { no: number; data: Buffer }[] {
  const out: { no: number; data: Buffer }[] = [];
  let pos = 0;
  while (pos < buf.length) {
    let tag: number;
    [tag, pos] = readVarint(buf, pos);
    const wire = tag % 8;
    if (wire === 0) {
      [, pos] = readVarint(buf, pos);
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else if (wire === 2) {
      let len: number;
      [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw new Error(BAD);
      out.push({ no: Math.floor(tag / 8), data: buf.subarray(pos, pos + len) });
      pos += len;
    } else {
      throw new Error(BAD);
    }
  }
  if (pos !== buf.length) throw new Error(BAD);
  return out;
}

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

/**
 * CrxFileHeader: trường 2 (sha256_with_rsa) và 3 (sha256_with_ecdsa) là các AsymmetricKeyProof
 * { 1: public_key, 2: signature }; trường 10000 (signed_header_data) là SignedData { 1: crx_id }.
 * Khoá của extension là khoá có 16 byte đầu của SHA-256 trùng crx_id.
 */
function keyFromHeader(header: Buffer): Buffer | null {
  const top = lengthDelimited(header);
  const signed = top.find((f) => f.no === 10000);
  const crxId = signed ? lengthDelimited(signed.data).find((f) => f.no === 1)?.data : undefined;
  if (!crxId || crxId.length !== 16) return null;
  for (const proof of top.filter((f) => f.no === 2 || f.no === 3)) {
    const key = lengthDelimited(proof.data).find((f) => f.no === 1)?.data;
    if (key && sha256(key).subarray(0, 16).equals(crxId)) return Buffer.from(key);
  }
  return null;
}

export function extensionIdFromKey(key: Buffer): string {
  return [...sha256(key).subarray(0, 16)].map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join('');
}

export function parseCrx(buf: Buffer): CrxParts {
  if (buf.length >= 4 && buf.readUInt32LE(0) === ZIP_MAGIC) return { zip: buf, publicKey: null };
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error(BAD);
  const version = buf.readUInt32LE(4);
  if (version === 3) {
    const end = 12 + buf.readUInt32LE(8);
    if (end > buf.length) throw new Error(BAD);
    let publicKey: Buffer | null = null;
    try {
      publicKey = keyFromHeader(buf.subarray(12, end));
    } catch {
      publicKey = null; // không đọc được phần đầu: vẫn cài được, chỉ là ID không giữ theo khoá
    }
    return { zip: buf.subarray(end), publicKey };
  }
  if (version === 2) {
    const keyLen = buf.readUInt32LE(8);
    const start = 16 + keyLen + buf.readUInt32LE(12);
    if (start > buf.length) throw new Error(BAD);
    return { zip: buf.subarray(start), publicKey: Buffer.from(buf.subarray(16, 16 + keyLen)) };
  }
  throw new Error(BAD);
}
