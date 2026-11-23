import { createHash, generateKeyPairSync } from 'node:crypto';

/** Khoá công khai RSA dạng DER (SubjectPublicKeyInfo), như trong phần đầu file CRX. */
export function makeKey(): Buffer {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return publicKey.export({ type: 'spki', format: 'der' });
}

function varint(n: number): Buffer {
  const out: number[] = [];
  while (n > 127) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

/** Một trường protobuf kiểu length-delimited. */
function field(no: number, data: Buffer): Buffer {
  return Buffer.concat([varint(no * 8 + 2), varint(data.length), data]);
}

/** CRX3: "Cr24", phiên bản 3, độ dài phần đầu, phần đầu protobuf (CrxFileHeader), rồi zip. */
export function makeCrx3(zip: Buffer, key: Buffer, otherKeys: Buffer[] = []): Buffer {
  const crxId = createHash('sha256').update(key).digest().subarray(0, 16);
  const proofs = [...otherKeys, key].map((k) => field(2, Buffer.concat([field(1, k), field(2, Buffer.from('chữ ký giả'))])));
  const header = Buffer.concat([...proofs, field(10000, field(1, crxId))]);
  const head = Buffer.alloc(12);
  head.write('Cr24', 0, 'latin1');
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(header.length, 8);
  return Buffer.concat([head, header, zip]);
}

/** CRX2: "Cr24", phiên bản 2, độ dài khoá, độ dài chữ ký, khoá, chữ ký, rồi zip. */
export function makeCrx2(zip: Buffer, key: Buffer): Buffer {
  const sig = Buffer.from('chữ ký giả');
  const head = Buffer.alloc(16);
  head.write('Cr24', 0, 'latin1');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(key.length, 8);
  head.writeUInt32LE(sig.length, 12);
  return Buffer.concat([head, key, sig, zip]);
}
