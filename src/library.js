// ============================================================================
// library.js —— 穿梭框文件库（左侧文件库 / 右侧待加密列表）+ 拖拽上传
//   功能6：重命名文件
//   功能7：文件库持久化缓存（localStorage，刷新后恢复）
// ============================================================================
import { $, toast, wireDragDrop, lsGet, lsSet, lsDel } from './ui.js';
import { sha256, hexFromBytes, arrBufToBase64, base64ToArrBuf } from './crypto.js';
import { icon } from './icons.js';
import Swal from 'sweetalert2';

const CACHE_KEY = 'wbwencrypt:library';

let leftItems = [];
let rightItems = [];
let nextId = 1;
let cacheEnabled = true;

// ---- 文件夹支持 ----
export function createFolder(name) {
  const folder = {
    id: nextId++,
    name: name.trim() || '新建文件夹',
    isFolder: true,
    expanded: false,
    children: [],
  };
  leftItems.push(folder);
  render();
  return folder;
}

export function getFolderById(id) {
  return leftItems.find(i => i.id === id && i.isFolder) || rightItems.find(i => i.id === id && i.isFolder);
}

export function addChildToFolder(folderId, childItem) {
  const folder = getFolderById(folderId);
  if (folder && folder.isFolder) {
    folder.children.push(childItem);
    if (!folder.expanded) folder.expanded = true;
    render();
    return true;
  }
  return false;
}

export function removeChildFromFolder(folderId, childId) {
  const folder = getFolderById(folderId);
  if (folder && folder.isFolder) {
    const idx = folder.children.findIndex(c => c.id === childId);
    if (idx !== -1) {
      const removed = folder.children.splice(idx, 1);
      revokeItemsUrls(removed);
      render();
      return true;
    }
  }
  return false;
}

export function toggleFolder(id) {
  const folder = leftItems.find(i => i.id === id && i.isFolder) || rightItems.find(i => i.id === id && i.isFolder);
  if (folder && folder.isFolder) {
    folder.expanded = !folder.expanded;
    render();
  }
}

// ---- 类型工具 ----
export function isEditableType(mime, filename) {
  return mime === 'text/html' || mime === 'text/plain' ||
    filename.endsWith('.html') || filename.endsWith('.txt') || filename.endsWith('.htm');
}
export function isImageType(mime) { return mime.startsWith('image/'); }
export function isVideoType(mime) { return mime.startsWith('video/'); }

// ---- 实例缓存存储（lsGet/lsSet 统一收敛在 ui.js，此处只做业务降级）----

// 缓存写入失败只提示一次，避免每次列表变更都刷屏
let warnedCacheFail = false;
function warnCacheFailOnce() {
  if (warnedCacheFail) return;
  warnedCacheFail = true;
  toast('文件库缓存写入失败：浏览器存储空间不足或被禁用，刷新后本次列表不会保留', 'error');
}

function dataUrlFromItem(item) {
  return URL.createObjectURL(new Blob([item.arrayBuffer], { type: item.mime }));
}

// 序列化单个条目（arrayBuffer -> base64；dataUrl 不持久化，用 arrayBuffer 重建）
function serializeItem(item) {
  if (item.isFolder) {
    return {
      id: item.id, name: item.name, isFolder: true, expanded: item.expanded,
      children: item.children.map(c => serializeItem(c)),
    };
  }
  return { id: item.id, name: item.name, mime: item.mime, hashHex: item.hashHex, bufferB64: arrBufToBase64(item.arrayBuffer) };
}
function deserializeItem(s) {
  if (s.isFolder) {
    return {
      id: s.id, name: s.name, isFolder: true, expanded: s.expanded || false,
      children: (s.children || []).map(c => deserializeItem(c)),
      arrayBuffer: new ArrayBuffer(0), dataUrl: null, mime: '', hashHex: '',
    };
  }
  return {
    id: s.id, name: s.name, mime: s.mime, hashHex: s.hashHex || '',
    arrayBuffer: base64ToArrBuf(s.bufferB64),
    dataUrl: null, // 下面重建
    isFolder: false,
  };
}

