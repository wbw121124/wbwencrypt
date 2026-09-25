// ============================================================================
// crypto.js —— wbwEncrypt 加密核心
// ----------------------------------------------------------------------------
// 借鉴 StaticShield 的「密码派生解密闭环 + 自描述载荷」设计理念：
//   - 密码模式：salt/迭代次数内嵌于密文头部，解密时读取并重派生密钥（真正闭环）
//   - AES-GCM 内建认证（AEAD），无需额外 HMAC
//   - 自描述 Magic + 版本号头部，便于格式演进与报错定位
//   - 分片加密：大文件分块，逐块 AES-GCM，支持进度回调
//   纯密钥（Base64 raw key）模式保持与旧版兼容（回退解密）。
// ============================================================================

// ---- 头部常量 ----
export const MAGIC = [0x57, 0x42, 0x57, 0x45, 0x4e, 0x43, 0x30, 0x31]; // "WBWENC01"
// 格式版本：v3 在头部记录 chunkSize（修复多分片解密）；v2 无 chunkSize，仅支持单分片
export const VERSION = 3;
export const LEGACY_VERSION = 2;

export const MODE_KEY = 1;          // 密钥模式（raw AES-256 key）
export const MODE_PASSWORD = 2;     // 密码模式（PBKDF2 派生）

export const SALT_LEN = 16;
export const IV_LEN = 12;
export const TAG_LEN = 16;          // AES-GCM 认证标签长度
export const PBKDF2_ITERATIONS = 1000000; // 对标业界标准（StaticShield 亦为 1,000,000）
export const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024; // 8MB / 块

// PBKDF2 迭代次数上下限：防恶意文件用超大迭代次数卡死主线程，也防误传过小值
export const MIN_PBKDF2_ITERATIONS = 1000;
export const MAX_PBKDF2_ITERATIONS = 5000000;

// ---- 输入校验（统一抛中文业务错误，避免原生英文异常直达用户）----
function assertIterations(iterations) {
  if (!Number.isInteger(iterations)
    || iterations < MIN_PBKDF2_ITERATIONS
    || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new Error(`迭代次数不合法：需在 ${MIN_PBKDF2_ITERATIONS} ~ ${MAX_PBKDF2_ITERATIONS} 之间`);
  }
}

function assertChunkSize(chunkSize) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > 0xffffffff) {
    throw new Error('分片大小不合法：需为不超过 4GB 的正整数');
  }
}

// ---- 字节工具 ----
export function uint8FromBuffer(buf) {
  return new Uint8Array(buf, 0, buf.byteLength);
}

export function concatBuffers(bufs) {
  const total = bufs.reduce((s, b) => s + b.byteLength, 0);
  const res = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { res.set(new Uint8Array(b), off); off += b.byteLength; }
  return res.buffer;
}

export function arrBufToBase64(b) {
  const u = uint8FromBuffer(b);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u.length; i += CHUNK) s += String.fromCharCode.apply(null, u.subarray(i, Math.min(i + CHUNK, u.length)));
  return btoa(s);
}

