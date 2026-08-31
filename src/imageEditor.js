// ============================================================================
// imageEditor.js —— 图片编辑器（线稿/饱和度/对比度/马赛克/画笔标记）
// 修复：补充 touch / pointer 事件支持，移动端可标记
// ============================================================================
import { $, toast, hideModal, showModal } from './ui.js';
import { updateItem } from './library.js';

let currentEditItem = null;
let originalImageBitmap = null;
let editCanvasCtx = null;
let markerPoints = [];
let isDrawing = false;
let rafId = null;
let debounceTimer = null;

// 防抖函数（滑杆使用）
function debounceApply() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => applyAllEffects(), 60);
}

// rAF 节流函数（画笔使用）
function rafApply() {
  if (!rafId) {
    rafId = requestAnimationFrame(() => {
      applyAllEffects();
      rafId = null;
    });
  }
}

function updateSliderDisplays() {
  $('sketchVal').innerText = $('sketchSlider').value;
  $('satVal').innerText = $('saturationSlider').value;
  $('contVal').innerText = $('contrastSlider').value;
  $('mosaicVal').innerText = $('mosaicSlider').value;
}

function getPointerPos(e) {
  const canvas = $('editedCanvas');
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const pt = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
  const clientX = pt.clientX != null ? pt.clientX : (e.clientX || 0);
  const clientY = pt.clientY != null ? pt.clientY : (e.clientY || 0);
  let x = (clientX - rect.left) * scaleX;
  let y = (clientY - rect.top) * scaleY;
  x = Math.min(Math.max(0, x), canvas.width);
  y = Math.min(Math.max(0, y), canvas.height);
  return { x, y };
}

function addMarker(x, y) {
  markerPoints.push({ x, y, color: $('penColor').value, size: parseInt($('penSize').value, 10) });
}

function applyAllEffects() {
  if (!originalImageBitmap) return;
  const w = $('originalCanvas').width, h = $('originalCanvas').height;
  const temp = document.createElement('canvas');
  temp.width = w; temp.height = h;
  const tctx = temp.getContext('2d');

  // 使用原生 ctx.filter 处理饱和度/对比度（GPU加速，性能提升几十倍）
  const sat = parseInt($('saturationSlider').value, 10);
  const contrast = parseInt($('contrastSlider').value, 10);
  tctx.filter = `saturate(${sat}%) contrast(${contrast}%)`;
  tctx.drawImage(originalImageBitmap, 0, 0);
  tctx.filter = 'none';

  const mosaic = parseInt($('mosaicSlider').value, 10);
  if (mosaic > 0) {
    // 优化：一次性获取整张图片数据，避免每块都调用 getImageData（性能提升几10倍）
    let imageData = tctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let y = 0; y < h; y += mosaic) {
      for (let x = 0; x < w; x += mosaic) {
        const idx = (y * w + x) * 4;
        const r = d[idx], g = d[idx + 1], b = d[idx + 2];
        for (let dy = 0; dy < mosaic && y + dy < h; dy++) {
          for (let dx = 0; dx < mosaic && x + dx < w; dx++) {
            const i = ((y + dy) * w + (x + dx)) * 4;
            d[i] = r; d[i + 1] = g; d[i + 2] = b;
          }
        }
      }
    }
    tctx.putImageData(imageData, 0, 0);
  }

  const sketch = parseInt($('sketchSlider').value, 10);
  if (sketch > 0) {
    const img2 = tctx.getImageData(0, 0, w, h);
    const d2 = img2.data;
    for (let i = 0; i < d2.length; i += 4) {
      const gray = (d2[i] + d2[i + 1] + d2[i + 2]) / 3;
      const edge = 255 - gray;
      const v = Math.min(255, Math.max(0, 255 - (edge * sketch) / 100));
      d2[i] = d2[i + 1] = d2[i + 2] = v;
    }
    tctx.putImageData(img2, 0, 0);
  }

  for (const p of markerPoints) {
    tctx.beginPath();
    tctx.arc(p.x, p.y, p.size / 2, 0, 2 * Math.PI);
    tctx.fillStyle = p.color;
    tctx.fill();
  }

  editCanvasCtx.clearRect(0, 0, w, h);
  editCanvasCtx.drawImage(temp, 0, 0);
}

export async function openImageEditor(item) {
  currentEditItem = item;
  const blob = new Blob([item.arrayBuffer], { type: item.mime });
  const bitmap = await createImageBitmap(blob);
  originalImageBitmap = bitmap;
  $('originalCanvas').width = bitmap.width;
  $('originalCanvas').height = bitmap.height;
  $('editedCanvas').width = bitmap.width;
  $('editedCanvas').height = bitmap.height;
  $('originalCanvas').getContext('2d').drawImage(bitmap, 0, 0);
  editCanvasCtx = $('editedCanvas').getContext('2d');
  markerPoints = [];
  applyAllEffects();
  showModal('imageEditModal');
}

// ---- 触控/指针统一处理 ----
function bindPointerHandlers() {
  const canvas = $('editedCanvas');
  const start = (e) => { e.preventDefault(); isDrawing = true; const p = getPointerPos(e); addMarker(p.x, p.y); rafApply(); };
  const move = (e) => { if (!isDrawing) return; e.preventDefault(); const p = getPointerPos(e); addMarker(p.x, p.y); rafApply(); };
  const end = () => { isDrawing = false; };
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('touchcancel', end);
}

export function initImageEditor() {
  const sliders = ['sketchSlider', 'saturationSlider', 'contrastSlider', 'mosaicSlider'];
  for (const id of sliders) {
    $(id).addEventListener('input', () => { updateSliderDisplays(); debounceApply(); });
  }
  $('clearMarkersBtn').onclick = () => { markerPoints = []; applyAllEffects(); };
  $('applyMarkersBtn').onclick = () => applyAllEffects();
  $('closeImageEditBtn').onclick = () => hideModal('imageEditModal');
  $('cancelImageEditBtn').onclick = () => hideModal('imageEditModal');
  $('saveEditedImageBtn').onclick = async () => {
    if (!currentEditItem) return;
    const blob = await new Promise(res => $('editedCanvas').toBlob(res, currentEditItem.mime || 'image/png'));
    if (!blob) { toast('保存失败', 'error'); return; }
    currentEditItem.arrayBuffer = await blob.arrayBuffer();
    currentEditItem.dataUrl = URL.createObjectURL(blob);
    currentEditItem.mime = blob.type;
    currentEditItem.hashHex = '';
    updateItem(currentEditItem);
    hideModal('imageEditModal');
    toast('图片已更新');
  };
  bindPointerHandlers();
}
