// ============================================================================
// main.js —— 入口：装配各模块并接线加密/解密/记忆流程
// ============================================================================
import './style.css';
import { $, toast, wireDismissModal, setProgress, hideProgress, buttonProgress } from './ui.js';
import { initLibrary, getRightItems, clearRight } from './library.js';
import { initEditor, openEditorForItem } from './editor.js';
import { initImageEditor, openImageEditor } from './imageEditor.js';
import { initCamera } from './camera.js';
import { initDecrypt } from './decrypt.js';
import { getEncryptionKey, hashOfBuffers, rememberKeyForHash, getKeyForHash, listStoredRecords, clearKeyForHash, clearAllKeys } from './key.js';
import { setupConfigPanel } from './settings.js';
import { injectIcons, icon } from './icons.js';
import { concatBuffers, sha256, compress, encryptBytes, hexFromBytes } from './crypto.js';

function buildBatchPayload(files) {
  const enc = new TextEncoder();
  const parts = [enc.encode('MULT').buffer, new Uint8Array([1]).buffer];
  const cntBuf = new ArrayBuffer(4); new DataView(cntBuf).setUint32(0, files.length, true); parts.push(cntBuf);
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const nameLen = new ArrayBuffer(2); new DataView(nameLen).setUint16(0, nameBytes.length, false);
    parts.push(nameLen, nameBytes.buffer);
    const mimeBytes = enc.encode(f.mime);
    const mimeLen = new ArrayBuffer(2); new DataView(mimeLen).setUint16(0, mimeBytes.length, false);
    parts.push(mimeLen, mimeBytes.buffer);
    const dataLenBuf = new ArrayBuffer(4); new DataView(dataLenBuf).setUint32(0, f.dataBuffer.byteLength, true);
    parts.push(dataLenBuf, f.dataBuffer);
  }
  return concatBuffers(parts);
}

// ---- 功能2：记忆密钥管理面板 ----
function renderMemoryPanel() {
  const listEl = $('memKeyList');
  if (!listEl) return;
  const records = listStoredRecords();
  if (!records.length) {
    listEl.innerHTML = '<div style="color:var(--text-sec); text-align:center; padding:6px;">暂无记忆密钥</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const rec of records) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:6px; background:var(--bg-editor); padding:4px 8px; border-radius:.6rem; border:1px solid var(--border); justify-content:space-between; word-break:break-all;';
    const info = document.createElement('span');
    info.innerHTML = `<span style="color:var(--code-blue);">${rec.shortHash}</span> <span style="color:var(--text-sec);">(${rec.type === 'password' ? '密码' : '密钥'})</span>`;
    info.title = rec.hashHex;
    const del = document.createElement('button');
    del.innerHTML = icon('x'); del.className = 'btn-sm'; del.style.padding = '0 8px';
    del.style.display = 'inline-flex'; del.style.alignItems = 'center'; del.style.justifyContent = 'center';
    del.onclick = () => { clearKeyForHash(rec.hashHex); renderMemoryPanel(); };
    row.appendChild(info); row.appendChild(del);
    listEl.appendChild(row);
  }
}

function setupMemoryPanel() {
  const clearBtn = $('clearMemKeysBtn');
  if (clearBtn) clearBtn.onclick = () => { clearAllKeys(); renderMemoryPanel(); toast('已清空全部记忆密钥'); };
  renderMemoryPanel();
}

function setup() {
  // 填充 HTML 中的 [data-icon] 占位图标
  injectIcons();

  // 模态框点击空白关闭
  wireDismissModal('imageModal');

  // 文件库动作钩子
  initLibrary({
    hooks: {
      editImage: (item) => { if (item.mime.startsWith('image/')) openImageEditor(item); },
      editText: (item) => openEditorForItem(item),
    },
  });

  initEditor({ onSave: null });
  initImageEditor();
  initCamera();
  initDecrypt();

  // 功能2：记忆密钥管理面板
  setupMemoryPanel();

  // 导入/导出配置（导入后刷新记忆面板）
  setupConfigPanel(() => renderMemoryPanel());

  // ---- 加密按钮 ----
  $('transferEncryptBtn').onclick = async () => {
    const right = getRightItems();
    if (!right.length) { toast('请将文件移至右侧待加密列表', 'error'); return; }
    const btn = $('transferEncryptBtn');
    btn.disabled = true; buttonProgress(btn, '⏳ 加密中...');
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
      let storeHash = null;
      try { storeHash = hexFromBytes(await hashOfBuffers([rawBatch])); } catch (e) {}
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
      const { buffer, salt } = await encryptBytes(finalPlain, {
        type: keyInfo.type,
        key: keyInfo.type === 'key' ? keyInfo.key : undefined,
        password: keyInfo.type === 'password' ? password : undefined,
        salt: keyInfo.saltB64 ? Uint8Array.from(atob(keyInfo.saltB64), c => c.charCodeAt(0)) : undefined,
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
      if (window.downloadUrl) URL.revokeObjectURL(window.downloadUrl);
      window.downloadUrl = URL.createObjectURL(new Blob([buffer]));
      // 功能1：单文件时用原文件名，多文件用批量名
      const downloadName = right.length === 1
        ? right[0].name + '.aes'
        : `encrypted_batch_${Date.now()}.aes`;
      $('downloadEncryptedBtn').onclick = () => {
        const a = document.createElement('a'); a.href = window.downloadUrl; a.download = downloadName; a.click();
      };
      $('copyUsedKeyBtn').onclick = () => { navigator.clipboard.writeText(keyInfo.keyB64); toast('密钥已复制'); };
      hideProgress('encryptProgress');
      buttonProgress(btn, '🔒 加密完成');
      // 功能3：加密后清空待加密列表
      if ($('clearAfterEncrypt').checked) clearRight();
      renderMemoryPanel(); // 刷新记忆面板
      if (storeHash) toast('已记忆此文件的密钥');
    } catch (e) {
      hideProgress('encryptProgress');
      buttonProgress(btn, '重试');
      toast('加密失败: ' + e.message, 'error');
    } finally { btn.disabled = false; }
  };

  // 密码派生开关联动
  const pwdCheck = $('usePasswordDerive');
  const pwdInput = $('passwordDeriveInput');
  pwdCheck.onchange = (e) => { pwdInput.disabled = !e.target.checked; };
}

setup();