export function base64ToArrBuf(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

export function bytesToB64(bytes) { return arrBufToBase64(bytes.buffer); }
export function b64ToBytes(s) { return new Uint8Array(base64ToArrBuf(s)); }

export function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

export function hexFromBytes(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- 摘要 ----
export async function sha256(buffer) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
}

// ---- 压缩 / 解压（Deflate，惰性降级）----
export async function compress(buf) {
  try {
    if (!window.CompressionStream) throw new Error('不支持压缩');
    const blob = new Blob([buf]);
    const stream = blob.stream().pipeThrough(new CompressionStream('deflate'));
    return await new Response(stream).arrayBuffer();
  } catch (e) {
    return buf; // 降级：不压缩
  }
}

export async function decompress(buf) {
  try {
    if (!window.DecompressionStream) throw new Error('不支持解压');
    const blob = new Blob([buf]);
    const stream = blob.stream().pipeThrough(new DecompressionStream('deflate'));
    return await new Response(stream).arrayBuffer();
  } catch (e) {
    return buf;
  }
}

// ---- 密钥 ----
export async function importRawKey(keyBuf) {
  return await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function generateRandomKey() {
  return await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportKeyB64(key) {
  return arrBufToBase64(await crypto.subtle.exportKey('raw', key));
}

export async function importKeyFromB64(b64) {
  const keyBuf = base64ToArrBuf(b64);
  if (keyBuf.byteLength !== 32) throw new Error('密钥必须为 32 字节（256 位）Base64');
  return await importRawKey(keyBuf);
}

export async function deriveKeyFromPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256);
  return await crypto.subtle.importKey('raw', derivedBits, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// 支持自定义迭代次数（用于解密旧版/第三方产物）
export async function deriveKeyFromPasswordIter(password, salt, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, 256);
  return await crypto.subtle.importKey('raw', derivedBits, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// ============================================================================
// 分片 AES-GCM 加解密
// ============================================================================

/**
 * 将明文分片加密为一个自描述密文块。
 * @param {Uint8Array|ArrayBuffer} plain 明文
 * @param {Object} keyInfo {type:'key', key} 或 {type:'password', password, salt, iterations}
 * @param {Object} [opts] {chunkSize, onProgress}
 * @returns {Promise<ArrayBuffer>} 自描述密文
 */
export async function encryptBytes(plain, keyInfo, opts = {}) {
  const chunkSize = opts.chunkSize || DEFAULT_CHUNK_SIZE;
  const onProgress = opts.onProgress || (() => {});
  const plainArr = plain instanceof Uint8Array ? plain : uint8FromBuffer(plain);

  // 输入校验
  if (keyInfo.type !== 'key' && keyInfo.type !== 'password') {
    throw new Error('不支持的密钥类型：仅支持 key（密钥）或 password（密码）');
  }
  assertChunkSize(chunkSize);

  // 头部：MAGIC(8) + version(1) + mode(1)
  const head = new Uint8Array(MAGIC.length + 2);
  head.set(MAGIC, 0);
  head[MAGIC.length] = VERSION;
  head[MAGIC.length + 1] = keyInfo.type === 'password' ? MODE_PASSWORD : MODE_KEY;

  const parts = [head.buffer];
  let key;
  let usedSalt = null;

  if (keyInfo.type === 'password') {
    const salt = keyInfo.salt || randomBytes(SALT_LEN);
    const iterations = keyInfo.iterations || PBKDF2_ITERATIONS;
    assertIterations(iterations);
    key = await deriveKeyFromPasswordIter(keyInfo.password, salt, iterations);
    usedSalt = salt;
    // 密码模式元信息：salt(16) + iter(4) + chunkSize(4)，均大端
    const meta = new Uint8Array(SALT_LEN + 4 + 4);
    meta.set(salt, 0);
    const dv = new DataView(meta.buffer);
    dv.setUint32(SALT_LEN, iterations, false);
    dv.setUint32(SALT_LEN + 4, chunkSize, false);
    parts.push(meta.buffer);
  } else {
    key = keyInfo.key;
    // 密钥模式元信息：chunkSize(4)，大端
    const meta = new Uint8Array(4);
    new DataView(meta.buffer).setUint32(0, chunkSize, false);
    parts.push(meta.buffer);
  }

  // 分片数量（与解密侧切分逻辑严格对称：前 n-1 片固定 chunkSize，末片为余数）
  const count = Math.max(1, Math.ceil(plainArr.length / chunkSize));
  const cntBuf = new ArrayBuffer(4);
  new DataView(cntBuf).setUint32(0, count, false);
  parts.push(cntBuf);

  // 逐块加密
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, plainArr.length);
    const chunk = plainArr.subarray(start, end);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, chunk);
    const block = new Uint8Array(IV_LEN + ct.byteLength);
    block.set(iv, 0);
    block.set(new Uint8Array(ct), IV_LEN);
    parts.push(block.buffer);
    onProgress(Math.round(((i + 1) / count) * 100), i + 1, count);
  }

  const out = concatBuffers(parts);
  // 跟踪实际使用的 salt（供上层展示/记忆）
  return { buffer: out, salt: usedSalt };
}

/**
 * 解析自描述密文头部（含输入校验）。
 * 头部布局（v3）：MAGIC(8) + version(1) + mode(1)
 *   + [密码模式] salt(16) + iterations(4)
 *   + chunkSize(4) + count(4)  —— 均大端
 * v2 布局与 v3 一致，但没有 chunkSize 字段。
 * @returns {Object|null} 解析信息；MAGIC 不匹配（非本工具格式）返回 null
 */
export function parseHeader(buf) {
  const u = uint8FromBuffer(buf);
  if (u.length < MAGIC.length) return null;
  for (let i = 0; i < MAGIC.length; i++) if (u[i] !== MAGIC[i]) return null;
  if (u.length < MAGIC.length + 2) throw new Error('密文损坏：头部不完整');

  const version = u[MAGIC.length];
  const mode = u[MAGIC.length + 1];
  // 版本白名单比对：仅接受当前版本与仍兼容的旧版本
  if (version !== VERSION && version !== LEGACY_VERSION) {
    throw new Error(`不支持的文件格式版本：v${version}（当前支持 v${VERSION} 与 v${LEGACY_VERSION}）`);
  }
  if (mode !== MODE_PASSWORD && mode !== MODE_KEY) throw new Error('密文损坏：未知的加密模式');

  let off = MAGIC.length + 2;
  let salt = null, iterations = null, chunkSize = null;
  if (mode === MODE_PASSWORD) {
    if (u.length < off + SALT_LEN + 4) throw new Error('密文损坏：密码模式头部不完整');
    salt = u.slice(off, off + SALT_LEN);
    off += SALT_LEN;
    iterations = new DataView(u.buffer, u.byteOffset + off, 4).getUint32(0, false);
    off += 4;
    assertIterations(iterations); // 防恶意迭代次数卡死主线程
  }
  if (version === VERSION) { // v3 起头部记录分片大小
    if (u.length < off + 4) throw new Error('密文损坏：缺少分片大小信息');
    chunkSize = new DataView(u.buffer, u.byteOffset + off, 4).getUint32(0, false);
    off += 4;
    assertChunkSize(chunkSize);
  }
  if (u.length < off + 4) throw new Error('密文损坏：缺少分片信息');
  const count = new DataView(u.buffer, u.byteOffset + off, 4).getUint32(0, false);
  off += 4;
  if (!Number.isInteger(count) || count < 1) throw new Error('密文损坏：分片数量非法');
  return { version, mode, salt, iterations, chunkSize, count, bodyOffset: off };
}

/**
 * 解密自描述密文（返回原始明文 ArrayBuffer）。
 * @param {ArrayBuffer} buf 密文
 * @param {Function} resolveKey 根据头部信息返回 AES 密钥
 * @param {Object} [opts] {onProgress}
 */
export async function decryptEncodedBytes(buf, resolveKey, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const u = uint8FromBuffer(buf);
  const head = parseHeader(buf);
  if (!head) return { plain: buf, legacy: true }; // 非本工具格式，交给上层按旧版处理

  // 旧版 v2：多分片的切分方式从未正确实现，直接给出明确中文提示
  if (head.version === LEGACY_VERSION && head.count > 1) {
    throw new Error('此文件由存在缺陷的旧版本生成，无法解密');
  }

  // 载荷长度与分片数量的最低一致性校验（派生密钥前先做，避免无谓开销）
  const bodyLen = u.length - head.bodyOffset;
  if (bodyLen < head.count * (IV_LEN + TAG_LEN)) {
    throw new Error('密文损坏：分片数量与数据长度不匹配');
  }

  const key = await resolveKey(head);
  let off = head.bodyOffset;
  const outChunks = [];
  for (let i = 0; i < head.count; i++) {
    let ctEnd;
    if (head.chunkSize === null) {
      ctEnd = u.length; // v2 单分片：正文即剩余全部字节
    } else if (i === head.count - 1) {
      ctEnd = u.length; // 末片为余数
    } else {
      ctEnd = off + IV_LEN + head.chunkSize + TAG_LEN; // 非末片固定 IV + chunkSize + GCM 标签
      if (ctEnd > u.length) throw new Error('密文损坏：分片数据不完整');
    }
    if (ctEnd - off < IV_LEN + TAG_LEN) throw new Error('密文损坏：分片数据不完整');
    const iv = u.slice(off, off + IV_LEN);
    const ct = u.slice(off + IV_LEN, ctEnd);
    off = ctEnd;
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      outChunks.push(pt);
    } catch (e) {
      throw new Error('解密失败：密钥错误或数据已损坏');
    }
    onProgress(Math.round(((i + 1) / head.count) * 100), i + 1, head.count);
  }
  return { plain: concatBuffers(outChunks), legacy: false };
}

// ============================================================================
// 载荷结构工具（在明文层面构建批量/单文件容器，含哈希校验）
// ============================================================================

export function encodePayload(hashBytes, compressedPayload) {
  return concatBuffers([hashBytes.buffer, compressedPayload]);
}

export function splitPayload(finalPlain) {
  const u = uint8FromBuffer(finalPlain);
  if (u.length < 32) throw new Error('载荷损坏');
  const hash = u.slice(0, 32);
  const compressed = u.slice(32).buffer;
  return { hash, compressed };
}
