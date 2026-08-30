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
  tctx.drawImage(originalImageBitmap, 0, 0);

  let imageData = tctx.getImageData(0, 0, w, h);
  const sat = parseInt($('saturationSlider').value, 10) / 100;
  const contrast = parseInt($('contrastSlider').value, 10) / 100;
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const satR = gray + (r - gray) * sat;
    const satG = gray + (g - gray) * sat;
    const satB = gray + (b - gray) * sat;
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    d[i] = Math.min(255, Math.max(0, factor * (satR - 128) + 128));
    d[i + 1] = Math.min(255, Math.max(0, factor * (satG - 128) + 128));
    d[i + 2] = Math.min(255, Math.max(0, factor * (satB - 128) + 128));
  }
  tctx.putImageData(imageData, 0, 0);

  const mosaic = parseInt($('mosaicSlider').value, 10);
  if (mosaic > 0) {
    for (let y = 0; y < h; y += mosaic) {
      for (let x = 0; x < w; x += mosaic) {
        const px = tctx.getImageData(x, y, 1, 1).data;
        tctx.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`;
        tctx.fillRect(x, y, mosaic, mosaic);
      }
    }
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
  const start = (e) => { e.preventDefault(); isDrawing = true; const p = getPointerPos(e); addMarker(p.x, p.y); applyAllEffects(); };
  const move = (e) => { if (!isDrawing) return; e.preventDefault(); const p = getPointerPos(e); addMarker(p.x, p.y); applyAllEffects(); };
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
    $(id).addEventListener('input', () => { updateSliderDisplays(); applyAllEffects(); });
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
