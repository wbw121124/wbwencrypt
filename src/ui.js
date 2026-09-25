// ============================================================================
// ui.js —— 通用 UI 工具：模态框、Toast、进度条、拖拽高亮
// ============================================================================

export function $(id) { return document.getElementById(id); }

// ---- Toast ----
const toastContainer = () => {
  let c = document.getElementById('toastContainer');
  if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); }
  return c;
};

export function toast(message, type = 'info', duration = 2600) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = message;
  toastContainer().appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; }, duration - 300);
  setTimeout(() => el.remove(), duration);
}

// ---- 模态框 ----
export function showModal(id) { const m = document.getElementById(id); if (m) m.style.display = 'flex'; }
export function hideModal(id) { const m = document.getElementById(id); if (m) m.style.display = 'none'; }

// 焦点管理（预留，用于后续弹窗焦点陷阱）
let lastFocusedElement = null;
function _trapFocus(modal) {
  lastFocusedElement = document.activeElement;
  const focusable = modal.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable.length) focusable[0].focus();
}
function restoreFocus() { if (lastFocusedElement && lastFocusedElement.closest) lastFocusedElement.focus(); }

// 为所有 dialog 模态框挂载 ESC 关闭与焦点管理
export function wireDialogModals() {
  document.querySelectorAll('[role="dialog"]').forEach(modal => {
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { hideModal(modal.id); restoreFocus(); }
    });
    // 点击空白处关闭
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) { hideModal(modal.id); restoreFocus(); } });
  });
}

// 为 clicked 模态框（点击空白处关闭）挂载
export function wireDismissModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  const closeBtn = m.querySelector('.close-modal');
  if (closeBtn) closeBtn.onclick = () => hideModal(id);
  m.addEventListener('mousedown', (e) => { if (e.target === m) hideModal(id); });
}

// 图片放大模态框（通用：以元素内容展示）
export function openImageModal(src) {
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('modalImg');
  // 清空可能残留的视频元素
  const leftover = modal.querySelectorAll('video');
  leftover.forEach(v => v.remove());
  img.style.display = '';
  img.src = src;
  modal.style.display = 'flex';
}

// 视频放大模态框（复用同一 img 后的视频元素，避免重复追加）
export function openVideoModal(url) {
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('modalImg');
  img.style.display = 'none';
  let video = modal.querySelector('video#zoom-video');
  if (!video) {
    video = document.createElement('video');
    video.id = 'zoom-video';
    video.controls = true;
    video.style.maxWidth = '90%';
    video.style.maxHeight = '90%';
    modal.appendChild(video);
  }
  video.src = url;
  video.load();
  modal.style.display = 'flex';
}

// ---- 进度条（简单文本/条状用于长操作）----
export function setProgress(elId, text) {
  const el = document.getElementById(elId);
  if (el) { el.style.display = 'block'; el.textContent = text; }
}

export function hideProgress(elId) {
  const el = document.getElementById(elId);
  if (el) el.style.display = 'none';
}

// 内联文本进度（用于按钮内）——支持 HTML（含图标）或纯文本
export function buttonProgress(btn, text) {
  if (!btn) return;
  // 如果文本包含 < 则视为 HTML（含图标），否则作为纯文本
  if (text && typeof text === 'string' && text.includes('<')) {
    btn.innerHTML = text;
  } else {
    btn.textContent = text;
  }
}

// ---- 本地存储工具（全项目唯一实现，try/catch 防隐私模式/超限报错）----
// 语义统一：读取失败返回 null，写入/删除成功返回 true、失败返回 false，
// 调用方据此决定是否降级（如关闭缓存）或给出一次性提示。
export function lsGet(k) {
  try { return localStorage.getItem(k); } catch (e) { return null; }
}
export function lsSet(k, v) {
  try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
}
export function lsDel(k) {
  try { localStorage.removeItem(k); return true; } catch (e) { return false; }
}

// ---- 统一下载：创建 blob URL 触发下载，延迟回收避免 URL 泄漏 ----
// 立即 revoke 会让部分浏览器取消下载，故延迟 10 秒回收（与原配置导出行为一致）。
export function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---- 拖拽高亮辅助（支持文件夹：webkitGetAsEntry）----
export function wireDragDrop(zoneId, onFiles, options = {}) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  const hint = zone.querySelector('#dropHint');
  let dragDepth = 0;
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; zone.classList.add('drag-over'); if (hint) hint.style.display = 'block'; });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); });
  zone.addEventListener('dragleave', (e) => { e.preventDefault(); dragDepth--; if (dragDepth <= 0) { dragDepth = 0; zone.classList.remove('drag-over'); if (hint) hint.style.display = 'none'; } });
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0; zone.classList.remove('drag-over'); if (hint) hint.style.display = 'none';
    const items = Array.from(e.dataTransfer.items || []);
    const filesPromises = [];
    for (const item of items) {
      // 尝试文件夹读取（webkitGetAsEntry）
      if (item.webkitGetAsEntry) {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          if (entry.isDirectory) {
            filesPromises.push(onFiles(entry)); // 传入目录 entry，调用方递归处理
            continue;
          } else if (entry.isFile) {
            filesPromises.push(new Promise(resolve => entry.file(f => resolve([f]))));
            continue;
          }
        }
      }
      // 普通文件
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) filesPromises.push([file]);
      }
    }
    const allFiles = (await Promise.all(filesPromises)).flat();
    if (allFiles.length) onFiles(allFiles);
  });
}
