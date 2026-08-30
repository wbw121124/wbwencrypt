// ============================================================================
// key.js —— 密钥获取/派生/展示 + localStorage 基于文件哈希的密钥记忆
// ============================================================================
import {
  generateRandomKey, exportKeyB64, importKeyFromB64, deriveKeyFromPassword,
  deriveKeyFromPasswordIter, sha256, concatBuffers, arrBufToBase64,
} from './crypto.js';

const STORE_PREFIX = 'wbwencrypt:key:';
const META_PREFIX = 'wbwencrypt:meta:';
const MAX_ENTRIES = 50;

// ---- localStorage 工具（try/catch 防隐私模式报错）----
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

// ---- 文件哈希（多个文件合并计算一个内容哈希）----
export async function hashOfBuffers(buffers) {
  const total = buffers.reduce((s, b) => s + b.byteLength, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const b of buffers) { const u = new Uint8Array(b); merged.set(u, off); off += u.byteLength; }
  return await sha256(merged.buffer);
}

export function hashKey(hashHex) { return STORE_PREFIX + hashHex; }

// ---- 记忆存储结构 ----
// { type:'key', keyB64 }  或  { type:'password', saltB64 }
export function rememberKeyForHash(hashHex, record) {
  const key = hashKey(hashHex);
  lsSet(key, JSON.stringify(record));
  // 维护元信息（时间戳），并清理超限
  try {
    const metaKey = META_PREFIX + 'list';
    let list = JSON.parse(lsGet(metaKey) || '[]');
    list = list.filter(x => x !== key);
    list.push({ key, t: Date.now() });
    while (list.length > MAX_ENTRIES) {
      const removed = list.shift();
      lsDel(removed.key);
    }
    lsSet(metaKey, JSON.stringify(list));
  } catch (e) {}
}

export function getKeyForHash(hashHex) {
  const raw = lsGet(hashKey(hashHex));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export function clearKeyForHash(hashHex) {
  lsDel(hashKey(hashHex));
}

export function getAllStoredHashes() {
  try {
    const list = JSON.parse(lsGet(META_PREFIX + 'list') || '[]');
    return list.map(x => x.key.replace(STORE_PREFIX, ''));
  } catch (e) { return []; }
}

// 记忆面板：返回带摘要信息的记录列表（不暴露完整密钥）
export function listStoredRecords() {
  const hashes = getAllStoredHashes();
  const records = [];
  for (const h of hashes) {
    const rec = getKeyForHash(h);
    if (!rec) continue;
    records.push({ hashHex: h, type: rec.type, shortHash: h.slice(0, 16) });
  }
  return records;
}

export function clearAllKeys() {
  for (const h of getAllStoredHashes()) clearKeyForHash(h);
  try { lsDel(META_PREFIX + 'list'); } catch (e) {}
}

// ============================================================================
// 解密历史（功能4）：记住最近一次成功解密的凭据，便于再次解密
// 默认不存储密码模式的原始密码（仅存密钥模式 keyB64），避免明文密码落盘
// ============================================================================
const LAST_DECRYPT_KEY = 'wbwencrypt:decrypt:last';

export function rememberDecryptSuccess(credential) {
  // credential: { type:'key', keyB64 } | { type:'password', inputStr }
  if (credential.type === 'password') return; // 不存明文密码
  lsSet(LAST_DECRYPT_KEY, JSON.stringify(credential));
}

export function getRememberedDecrypt() {
  try {
    const raw = lsGet(LAST_DECRYPT_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && obj.type === 'key' && obj.keyB64) return obj;
    return null;
  } catch (e) { return null; }
}

export function clearRememberedDecrypt() { lsDel(LAST_DECRYPT_KEY); }

// ============================================================================
// 加密端：获取密钥
// ----------------------------------------------------------------------------
// 返回 { key, keyB64, type, saltB64, iterations }
//   type: 'key' | 'password'
// ============================================================================
export async function getEncryptionKey(customKeyRaw, usePassword, password) {
  if (usePassword) {
    if (!password) throw new Error('请输入密码短语');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKeyFromPassword(password, salt);
    const keyB64 = await exportKeyB64(key);
    return { key, keyB64, type: 'password', saltB64: arrBufToBase64(salt) };
  }
  if (customKeyRaw && customKeyRaw.trim() !== '') {
    const key = await importKeyFromB64(customKeyRaw.trim());
    return { key, keyB64: customKeyRaw.trim(), type: 'key', saltB64: null };
  }
  const key = await generateRandomKey();
  const keyB64 = await exportKeyB64(key);
  return { key, keyB64, type: 'key', saltB64: null };
}

// ============================================================================
// 解密端：根据头部解析密钥（密码模式重派生 / 密钥模式直接导入）
// ============================================================================
export function makeKeyResolver(usePassword, inputStr) {
  return async function resolveKey(head) {
    if (usePassword) {
      if (!inputStr) throw new Error('请输入密码');
      if (!head.salt) throw new Error('该密文不是密码派生格式');
      // 需要支持指定迭代次数（从头部读取）
      return await deriveKeyFromPasswordIter(inputStr, head.salt, head.iterations);
    }
    if (!inputStr) throw new Error('请输入密钥(Base64)');
    return await importKeyFromB64(inputStr.trim());
  };
}