// 功能7：保存文件库缓存
// 注意：只有 lsSet 真实返回 false（写入抛异常）才关闭缓存；
// 写入成功时 lsSet 返回 true，禁止把成功路径误判为失败（回归用例见 tests/library.test.js）。
function saveCache() {
  if (!cacheEnabled) return;
  try {
    const payload = {
      nextId,
      left: leftItems.map(serializeItem),
      right: rightItems.map(serializeItem),
    };
    if (!lsSet(CACHE_KEY, JSON.stringify(payload))) {
      // 写入失败（超限）→ 关闭缓存，避免反复尝试，并给出一次性提示
      cacheEnabled = false;
      warnCacheFailOnce();
    }
  } catch (e) {
    cacheEnabled = false;
    warnCacheFailOnce();
  }
}

// 缓存是否仍可写（写入真实失败后会永久关闭）——供测试与排障观察
export function isCacheEnabled() { return cacheEnabled; }
function revokeItemsUrls(items) {
  for (const it of items) if (it && it.dataUrl) URL.revokeObjectURL(it.dataUrl);
}

// 统一替换条目预览 URL：先回收旧 URL 再建新的（编辑器/图片编辑器保存时共用）
export function setItemDataUrl(item, blob) {
  if (item.dataUrl) URL.revokeObjectURL(item.dataUrl);
  item.dataUrl = URL.createObjectURL(blob);
  return item.dataUrl;
}

