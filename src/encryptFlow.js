// ============================================================================
// encryptFlow.js —— 加密业务流（装配层之外的完整一次加密）
// ----------------------------------------------------------------------------
// 流程：构建载荷 → 双重哈希（摘要 + 压缩前哈希）→ 记忆密钥复用与写入
//       → 密钥派生 → 分片加密（带进度）→ 下载/复制接线 → 结果展示 → 列表清理
// 只负责业务与进度播报；按钮装配、全局异常兜底留在 main.js。
// ============================================================================
import { $, toast, setProgress, hideProgress, buttonProgress, downloadBlob } from './ui.js';
import { getRightItems, clearRight } from './library.js';
import { getEncryptionKey, rememberKeyForHash, getKeyForHash } from './key.js';
import {
  concatBuffers, sha256, compress, encryptBytes, hexFromBytes, base64ToBytes,
} from './crypto.js';
import { buildBatchPayload } from './payload.js';

/**
 * 执行一次完整加密。
 * @param {Function} [refreshMemoryPanel] 加密成功后刷新记忆密钥面板的回调
 * @returns {Promise<boolean>} 是否加密成功（失败已就地给出中文提示）
 */
export async function runEncryptFlow(refreshMemoryPanel) {
  const right = getRightItems();
  if (!right.length) { toast('请将文件移至右侧待加密列表', 'error'); return false; }
  const btn = $('transferEncryptBtn');
  btn.disabled = true;
  buttonProgress(btn, '⏳ 加密中...');
  try {
    const filesData = right.map(it => ({ name: it.name, mime: it.mime, dataBuffer: it.arrayBuffer }));
    const rawBatch = buildBatchPayload(filesData);
    const hash = await sha256(rawBatch);
    const compressed = await compress(rawBatch);
    const finalPlain = concatBuffers([hash.buffer, compressed]);

    const customKeyInput = $('customKeyInput');
    const customKey = customKeyInput.value.trim();
    const usePassword = $('usePasswordDerive').checked;
    const password = $('passwordDeriveInput').value;

    // 密钥记忆（针对文件内容哈希）：仅密钥模式记忆/复用
    // storeHash 与完整性校验用的 hash 同源（sha256(rawBatch)），直接复用避免重复哈希
    const storeHash = hexFromBytes(hash);
    if (!usePassword && !customKey && storeHash) {
      const mem = getKeyForHash(storeHash);
      if (mem && mem.type === 'key') {
        customKeyInput.value = mem.keyB64;
        toast('已自动复用该文件的记忆密钥');
      }
    }

    setProgress('encryptProgress', '🔑 生成密钥...');
    const keyInfo = await getEncryptionKey(customKeyInput.value.trim(), usePassword, password);

    // 分片加密 + 进度
    const { buffer } = await encryptBytes(finalPlain, {
      type: keyInfo.type,
      key: keyInfo.type === 'key' ? keyInfo.key : undefined,
      password: keyInfo.type === 'password' ? password : undefined,
      salt: keyInfo.saltB64 ? base64ToBytes(keyInfo.saltB64) : undefined,
    }, {
      onProgress: (pct, i, count) => setProgress('encryptProgress', `🔐 加密分片 ${i}/${count} (${pct}%)`),
    });

    // 记忆密钥（针对文件内容哈希）
    if (storeHash) {
      const record = keyInfo.type === 'key'
        ? { type: 'key', keyB64: keyInfo.keyB64 }
        : { type: 'password', saltB64: keyInfo.saltB64 };
      rememberKeyForHash(storeHash, record);
    }

    $('usedKeyDisplay').innerText = keyInfo.keyB64;
    $('encryptResultUnified').style.display = 'block';
    // 功能1：单文件时用原文件名，多文件用批量名
    const downloadName = right.length === 1
      ? right[0].name + '.aes'
      : `encrypted_batch_${Date.now()}.aes`;
    // 下载交给统一工具：每次点击新建 blob URL 并延迟回收，不持有全局 window.downloadUrl
    const encBlob = new Blob([buffer]);
    $('downloadEncryptedBtn').onclick = () => downloadBlob(downloadName, encBlob);
    $('copyUsedKeyBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(keyInfo.keyB64);
        toast('密钥已复制');
      } catch (e) {
        toast('复制失败，请手动复制', 'error');
      }
    };
    hideProgress('encryptProgress');
    buttonProgress(btn, '🔒 加密完成');
    // 功能3：加密后清空待加密列表
    if ($('clearAfterEncrypt').checked) clearRight();
    if (refreshMemoryPanel) refreshMemoryPanel(); // 刷新记忆面板
    if (storeHash) toast('已记忆此文件的密钥');
    return true;
  } catch (e) {
    hideProgress('encryptProgress');
    buttonProgress(btn, '重试');
    toast('加密失败: ' + e.message, 'error');
    return false;
  } finally {
    btn.disabled = false;
  }
}
