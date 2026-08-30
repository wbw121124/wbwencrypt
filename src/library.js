// ============================================================================
// library.js —— 穿梭框文件库（左侧图片库 / 右侧待加密列表）+ 拖拽上传
// ============================================================================
import { $, toast, wireDragDrop } from './ui.js';
import { sha256, hexFromBytes } from './crypto.js';

let leftItems = [];
let rightItems = [];
let nextId = 1;

// ---- 类型工具 ----
export function isEditableType(mime, filename) {
  return mime === 'text/html' || mime === 'text/plain' ||
    filename.endsWith('.html') || filename.endsWith('.txt') || filename.endsWith('.htm');
}
export function isImageType(mime) { return mime.startsWith('image/'); }
export function isVideoType(mime) { return mime.startsWith('video/'); }

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
export function removeItem(id) {
  leftItems = leftItems.filter(i => i.id !== id);
  rightItems = rightItems.filter(i => i.id !== id);
  render();
}
export function updateItem(item) {
  render();
}

// ---- 渲染 ----
function makeTransferItem(item, isRight, actions) {
  const div = document.createElement('div');
  div.className = 'transfer-item';
  const isImage = isImageType(item.mime);
  if (isImage) {
    const img = document.createElement('img'); img.src = item.dataUrl; div.appendChild(img);
  } else {
    const icon = document.createElement('div'); icon.className = 'doc-icon';
    icon.innerText = isVideoType(item.mime) ? '🎥' : '📄'; div.appendChild(icon);
  }
  const span = document.createElement('span'); span.innerText = item.name; div.appendChild(span);
  const btnGroup = document.createElement('div'); btnGroup.style.display = 'flex'; btnGroup.style.gap = '4px';
  for (const a of actions) {
    const b = document.createElement('button');
    b.innerText = a.label; b.className = 'btn-sm'; b.title = a.title || '';
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
}

// 动作钩子（由 main.js 注册：编辑图片/编辑文本/删除）
const actionHooks = {
  editImage: null,
  editText: null,
};
export function registerActions(hooks) { Object.assign(actionHooks, hooks); }

function getItemActions() {
  const actions = [];
  if (actionHooks.editImage) actions.push({ label: '🎨', title: '编辑图片', onclick: (item) => actionHooks.editImage(item) });
  if (actionHooks.editText) actions.push({ label: '✏️', title: '编辑文本', onclick: (item) => { if (isEditableType(item.mime, item.name)) actionHooks.editText(item); } });
  actions.push({ label: '🗑️', title: '删除', onclick: (item) => removeItem(item.id) });
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
  render();
}
