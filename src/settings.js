// ============================================================================
// settings.js —— 配置导入/导出（加密偏好 + 记忆密钥 + 解密历史）
// ----------------------------------------------------------------------------
// 用于在浏览器/设备间备份与迁移本地配置。注意：导出文件包含记忆密钥等敏感信息，
// 请妥善保管（不存明文密码）。
// ============================================================================
import {
  getAllStoredHashes, getKeyForHash, rememberKeyForHash,
  clearAllKeys, getRememberedDecrypt, rememberDecryptSuccess,
} from './key.js';
import { $, toast } from './ui.js';
import Swal from 'sweetalert2';

const CONFIG_TAG = 'wbwencrypt';
const CONFIG_VERSION = 1;

function downloadText(name, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// 收集当前界面偏好
function collectPrefs() {
  return {
    usePasswordDerive: $('usePasswordDerive').checked,
    clearAfterEncrypt: $('clearAfterEncrypt').checked,
    lastCustomKey: $('customKeyInput').value.trim(),
  };
}

export function exportConfig() {
  // 记忆密钥（完整记录）
  const memKeys = [];
  for (const h of getAllStoredHashes()) {
    const rec = getKeyForHash(h);
    if (rec) memKeys.push({ hashHex: h, record: rec });
  }
  const decryptHistory = getRememberedDecrypt();
  const config = {
    tag: CONFIG_TAG,
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    prefs: collectPrefs(),
    memKeys,
    decryptHistory,
  };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadText(`wbwencrypt-config-${stamp}.json`, JSON.stringify(config, null, 2));
  toast('配置已导出（含记忆密钥，请妥善保管）');
}

export async function importConfig(file) {
  const text = await file.text();
  let cfg;
  try { cfg = JSON.parse(text); } catch (e) { throw new Error('配置文件解析失败'); }
  if (!cfg || cfg.tag !== CONFIG_TAG) throw new Error('非有效的加密箱配置文件');

  // 恢复偏好
  const p = cfg.prefs || {};
  if (typeof p.usePasswordDerive === 'boolean') $('usePasswordDerive').checked = p.usePasswordDerive;
  if (typeof p.clearAfterEncrypt === 'boolean') $('clearAfterEncrypt').checked = p.clearAfterEncrypt;
  if (typeof p.lastCustomKey === 'string') $('customKeyInput').value = p.lastCustomKey;
  // 联动密码框
  $('passwordDeriveInput').disabled = !$('usePasswordDerive').checked;

  // 恢复记忆密钥（覆盖）
  if (Array.isArray(cfg.memKeys)) {
    clearAllKeys();
    for (const item of cfg.memKeys) {
      if (item && item.hashHex && item.record) rememberKeyForHash(item.hashHex, item.record);
    }
  }

  // 恢复解密历史
  if (cfg.decryptHistory && cfg.decryptHistory.keyB64) {
    rememberDecryptSuccess(cfg.decryptHistory);
    $('decryptKeyInput').value = cfg.decryptHistory.keyB64;
  }

  return cfg;
}

export function setupConfigPanel(onConfigImported) {
  $('exportConfigBtn').onclick = async () => {
    const res = await Swal.fire({
      title: '导出配置',
      text: '导出的配置文件将包含记忆密钥（不包含密码）。是否继续？',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '导出',
      cancelButtonText: '取消',
    });
    if (!res.isConfirmed) return;
    exportConfig();
  };
  const fileInput = $('importConfigFile');
  $('importConfigBtn').onclick = () => fileInput.click();
  fileInput.addEventListener('change', async (e) => {
    if (!e.target.files.length) return;
    try {
      await importConfig(e.target.files[0]);
      toast('配置已导入');
      if (onConfigImported) onConfigImported();
    } catch (err) {
      toast('导入失败: ' + err.message, 'error');
    } finally { e.target.value = ''; }
  });
}
