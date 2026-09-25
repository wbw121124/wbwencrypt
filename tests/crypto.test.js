// ============================================================================
// tests/crypto.test.js —— 加密核心单元测试
//   覆盖：密钥/密码模式 round-trip、分片切分（含跨 chunkSize 关键用例）、
//         v2 旧格式兼容分支、密文损坏检测、头部输入校验、legacy 分支
// ============================================================================
import { describe, it, expect } from 'vitest';
import {
  MAGIC, VERSION, LEGACY_VERSION, MODE_KEY, MODE_PASSWORD,
  IV_LEN, MIN_PBKDF2_ITERATIONS, MAX_PBKDF2_ITERATIONS,
  DEFAULT_CHUNK_SIZE, SALT_LEN,
  encryptBytes, decryptEncodedBytes, parseHeader, concatBuffers,
  generateRandomKey, exportKeyB64, importKeyFromB64, deriveKeyFromPasswordIter,
  randomBytes,
} from '../src/crypto.js';

// ---- 通用工具 ----
function bytesOf(buf) { return new Uint8Array(buf); }

function bytesEqual(a, b) {
  const x = bytesOf(a), y = bytesOf(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

function makePattern(len) {
  const u = new Uint8Array(len);
  for (let i = 0; i < len; i++) u[i] = (i * 31 + 7) & 0xff;
  return u;
}

async function newKey() {
  const key = await generateRandomKey();
  return { key, keyB64: await exportKeyB64(key) };
}

// 密钥模式解密器（直接用现成 CryptoKey）
const keyResolver = (key) => async () => key;

// 密码模式解密器（从头部 salt/iterations 重派生，与 key.js 行为一致）
const passwordResolver = (password) => async (head) => {
  if (!head.salt) throw new Error('该密文不是密码派生格式');
  return await deriveKeyFromPasswordIter(password, head.salt, head.iterations);
};

// ---- 手工构造 v2 旧格式载荷（v2 头部无 chunkSize 字段）----
function buildV2Header(count, { mode = MODE_KEY, salt = null, iterations = null } = {}) {
  const parts = [];
  const h = new Uint8Array(MAGIC.length + 2);
  h.set(MAGIC, 0);
  h[MAGIC.length] = LEGACY_VERSION;
  h[MAGIC.length + 1] = mode;
  parts.push(h.buffer);
  if (mode === MODE_PASSWORD) {
    const meta = new Uint8Array(SALT_LEN + 4);
    meta.set(salt, 0);
    new DataView(meta.buffer).setUint32(SALT_LEN, iterations, false);
    parts.push(meta.buffer);
  }
  const c = new Uint8Array(4);
  new DataView(c.buffer).setUint32(0, count, false);
  parts.push(c.buffer);
  return concatBuffers(parts);
}

// 构造 v2 单分片密文：整段明文作为唯一一片
async function buildV2Single(plain, key, { mode = MODE_KEY, password = null, iterations = MIN_PBKDF2_ITERATIONS } = {}) {
  const salt = mode === MODE_PASSWORD ? randomBytes(SALT_LEN) : null;
  const cryptoKey = mode === MODE_PASSWORD
    ? await deriveKeyFromPasswordIter(password, salt, iterations)
    : key;
  const iv = randomBytes(IV_LEN);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plain));
  const header = buildV2Header(1, { mode, salt, iterations });
  return concatBuffers([header, iv.buffer, ct.buffer]);
}

// 构造 v2 多分片载荷（正文仅需满足长度校验即可，切片前就会报错）
function buildV2Multi(count, bodyLen = 512) {
  const header = buildV2Header(count, { mode: MODE_KEY });
  const body = new Uint8Array(bodyLen);
  return concatBuffers([header, body.buffer]);
}

