// ============================================================================
// library.js —— 穿梭框文件库（左侧文件库 / 右侧待加密列表）+ 拖拽上传
//   功能6：重命名文件
//   功能7：文件库持久化缓存（localStorage，刷新后恢复）
// ============================================================================
import { $, toast, wireDragDrop } from './ui.js';
import { sha256, hexFromBytes, arrBufToBase64, base64ToArrBuf } from './crypto.js';
import { icon } from './icons.js';
import Swal from 'sweetalert2';

const CACHE_KEY = 'wbwencrypt:library';

let leftItems = [];
let rightItems = [];
let nextId = 1;
let cacheEnabled = true;

// ---- 类型工具 ----
export function isEditableType(mime, filename) {
  return mime === 'text/html' || mime === 'text/plain' ||
    filename.endsWith('.html') || filename.endsWith('.txt') || filename.endsWith('.htm');
}
export function isImageType(mime) { return mime.startsWith('image/'); }
export function isVideoType(mime) { return mime.startsWith('video/'); }

// ---- 实例缓存存储 ----
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

function dataUrlFromItem(item) {
  return URL.createObjectURL(new Blob([item.arrayBuffer], { type: item.mime }));
}

// 序列化单个条目（arrayBuffer -> base64；dataUrl 不持久化，用 arrayBuffer 重建）
function serializeItem(item) {
  return { id: item.id, name: item.name, mime: item.mime, hashHex: item.hashHex, bufferB64: arrBufToBase64(item.arrayBuffer) };
}
function deserializeItem(s) {
  return {
    id: s.id, name: s.name, mime: s.mime, hashHex: s.hashHex || '',
    arrayBuffer: base64ToArrBuf(s.bufferB64),
    dataUrl: null, // 下面重建
  };
}

// 功能7：保存文件库缓存
function saveCache() {
  if (!cacheEnabled) return;
  try {
    const payload = {
      nextId,
      left: leftItems.map(serializeItem),
      right: rightItems.map(serializeItem),
    };
    if (!lsSet(CACHE_KEY, JSON.stringify(payload))) {
      // 写入失败（超限）→ 关闭缓存，避免反复尝试
      cacheEnabled = false;
    }
  } catch (e) { cacheEnabled = false; }
}

// 功能7：恢复文件库缓存（页面加载时调用）
export function restoreCache() {
  try {
    const raw = lsGet(CACHE_KEY);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    if (payload && Array.isArray(payload.left) && Array.isArray(payload.right)) {
      leftItems = payload.left.map(deserializeItem).map(it => { it.dataUrl = dataUrlFromItem(it); return it; });
      rightItems = payload.right.map(deserializeItem).map(it => { it.dataUrl = dataUrlFromItem(it); return it; });
      nextId = (payload.nextId && payload.nextId > 1) ? payload.nextId : 1;
      render();
      return true;
    }
  } catch (e) { /* 损坏的缓存忽略 */ }
  return false;
}

export function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
}

// ---- 添加文件 ----
export async function addFileToLeft(file, { contentHash } = {}) {
  const ab = await file.arrayBuffer();
  let hashHex = contentHash;
  if (!hashHex) {
    try { hashHex = hexFromBytes(await sha256(ab)); } catch (e) { hashHex = ''; }
  }
  const url = URL.createObjectURL(file);
  const item = {
    id: nextId++,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    dataUrl: url,
    arrayBuffer: ab,
    hashHex,
  };
  leftItems.push(item);
  render();
  return item;
}

export function addFilesToLeft(files) {
  return Promise.all(Array.from(files).map(f => addFileToLeft(f)));
}

// ---- 穿梭 ----
export function getLeftItems() { return leftItems; }
export function getRightItems() { return rightItems; }
export function moveToRight(id) {
  const idx = leftItems.findIndex(i => i.id === id);
  if (idx !== -1) { rightItems.push(leftItems[idx]); leftItems.splice(idx, 1); render(); }
}
export function moveToLeft(id) {
  const idx = rightItems.findIndex(i => i.id === id);
  if (idx !== -1) { leftItems.push(rightItems[idx]); rightItems.splice(idx, 1); render(); }
}
export function moveAllRight() { rightItems.push(...leftItems); leftItems = []; render(); }
// 功能3：加密完成后清空待加密列表（移回左侧）
export function clearRight() {
  leftItems.push(...rightItems);
  rightItems = [];
  render();
}
export function removeItem(id) {
  leftItems = leftItems.filter(i => i.id !== id);
  rightItems = rightItems.filter(i => i.id !== id);
  render();
}
export function updateItem(item) {
  render();
}