// 功能7：恢复文件库缓存（页面加载时调用）
export function restoreCache() {
  try {
    const raw = lsGet(CACHE_KEY);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    if (payload && Array.isArray(payload.left) && Array.isArray(payload.right)) {
      // 整体替换前回收旧列表的 blob URL，避免重复恢复造成泄漏
      revokeItemsUrls(leftItems);
      revokeItemsUrls(rightItems);
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
  lsDel(CACHE_KEY);
}

// ---- 添加文件 ----
export async function addFileToLeft(file) {
  const ab = await file.arrayBuffer();
  let hashHex = '';
  try {
    hashHex = hexFromBytes(await sha256(ab));
  } catch (e) {
    // 哈希失败不阻断入库，hashHex 留空表示无内容摘要
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

// ---- 文件夹拖拽支持（webkitGetAsEntry）----
export async function addFolderToLib(directoryEntry) {
  const files = await readDirectoryEntries(directoryEntry);
  if (files.length === 0) return [];
  toast(`正在添加文件夹「${directoryEntry.name}」...`, 'info', 2000);
  const results = await addFilesToLeft(files);
  toast(`已添加 ${results.length} 个文件`, 'success');
  return results;
}

async function readDirectoryEntries(dirEntry) {
  const files = [];
  const reader = dirEntry.createReader();
  // 递归读取所有子目录
  const readEntries = () => new Promise((resolve) => {
    reader.readEntries((entries) => {
      if (entries.length === 0) { resolve(); return; }
      resolve(entries);
    });
  });
  let entries = await readEntries();
  while (entries.length > 0) {
    const promises = entries.map(entry => {
      if (entry.isFile) {
        return new Promise(resolve => entry.file(file => resolve(file)));
      } else if (entry.isDirectory) {
        return readDirectoryEntries(entry).then(fs => fs);
      }
    });
    const results = await Promise.all(promises);
    results.forEach(r => { if (Array.isArray(r)) files.push(...r); else if (r) files.push(r); });
    entries = await readEntries();
  }
  return files;
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
  // 先从文件夹中移除
  for (const folder of [...leftItems, ...rightItems]) {
    if (folder.isFolder && folder.children) {
      const idx = folder.children.findIndex(c => c.id === id);
      if (idx !== -1) {
        const removed = folder.children.splice(idx, 1);
        revokeItemsUrls(removed);
        render();
        return;
      }
    }
  }
  const removed = [...leftItems, ...rightItems].filter(i => i.id === id);
  leftItems = leftItems.filter(i => i.id !== id);
  rightItems = rightItems.filter(i => i.id !== id);
  revokeItemsUrls(removed); // 删除即回收 blob URL
  render();
}
export function updateItem(_item) {
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
  const span = document.createElement('span');
  span.innerText = item.name;
  span.title = item.name; // 悬停显示完整名称
  div.appendChild(span);

  // 三点菜单
  const menuWrapper = document.createElement('div');
  menuWrapper.className = 'action-menu';

  const menuBtn = document.createElement('button');
  menuBtn.className = 'action-menu-btn';
  menuBtn.title = '操作菜单';
  menuBtn.innerHTML = icon('more-vertical', 18);
  menuWrapper.appendChild(menuBtn);

  const dropdown = document.createElement('div');
  dropdown.className = 'action-menu-dropdown';

  // 构建菜单项
  for (const a of actions) {
    if (a.separator) {
      const sep = document.createElement('div');
      sep.className = 'action-menu-separator';
      dropdown.appendChild(sep);
    } else {
      const menuItem = document.createElement('div');
      menuItem.className = 'action-menu-item' + (a.danger ? ' danger' : '');
      menuItem.innerHTML = (a.icon || '') + ' ' + a.label;
      menuItem.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.remove('show');
        a.onclick(item, e);
      };
      dropdown.appendChild(menuItem);
    }
  }
  menuWrapper.appendChild(dropdown);
  div.appendChild(menuWrapper);

  // 点击菜单外关闭
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('show');
  };

  div.onclick = (e) => {
    if (menuWrapper.contains(e.target)) return;
    isRight ? moveToLeft(item.id) : moveToRight(item.id);
  };

  return div;
}

function makeFolderItem(folder, isRight) {
  const div = document.createElement('div');
  div.className = 'transfer-folder';
  // 展开/折叠按钮 + 文件夹名称
  const header = document.createElement('div');
  header.className = 'transfer-folder-header';
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'btn-sm folder-toggle';
  toggleBtn.innerHTML = folder.expanded ? icon('chevron-down', 14) : icon('chevron-right', 14);
  toggleBtn.style.marginInlineEnd = '4px';
  toggleBtn.onclick = (e) => { e.stopPropagation(); toggleFolder(folder.id); };
  header.appendChild(toggleBtn);

  const iconEl = document.createElement('div');
  iconEl.innerHTML = icon('folder-open', 20);
  iconEl.style.color = 'var(--code-blue)';
  header.appendChild(iconEl);

  const nameSpan = document.createElement('span');
  nameSpan.innerText = `${folder.name} (${folder.children.length})`;
  nameSpan.style.flex = '1';
  header.appendChild(nameSpan);

  div.appendChild(header);

  // 子项容器
  const childrenDiv = document.createElement('div');
  childrenDiv.className = 'transfer-folder-children';
  if (folder.expanded) {
    childrenDiv.style.display = 'block';
    for (const child of folder.children) {
      childrenDiv.appendChild(makeTransferItem(child, isRight, getItemActions()));
    }
  } else {
    childrenDiv.style.display = 'none';
  }
  div.appendChild(childrenDiv);

  // 操作按钮
  const btnGroup = document.createElement('div');
  btnGroup.style.display = 'flex'; btnGroup.style.gap = '4px';

  // 新建子文件夹
  const newFolderBtn = document.createElement('button');
  newFolderBtn.innerHTML = icon('folder-plus', 14);
  newFolderBtn.className = 'btn-sm';
  newFolderBtn.title = '新建子文件夹';
  newFolderBtn.onclick = async (e) => {
    e.stopPropagation();
    const { value } = await Swal.fire({
      title: '新建子文件夹',
      input: 'text',
      inputValue: '新建文件夹',
      showCancelButton: true,
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputValidator: (v) => (v && v.trim()) ? null : '文件夹名不能为空',
    });
    if (value) {
      const newFolder = createFolder(value);
      newFolder.parentId = folder.id;
      // 添加到当前文件夹
      const targetFolder = getFolderById(folder.id);
      if (targetFolder) {
        targetFolder.children.push(newFolder);
        if (!targetFolder.expanded) targetFolder.expanded = true;
        render();
        toast('文件夹已创建');
      }
    }
  };
  btnGroup.appendChild(newFolderBtn);

  // 删除文件夹（清空子项）
  const deleteBtn = document.createElement('button');
  deleteBtn.innerHTML = icon('trash-2', 14);
  deleteBtn.className = 'btn-sm';
  deleteBtn.title = '删除文件夹';
  deleteBtn.onclick = async (e) => {
    e.stopPropagation();
    const res = await Swal.fire({
      title: '确认删除文件夹',
      text: `确定要删除「${folder.name}」及其 ${folder.children.length} 个子项吗？`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    if (res.isConfirmed) {
      removeFolder(folder.id);
      toast('已删除文件夹', 'success');
    }
  };
  btnGroup.appendChild(deleteBtn);

  div.appendChild(btnGroup);

  // 点击空白处展开/折叠
  div.querySelector('.transfer-folder-header').onclick = (e) => {
    if (e.target.closest('.folder-toggle')) return;
    toggleFolder(folder.id);
  };

  return div;
}

function removeFolder(id) {
  const remove = (items) => {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        const removed = items.splice(i, 1);
        revokeItemsUrls(removed[0].children || [removed[0]]);
        return true;
      }
      if (items[i].isFolder && items[i].children) {
        if (remove(items[i].children)) return true;
      }
    }
    return false;
  };
  remove(leftItems) || remove(rightItems);
  render();
}

export function render() {
  const leftDiv = $('leftList'), rightDiv = $('rightList');
  const leftC = $('leftCount'), rightC = $('rightCount');
  if (!leftDiv || !rightDiv) return;
  leftDiv.innerHTML = ''; rightDiv.innerHTML = '';

  function setupDragForElement(el, id) {
    try {
      el.draggable = true;
      if (el.dataset) el.dataset.itemId = id;
    } catch (e) { /* 测试环境可能不支持 */ }
  }

  function renderItems(items, container) {
    for (const item of items) {
      if (item.isFolder) {
        const folderEl = makeFolderItem(item, false);
        setupDragForElement(folderEl, item.id);
        container.appendChild(folderEl);
      } else {
        const itemEl = makeTransferItem(item, false, getItemActions());
        setupDragForElement(itemEl, item.id);
        container.appendChild(itemEl);
      }
    }
  }

  renderItems(leftItems, leftDiv);
  renderItems(rightItems, rightDiv);

  // 为列表设置放置目标（仅浏览器环境）
  [leftDiv, rightDiv].forEach(list => {
    if (!list || typeof list.addEventListener !== 'function') return;
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.classList.add('drag-over');
    });
    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) list.classList.remove('drag-over');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      const id = parseInt(e.dataTransfer.getData('text/plain'));
      if (isNaN(id)) return;
      const moved = [...leftItems, ...rightItems].find(i => i.id === id);
      if (!moved) return;
      const targetIsRight = list === rightDiv;
      const currentIsRight = rightItems.some(i => i.id === id);
      if (currentIsRight !== targetIsRight) {
        if (targetIsRight) moveToRight(id);
        else moveToLeft(id);
      }
    });
  });

  leftC.innerText = leftItems.filter(i => !i.isFolder).length;
  rightC.innerText = rightItems.filter(i => !i.isFolder).length;
  saveCache();
}