// ============================================================================
describe('crypto 核心 · 密钥模式 round-trip', () => {
  it('小载荷加解密后字节完全一致，头部为 v3 并记录 chunkSize', async () => {
    const { key } = await newKey();
    const plain = makePattern(2048);
    const { buffer } = await encryptBytes(plain, { type: 'key', key });
    const head = parseHeader(buffer);
    expect(head.version).toBe(VERSION);
    expect(head.mode).toBe(MODE_KEY);
    expect(head.chunkSize).toBe(DEFAULT_CHUNK_SIZE);
    expect(head.count).toBe(1);
    const r = await decryptEncodedBytes(buffer, keyResolver(key));
    expect(r.legacy).toBe(false);
    expect(bytesEqual(r.plain, plain)).toBe(true);
  });

  it('1KB 与 100KB 载荷 round-trip 一致', async () => {
    const { key } = await newKey();
    for (const len of [1024, 100 * 1024]) {
      const plain = makePattern(len);
      const { buffer } = await encryptBytes(plain, { type: 'key', key });
      const r = await decryptEncodedBytes(buffer, keyResolver(key));
      expect(bytesEqual(r.plain, plain)).toBe(true);
    }
  });

  it('跨 chunkSize 大载荷：chunkSize=1000 时 3000 字节明文 count=3 且 round-trip 一致（关键回归用例）', async () => {
    const { key } = await newKey();
    const plain = makePattern(3000);
    const { buffer } = await encryptBytes(plain, { type: 'key', key }, { chunkSize: 1000 });
    const head = parseHeader(buffer);
    expect(head.version).toBe(VERSION);
    expect(head.chunkSize).toBe(1000);
    expect(head.count).toBe(3);
    const r = await decryptEncodedBytes(buffer, keyResolver(key));
    expect(bytesEqual(r.plain, plain)).toBe(true);
  });

  it('100KB 载荷按 chunkSize=10000 切成 11 片仍可还原', async () => {
    const { key } = await newKey();
    const plain = makePattern(100 * 1024); // 102400 = 10 × 10000 + 2400
    const { buffer } = await encryptBytes(plain, { type: 'key', key }, { chunkSize: 10000 });
    const head = parseHeader(buffer);
    expect(head.count).toBe(11);
    const r = await decryptEncodedBytes(buffer, keyResolver(key));
    expect(bytesEqual(r.plain, plain)).toBe(true);
  });

  it('默认 8MB 分片下超过一个分片的大载荷（30MB，原 bug 场景）round-trip 一致', async () => {
    const { key } = await newKey();
    const plain = makePattern(30 * 1024 * 1024);
    const { buffer } = await encryptBytes(plain, { type: 'key', key });
    const head = parseHeader(buffer);
    expect(head.chunkSize).toBe(DEFAULT_CHUNK_SIZE);
    expect(head.count).toBe(4);
    const r = await decryptEncodedBytes(buffer, keyResolver(key));
    expect(bytesEqual(r.plain, plain)).toBe(true);
  }, 30000);

  it('进度回调按分片上报（i/n 与百分比）', async () => {
    const { key } = await newKey();
    const plain = makePattern(3000);
    const seen = [];
    await encryptBytes(plain, { type: 'key', key }, {
      chunkSize: 1000,
      onProgress: (pct, i, count) => seen.push([pct, i, count]),
    });
    expect(seen.length).toBe(3);
    expect(seen[0]).toEqual([33, 1, 3]);
    expect(seen[2]).toEqual([100, 3, 3]);
  });

  it('空明文也可正常 round-trip', async () => {
    const { key } = await newKey();
    const { buffer } = await encryptBytes(new Uint8Array(0), { type: 'key', key }, { chunkSize: 1000 });
    const r = await decryptEncodedBytes(buffer, keyResolver(key));
    expect(r.plain.byteLength).toBe(0);
  });
});

// ============================================================================
describe('crypto 核心 · 密码模式 round-trip', () => {
  it('密码模式加解密一致，头部记录 salt/iterations/chunkSize', async () => {
    const plain = new TextEncoder().encode('这是一段中文口令测试明文，包含 ASCII: abc123');
    // 用最低合法迭代次数，保证测试速度
    const { buffer, salt } = await encryptBytes(
      plain,
      { type: 'password', password: '正确的口令', iterations: MIN_PBKDF2_ITERATIONS },
      { chunkSize: 8 },
    );
    const head = parseHeader(buffer);
    expect(head.mode).toBe(MODE_PASSWORD);
    expect(head.iterations).toBe(MIN_PBKDF2_ITERATIONS);
    expect(head.chunkSize).toBe(8);
    expect(head.count).toBeGreaterThan(1);
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(head.salt.length).toBe(SALT_LEN);

    const r = await decryptEncodedBytes(buffer, passwordResolver('正确的口令'));
    expect(bytesEqual(r.plain, plain)).toBe(true);
  });

  it('密码错误时抛出中文业务错误', async () => {
    const plain = new TextEncoder().encode('敏感内容');
    const { buffer } = await encryptBytes(
      plain,
      { type: 'password', password: '正确口令', iterations: MIN_PBKDF2_ITERATIONS },
    );
    await expect(decryptEncodedBytes(buffer, passwordResolver('错误口令')))
      .rejects.toThrow('解密失败：密钥错误或数据已损坏');
  });

  it('密钥模式密文用密码解密器解（缺少 salt）时给出中文提示', async () => {
    const { key } = await newKey();
    const { buffer } = await encryptBytes(makePattern(64), { type: 'key', key });
    await expect(decryptEncodedBytes(buffer, passwordResolver('任意口令')))
      .rejects.toThrow('该密文不是密码派生格式');
  });
});

