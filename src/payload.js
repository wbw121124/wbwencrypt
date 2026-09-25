// ============================================================================
// payload.js —— 明文载荷二进制格式的唯一归属（构建侧 + 解析侧）
// ----------------------------------------------------------------------------
// 加密前的明文被组装成两种容器，加密/解密两侧都必须遵守同一契约：
//
//   批量容器（magic = "MULT"，版本 1）：
//     'MULT'(4) + ver(1) + count(4, 小端)
//     + 逐文件 [nameLen(2,大端)][name(Utf8)] [mimeLen(2,大端)][mime(Utf8)]
//              [dataLen(4,小端)][data]
//
//   单文件容器（无 magic，按剩余字节自然切分）：
//     [mimeLen(2,大端)][mime(Utf8)] [expectedHash(32)] [compressed...]
//
// 解析失败语义：批量 magic 不匹配返回 null（调用方回落到单文件解析），
// 版本/长度非法抛中文业务错误。
// ============================================================================
import { concatBuffers, uint8FromBuffer } from './crypto.js';

// ---- 批量载荷构建（加密侧）----
// files: [{ name, mime, dataBuffer }]
export function buildBatchPayload(files) {
  const enc = new TextEncoder();
  const parts = [enc.encode('MULT').buffer, new Uint8Array([1]).buffer];
  const cntBuf = new ArrayBuffer(4);
  new DataView(cntBuf).setUint32(0, files.length, true);
  parts.push(cntBuf);
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const nameLen = new ArrayBuffer(2);
    new DataView(nameLen).setUint16(0, nameBytes.length, false);
    parts.push(nameLen, nameBytes.buffer);
    const mimeBytes = enc.encode(f.mime);
    const mimeLen = new ArrayBuffer(2);
    new DataView(mimeLen).setUint16(0, mimeBytes.length, false);
    parts.push(mimeLen, mimeBytes.buffer);
    const dataLenBuf = new ArrayBuffer(4);
    new DataView(dataLenBuf).setUint32(0, f.dataBuffer.byteLength, true);
    parts.push(dataLenBuf, f.dataBuffer);
  }
  return concatBuffers(parts);
}

// ---- 批量载荷解析（解密侧）----
export function parseBatchPayload(buf) {
  const u = uint8FromBuffer(buf);
  if (u.length < 4 || String.fromCharCode(u[0], u[1], u[2], u[3]) !== 'MULT') return null;
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let off = 4;
  const ver = dv.getUint8(off);
  off += 1;
  if (ver !== 1) throw new Error('批量版本不支持');
  const cnt = dv.getUint32(off, true);
  off += 4;
  const files = [];
  for (let i = 0; i < cnt; i++) {
    const nameLen = dv.getUint16(off, false);
    off += 2;
    const name = new TextDecoder().decode(u.subarray(off, off + nameLen));
    off += nameLen;
    const mimeLen = dv.getUint16(off, false);
    off += 2;
    const mime = new TextDecoder().decode(u.subarray(off, off + mimeLen));
    off += mimeLen;
    const dataLen = dv.getUint32(off, true);
    off += 4;
    const data = u.slice(off, off + dataLen).buffer;
    off += dataLen;
    files.push({ name, mime, dataBuffer: data });
  }
  return files;
}

// ---- 单文件载荷解析（解密侧）----
export function parseSinglePayload(buf) {
  const u = uint8FromBuffer(buf);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const mimeLen = dv.getUint16(0, false);
  let off = 2;
  const mime = new TextDecoder().decode(u.subarray(off, off + mimeLen));
  off += mimeLen;
  const expectedHash = u.slice(off, off + 32);
  off += 32;
  const compressedData = u.slice(off).buffer;
  return { mimeType: mime, expectedHash, compressedData };
}