// 动作钩子（由 main.js 注册）
const actionHooks = {
  editImage: null,
  editText: null,
};
export function registerActions(hooks) { Object.assign(actionHooks, hooks); }

function getItemActions() {
  const actions = [];
  if (actionHooks.editImage) actions.push({ icon: icon('image', 14), label: '编辑图片', onclick: (item) => actionHooks.editImage(item) });
  if (actionHooks.editText) actions.push({ icon: icon('file-text', 14), label: '编辑文本', onclick: (item) => { if (isEditableType(item.mime, item.name)) actionHooks.editText(item); } });
  actions.push({ icon: icon('pencil', 14), label: '重命名', onclick: async (item) => {
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
  }});
  actions.push({ separator: true });
  actions.push({ icon: icon('trash-2', 14), label: '删除', danger: true, onclick: async (item) => {
    const res = await Swal.fire({
      title: '确认删除',
      text: `确定要删除「${item.name}」吗？`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    if (res.isConfirmed) {
      removeItem(item.id);
      toast('已删除', 'success');
    }
  }});
  return actions;
}

// ---- 视图模式 ----
let currentViewMode = localStorage.getItem('wbw-view-mode') || 'list';
const viewModes = ['list', 'grid', 'details'];
const viewNames = { list: '列表', grid: '网格', details: '详情' };

export function setViewMode(mode) {
  if (!viewModes.includes(mode)) return;
  currentViewMode = mode;
  localStorage.setItem('wbw-view-mode', mode);
  updateViewModeUI();
  render();
}

export function getNextViewMode() {
  const idx = viewModes.indexOf(currentViewMode);
  return viewModes[(idx + 1) % viewModes.length];
}

export function getPrevViewMode() {
  const idx = viewModes.indexOf(currentViewMode);
  return viewModes[(idx - 1 + viewModes.length) % viewModes.length];
}

function updateViewModeUI() {
  const panel = document.querySelector('.transfer-container');
  if (!panel) return;
  panel.className = 'transfer-container view-' + currentViewMode;
  const label = $('viewModeLabel');
  if (label) label.innerText = viewNames[currentViewMode];
}

// ---- 打开本地文件夹（支持 Electron 和浏览器）----
export async function openLocalFolder() {
  const win = window.electronAPI;

  // Electron 环境：使用原生文件系统 API
  if (win && win.isElectron) {
    try {
      const result = await win.openFolder();
      if (result.canceled || !result.filePaths.length) return;

      const dirPath = result.filePaths[0];
      await win.setWorkspace(dirPath);

      // 读取文件夹内容
      const res = await win.readDir(dirPath);
      if (!res.success) {
        toast('读取文件夹失败：' + res.error, 'error');
        return;
      }

      // 递归读取所有文件和文件夹
      const files = [];
      async function readDirRecursive(dirPath) {
        const res = await win.readDir(dirPath);
        if (!res.success) {
          console.error('读取目录失败:', res.error);
          return;
        }
        for (const item of res.items) {
          if (item.isDirectory) {
            // 递归读取子文件夹
            await readDirRecursive(item.path);
          } else {
            const file = await readFileFromPath(item.path);
            if (file) files.push(file);
          }
        }
      }
      await readDirRecursive(dirPath);

      if (files.length === 0) {
        toast('文件夹中没有可添加的文件', 'warning');
        return;
      }

      await addFilesToLeft(files);
      toast(`已从「${path.basename(dirPath)}」添加 ${files.length} 个文件`, 'success');
    } catch (e) {
      toast('打开文件夹失败：' + (e && e.message ? e.message : '未知错误'), 'error');
    }
    return;
  }

  // 浏览器环境：使用 webkitGetAsEntry
  if (!window.showDirectoryPicker) {
    toast('当前浏览器不支持文件夹访问，请使用 Chrome/Edge', 'error');
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker();
    toast(`正在读取文件夹「${dirHandle.name}」...`, 'info', 2000);
    const files = await readDirectoryHandle(dirHandle);
    if (files.length === 0) return;
    await addFilesToLeft(files);
    toast(`已添加 ${files.length} 个文件`, 'success');
  } catch (e) {
    if (e.name !== 'AbortError') {
      toast('打开文件夹失败：' + (e && e.message ? e.message : '未知错误'), 'error');
    }
  }
}

// 从路径读取文件（Electron 环境）
async function readFileFromPath(filePath) {
  try {
    const win = window.electronAPI;
    const res = await win.readFile(filePath);
    if (!res.success) return null;

    const ext = path.extname(filePath).toLowerCase();
    // 更全面的 MIME 类型映射
    const mimeMap = {
      // 图片
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
      '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.tiff': 'image/tiff',
      // 视频
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.flv': 'video/x-flv',
      '.wmv': 'video/x-ms-wmv',
      // 音频
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
      // 文档
      '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html',
      '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
      '.xml': 'text/xml', '.md': 'text/markdown', '.pdf': 'application/pdf',
      // 压缩
      '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
      '.7z': 'application/x-7z-compressed', '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      // Office
      '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };

    return {
      id: nextId++,
      name: path.basename(filePath),
      mime: mimeMap[ext] || 'application/octet-stream',
      dataUrl: null,
      arrayBuffer: res.isBinary ? Uint8Array.from(atob(res.content), c => c.charCodeAt(0)).buffer : new TextEncoder().encode(res.content).buffer,
      hashHex: '',
      filePath: filePath,
    };
  } catch (e) {
    return null;
  }
}

// 路径工具（兼容 Node.js 和浏览器）
const path = {
  basename: (p) => p.split(/[/\\]/).pop(),
  extname: (p) => {
    const idx = p.lastIndexOf('.');
    return idx >= 0 ? p.slice(idx).toLowerCase() : '';
  },
  dirname: (p) => p.split(/[/\\]/).slice(0, -1).join('/'),
};

async function readDirectoryHandle(dirHandle, path = '') {
  const files = [];
  for await (const entry of dirHandle.values()) {
    const entryPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      file.webkitRelativePath = entryPath;
      files.push(file);
    } else if (entry.kind === 'directory') {
      const subFiles = await readDirectoryHandle(entry, entryPath);
      files.push(...subFiles);
    }
  }
  return files;
}

// ---- 初始化 ----
export function initLibrary({ hooks }) {
  registerActions(hooks);
  const addBtn = $('addFilesBtn');
  addBtn.addEventListener('change', (e) => {
    if (!e.target.files.length) return;
    addFilesToLeft(e.target.files)
      .then(() => toast(`已添加 ${e.target.files.length} 个文件`))
      .catch((err) => toast('添加文件失败：' + (err && err.message ? err.message : '未知错误'), 'error'))
      .finally(() => { e.target.value = ''; });
  });
  // 打开本地文件夹按钮
  $('openFolderBtn').onclick = openLocalFolder;
  // 新建文件夹按钮
  $('addFolderBtnClick').onclick = async () => {
    const { value } = await Swal.fire({
      title: '新建文件夹',
      input: 'text',
      inputValue: '新建文件夹',
      showCancelButton: true,
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputValidator: (v) => (v && v.trim()) ? null : '文件夹名不能为空',
    });
    if (value) {
      createFolder(value);
      toast('文件夹已创建');
    }
  };
  // 视图切换
  $('prevViewBtn').onclick = () => setViewMode(getPrevViewMode());
  $('nextViewBtn').onclick = () => setViewMode(getNextViewMode());
  // 初始化视图
  updateViewModeUI();
  $('toRightBtn').onclick = () => { if (leftItems.length) moveToRight(leftItems[0].id); };
  $('toLeftBtn').onclick = () => { if (rightItems.length) moveToLeft(rightItems[0].id); };
  $('toAllRightBtn').onclick = moveAllRight;
  wireDragDrop('dropZone', async (items) => {
    let files = [];
    if (items && typeof items.name === 'string' && items.isDirectory !== undefined) {
      try {
        files = await readDirectoryEntries(items);
      } catch (e) {
        toast('读取文件夹失败：' + (e && e.message ? e.message : '未知错误'), 'error');
        return;
      }
    } else {
      files = Array.from(items);
    }
    if (files.length === 0) return;
    addFilesToLeft(files)
      .then(() => toast(`已添加 ${files.length} 个文件`))
      .catch((err) => toast('添加文件失败：' + (err && err.message ? err.message : '未知错误'), 'error'));
  });
  // 功能7：恢复缓存
  const restored = restoreCache();
  if (restored) toast('已恢复上次的文件库');
  render();
}