// ============================================================================
describe('crypto 核心 · v2 旧格式兼容', () => {
  it('v2 单分片（count==1）密钥模式可正常解密', async () => {
    const { key } = await newKey();
    const plain = makePattern(64);
    const v2 = await buildV2Single(plain, key);
    const head = parseHeader(v2);
    expect(head.version).toBe(LEGACY_VERSION);
    expect(head.chunkSize).toBeNull();
    expect(head.count).toBe(1);
    const r = await decryptEncodedBytes(v2, keyResolver(key));
    expect(r.legacy).toBe(false);
    expect(bytesEqual(r.plain, plain)).toBe(true);
  });

  it('v2 单分片（count==1）密码模式可正常解密', async () => {
    const plain = new TextEncoder().encode('旧版密码模式明文');
    const v2 = await buildV2Single(plain, null, { mode: MODE_PASSWORD, password: '旧口令', iterations: MIN_PBKDF2_ITERATIONS });
    const r = await decryptEncodedBytes(v2, passwordResolver('旧口令'));
    expect(bytesEqual(r.plain, plain)).toBe(true);
  });

  it('v2 多分片（count>1）抛出约定中文错误', async () => {
    const { key } = await newKey();
    const v2 = buildV2Multi(3);
    await expect(decryptEncodedBytes(v2, keyResolver(key)))
      .rejects.toThrow('此文件由存在缺陷的旧版本生成，无法解密');
  });
});

// ============================================================================
describe('crypto 核心 · 损坏与篡改检测', () => {
  it('篡改密文末字节后解密抛出中文错误', async () => {
    const { key } = await newKey();
    const plain = makePattern(3000);
    const { buffer } = await encryptBytes(plain, { type: 'key', key }, { chunkSize: 1000 });
    const u = bytesOf(buffer).slice();
    u[u.length - 1] ^= 0xff;
    await expect(decryptEncodedBytes(u.buffer, keyResolver(key)))
      .rejects.toThrow('解密失败：密钥错误或数据已损坏');
  });

  it('篡改中间分片的密文同样被认证拒绝', async () => {
    const { key } = await newKey();
    const plain = makePattern(3000);
    const { buffer } = await encryptBytes(plain, { type: 'key', key }, { chunkSize: 1000 });
    const u = bytesOf(buffer).slice();
    u[20] ^= 0xff; // 第一片正文中的字节
    await expect(decryptEncodedBytes(u.buffer, keyResolver(key)))
      .rejects.toThrow('解密失败：密钥错误或数据已损坏');
  });

  it('密钥错误时解密失败', async () => {
    const { key: rightKey } = await newKey();
    const { key: wrongKey } = await newKey();
    const { buffer } = await encryptBytes(makePattern(512), { type: 'key', key: rightKey });
    await expect(decryptEncodedBytes(buffer, keyResolver(wrongKey)))
      .rejects.toThrow('解密失败：密钥错误或数据已损坏');
  });

  it('分片数量与数据长度不匹配时抛中文错误', async () => {
    const { key } = await newKey();
    const { buffer } = await encryptBytes(makePattern(64), { type: 'key', key });
    const u = bytesOf(buffer).slice();
    // v3 密钥模式：count 位于偏移 14（MAGIC 8 + version 1 + mode 1 + chunkSize 4）
    new DataView(u.buffer, u.byteOffset).setUint32(14, 0x0ffffff0, false);
    await expect(decryptEncodedBytes(u.buffer, keyResolver(key)))
      .rejects.toThrow('密文损坏：分片数量与数据长度不匹配');
  });
});