// 功能6：重命名文件
export function renameItem(id, newName) {
  const item = leftItems.find(i => i.id === id) || rightItems.find(i => i.id === id);
  if (!item) return false;
  newName = (newName || '').trim();
  if (!newName) return false;
  item.name = newName;
  render();
  return true;
}

// ---- 渲染 ----
function makeTransferItem(item, isRight, actions) {
  const div = document.createElement('div');
  div.className = 'transfer-item';
  // 悬停显示内容哈希摘要（功能5）
  if (item.hashHex) div.title = `${item.name}\nSHA-256: ${item.hashHex.slice(0, 16)}… (${item.hashHex})`;
  const isImage = isImageType(item.mime);
  if (isImage) {
    const img = document.createElement('img'); img.src = item.dataUrl; div.appendChild(img);
  } else {
    const iconEl = document.createElement('div'); iconEl.className = 'doc-icon';
    iconEl.innerHTML = isVideoType(item.mime) ? icon('film', 30) : icon('file', 30);
    div.appendChild(iconEl);
  }
  const span = document.createElement('span'); span.innerText = item.name; div.appendChild(span);
  const btnGroup = document.createElement('div'); btnGroup.style.display = 'flex'; btnGroup.style.gap = '4px';
  for (const a of actions) {
    const b = document.createElement('button');
    b.innerHTML = a.icon || a.label; b.className = 'btn-sm'; b.title = a.title || '';
    b.style.display = 'inline-flex'; b.style.alignItems = 'center'; b.style.justifyContent = 'center';
    b.style.padding = '0.3rem 0.5rem';
    b.onclick = (e) => { e.stopPropagation(); a.onclick(item, e); };
    btnGroup.appendChild(b);
  }
  div.appendChild(btnGroup);
  div.onclick = (e) => { if (btnGroup.contains(e.target)) return; isRight ? moveToLeft(item.id) : moveToRight(item.id); };
  return div;
}

export function render() {
  const leftDiv = $('leftList'), rightDiv = $('rightList');
  const leftC = $('leftCount'), rightC = $('rightCount');
  if (!leftDiv || !rightDiv) return;
  leftDiv.innerHTML = ''; rightDiv.innerHTML = '';
  leftItems.forEach(it => leftDiv.appendChild(makeTransferItem(it, false, getItemActions())));
  rightItems.forEach(it => rightDiv.appendChild(makeTransferItem(it, true, getItemActions())));
  leftC.innerText = leftItems.length;
  rightC.innerText = rightItems.length;
  saveCache(); // 功能7：任意变更后持久化
}

// 动作钩子（由 main.js 注册）
const actionHooks = {
  editImage: null,
  editText: null,
};
export function registerActions(hooks) { Object.assign(actionHooks, hooks); }

function getItemActions() {
  const actions = [];
  if (actionHooks.editImage) actions.push({ icon: icon('image'), title: '编辑图片', onclick: (item) => actionHooks.editImage(item) });
  if (actionHooks.editText) actions.push({ icon: icon('file-text'), title: '编辑文本', onclick: (item) => { if (isEditableType(item.mime, item.name)) actionHooks.editText(item); } });
  // 功能6：重命名（sweetalert2 输入框）
  actions.push({
    icon: icon('pencil'), title: '重命名',
    onclick: async (item) => {
      const { value } = await Swal.fire({
        title: '重命名文件',
        input: 'text',
        inputValue: item.name,
        showCancelButton: true,
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValidator: (v) => (v && v.trim()) ? null : '文件名不能为空',
      });
      if (value && renameItem(item.id, value)) toast('已重命名');
    },
  });
  actions.push({ icon: icon('trash-2'), title: '删除', onclick: (item) => removeItem(item.id) });
  return actions;
}

// ---- 初始化 ----
export function initLibrary({ hooks, onAddFiles }) {
  registerActions(hooks);
  const addBtn = $('addFilesBtn');
  addBtn.addEventListener('change', (e) => {
    addFilesToLeft(e.target.files).then(() => { e.target.value = ''; }).catch(() => {});
  });
  $('toRightBtn').onclick = () => { if (leftItems.length) moveToRight(leftItems[0].id); };
  $('toLeftBtn').onclick = () => { if (rightItems.length) moveToLeft(rightItems[0].id); };
  $('toAllRightBtn').onclick = moveAllRight;
  wireDragDrop('dropZone', (files) => {
    addFilesToLeft(files).then(() => toast(`已添加 ${files.length} 个文件`)).catch(() => {});
  });
  // 功能7：恢复缓存
  const restored = restoreCache();
  if (restored) toast('已恢复上次的文件库');
  render();
}
