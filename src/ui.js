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

export function alertInfo(message) { toast(message); }

// ---- 模态框 ----
export function showModal(id) { const m = document.getElementById(id); if (m) m.style.display = 'flex'; }
export function hideModal(id) { const m = document.getElementById(id); if (m) m.style.display = 'none'; }
export function toggleModal(id, on) { on ? showModal(id) : hideModal(id); }

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

// 内联文本进度（用于按钮内）——非进度条，仅更新文案
export function buttonProgress(btn, text) {
  if (btn) btn.textContent = text;
}

// ---- 拖拽高亮辅助 ----
export function wireDragDrop(zoneId, onFiles) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  const hint = zone.querySelector('#dropHint');
  let dragDepth = 0;
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; zone.classList.add('drag-over'); if (hint) hint.style.display = 'block'; });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); });
  zone.addEventListener('dragleave', (e) => { e.preventDefault(); dragDepth--; if (dragDepth <= 0) { dragDepth = 0; zone.classList.remove('drag-over'); if (hint) hint.style.display = 'none'; } });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0; zone.classList.remove('drag-over'); if (hint) hint.style.display = 'none';
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onFiles(files);
  });
}