// ============================================================================
describe('crypto 核心 · 头部输入校验（中文业务错误）', () => {
  it('版本号不在白名单内抛中文错误', async () => {
    const u = new Uint8Array(MAGIC.length + 6);
    u.set(MAGIC, 0);
    u[MAGIC.length] = 9; // 未知版本
    u[MAGIC.length + 1] = MODE_KEY;
    expect(() => parseHeader(u.buffer)).toThrow('不支持的文件格式版本');
  });

  it('迭代次数超过上限（5,000,000）抛中文错误，防止卡死主线程', async () => {
    const u = new Uint8Array(MAGIC.length + 2 + SALT_LEN + 4 + 4);
    u.set(MAGIC, 0);
    u[MAGIC.length] = VERSION;
    u[MAGIC.length + 1] = MODE_PASSWORD;
    const off = MAGIC.length + 2;
    new DataView(u.buffer).setUint32(off + SALT_LEN, MAX_PBKDF2_ITERATIONS + 1, false);
    expect(() => parseHeader(u.buffer)).toThrow('迭代次数不合法');
  });

  it('迭代次数低于下限（1,000）抛中文错误', async () => {
    const u = new Uint8Array(MAGIC.length + 2 + SALT_LEN + 4 + 4);
    u.set(MAGIC, 0);
    u[MAGIC.length] = VERSION;
    u[MAGIC.length + 1] = MODE_PASSWORD;
    const off = MAGIC.length + 2;
    new DataView(u.buffer).setUint32(off + SALT_LEN, MIN_PBKDF2_ITERATIONS - 1, false);
    expect(() => parseHeader(u.buffer)).toThrow('迭代次数不合法');
  });

  it('头部 chunkSize 为 0 抛中文错误', async () => {
    const { key } = await newKey();
    const { buffer } = await encryptBytes(makePattern(64), { type: 'key', key });
    const u = bytesOf(buffer).slice();
    new DataView(u.buffer, u.byteOffset).setUint32(10, 0, false);
    expect(() => parseHeader(u.buffer)).toThrow('分片大小不合法');
  });

  it('加密侧传入非法 chunkSize 抛中文错误（0/缺省回落默认分片大小）', async () => {
    const { key } = await newKey();
    await expect(encryptBytes(makePattern(64), { type: 'key', key }, { chunkSize: -5 }))
      .rejects.toThrow('分片大小不合法');
    await expect(encryptBytes(makePattern(64), { type: 'key', key }, { chunkSize: 1.5 }))
      .rejects.toThrow('分片大小不合法');
    // 传 0 或不传时按 `||` 回落到默认 8MB 分片（读取侧对 0 严格拒绝，见上一用例）
    const { buffer } = await encryptBytes(makePattern(64), { type: 'key', key }, { chunkSize: 0 });
    expect(parseHeader(buffer).chunkSize).toBe(DEFAULT_CHUNK_SIZE);
  });

  it('keyInfo.type 非法时抛中文错误', async () => {
    const { key } = await newKey();
    await expect(encryptBytes(makePattern(64), { type: 'unknown', key }))
      .rejects.toThrow('不支持的密钥类型');
  });

  it('加密侧迭代次数越界时同样被拦截（保证自产自解）', async () => {
    await expect(encryptBytes(makePattern(64), { type: 'password', password: '口令', iterations: 10 }))
      .rejects.toThrow('迭代次数不合法');
    await expect(encryptBytes(makePattern(64), { type: 'password', password: '口令', iterations: 99999999 }))
      .rejects.toThrow('迭代次数不合法');
  });

  it('MAGIC 不匹配的截断数据不会抛异常（交给上层 legacy 分支）', async () => {
    expect(parseHeader(new Uint8Array(0).buffer)).toBeNull();
    expect(parseHeader(new Uint8Array([1, 2, 3]).buffer)).toBeNull();
  });

  it('MAGIC 正确但头部被截断时抛中文错误', () => {
    const u = new Uint8Array(MAGIC.length + 1);
    u.set(MAGIC, 0);
    expect(() => parseHeader(u.buffer)).toThrow('密文损坏：头部不完整');
  });
});

// ============================================================================
describe('crypto 核心 · legacy 分支（非本工具格式）', () => {
  it('非本工具格式返回 legacy=true 且原样返回数据', async () => {
    const raw = new TextEncoder().encode('随便一个不是本工具格式的文件内容').buffer;
    const r = await decryptEncodedBytes(raw, async () => { throw new Error('不应被调用'); });
    expect(r.legacy).toBe(true);
    expect(bytesEqual(r.plain, raw)).toBe(true);
  });

  it('空输入同样走 legacy 分支且不解密', async () => {
    const r = await decryptEncodedBytes(new ArrayBuffer(0), async () => null);
    expect(r.legacy).toBe(true);
    expect(r.plain.byteLength).toBe(0);
  });

  it('keyB64 往返导入导出一致（供测试与记忆密钥复用）', async () => {
    const { key, keyB64 } = await newKey();
    const reimported = await importKeyFromB64(keyB64);
    const plain = makePattern(32);
    const { buffer } = await encryptBytes(plain, { type: 'key', key });
    const r = await decryptEncodedBytes(buffer, keyResolver(reimported));
    expect(bytesEqual(r.plain, plain)).toBe(true);
    expect(typeof keyB64).toBe('string');
  });
});
