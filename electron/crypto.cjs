// ============================================================================
// electron/crypto.cjs —— 加密工具模块（AES-GCM）
// ============================================================================
const crypto = require('crypto');

// 默认密钥派生：使用项目名称的 MD5 哈希
const DEFAULT_KEY_NAME = 'wbwencrypt';

function deriveKey(password) {
  // 使用 PBKDF2 派生 32 字节密钥
  const salt = Buffer.from('wbwencrypt-salt', 'utf-8');
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

function getDefaultKey() {
  // 计算项目名 "wbwencrypt" 的 MD5 哈希作为默认密钥
  const hash = crypto.createHash('md5').update(DEFAULT_KEY_NAME).digest();
  return deriveKey(hash);
}

async function encryptBuffer(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(buffer);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // 格式：IV(12) + AuthTag(16) + EncryptedData
  return Buffer.concat([iv, authTag, encrypted]);
}

async function decryptBuffer(encryptedData, key) {
  // 解析格式：IV(12) + AuthTag(16) + EncryptedData
  const iv = encryptedData.slice(0, 12);
  const authTag = encryptedData.slice(12, 28);
  const data = encryptedData.slice(28);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(data);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted;
}

function isEncrypted(buffer) {
  // 简单检测：检查前 28 字节后是否有有效数据
  if (buffer.length < 28) return false;
  // 实际使用时可以更严格地验证
  return true;
}

module.exports = {
  deriveKey,
  getDefaultKey,
  encryptBuffer,
  decryptBuffer,
  isEncrypted,
};
