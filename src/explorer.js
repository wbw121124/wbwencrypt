// ============================================================================
// explorer.js —— 文件资源管理器（两种视图共用同一数据源）
// ============================================================================
import { $, toast } from './ui.js';
import { icon } from './icons.js';
import Swal from 'sweetalert2';
import * as libraryModule from './library.js';

// 视图模式
export const VIEW_MODES = {
  CLASSIC: 'classic',
  EXPLORER: 'explorer',
};

let currentViewMode = localStorage.getItem('wbw-view-mode') || VIEW_MODES.CLASSIC;

// 初始化资源管理器
export function initExplorer() {
  // 添���视图切换按钮
  const toolbar = document.querySelector('.file-area');
  if (!toolbar) return;

  const modeToggle = document.createElement('button');
  modeToggle.id = 'viewModeToggle';
  modeToggle.className = 'btn-outline btn-sm';
  modeToggle.title = '切换视图模式';
  modeToggle.innerHTML = icon('layout', 14) + ' 资源管理器';
  modeToggle.style.marginInlineStart = 'auto';
  toolbar.querySelector('.flex-row')?.appendChild(modeToggle);

  modeToggle.onclick = () => toggleViewMode();

  // 初始化视图
  applyViewMode();
}

function toggleViewMode() {
  if (currentViewMode === VIEW_MODES.CLASSIC) {
    currentViewMode = VIEW_MODES.EXPLORER;
    localStorage.setItem('wbw-view-mode', VIEW_MODES.EXPLORER);
    applyViewMode();
    toast('已切换到资源管理器模式');
  } else {
    currentViewMode = VIEW_MODES.CLASSIC;
    localStorage.setItem('wbw-view-mode', VIEW_MODES.CLASSIC);
    applyViewMode();
    toast('已切换到经典模式');
  }
}

function applyViewMode() {
  const classicPanel = document.querySelector('.transfer-container');
  const explorerContainer = document.getElementById('explorerContainer');

  if (currentViewMode === VIEW_MODES.EXPLORER) {
    if (classicPanel) classicPanel.style.display = 'none';
    if (!explorerContainer) createExplorerView();
    if (explorerContainer) explorerContainer.style.display = 'flex';
  } else {
    if (classicPanel) classicPanel.style.display = 'flex';
    if (explorerContainer) explorerContainer.style.display = 'none';
  }
}

function createExplorerView() {
  const container = document.createElement('div');
  container.id = 'explorerContainer';
  container.className = 'explorer-container';
  container.innerHTML = `
    <div class="explorer-toolbar">
      <button id="explorerOpenFolder" title="打开文件夹">${icon('folder-open', 16)}</button>
      <button id="explorerBack" title="后退" disabled>${icon('chevron-left', 16)}</button>
      <button id="explorerForward" title="前进" disabled>${icon('chevron-right', 16)}</button>
      <button id="explorerUp" title="上级目录">${icon('arrow-up', 16)}</button>
      <button id="explorerRefresh" title="刷新">${icon('refresh-cw', 16)}</button>
      <div id="explorerPath" class="explorer-path">未选择文件夹</div>
      <button id="explorerNewFolder" title="新建文件夹">${icon('folder-plus', 16)}</button>
      <button id="explorerDelete" title="删除">${icon('trash-2', 16)}</button>
      <button id="explorerRename" title="重命名">${icon('pencil', 16)}</button>
      <button id="explorerSelectAll" title="全选">${icon('check-square', 16)}</button>
    </div>
    <div class="explorer-body">
      <div id="explorerSidebar" class="explorer-sidebar">
        <div class="sidebar-header">导航</div>
        <div id="explorerTree"></div>
      </div>
      <div id="explorerContent" class="explorer-content"></div>
    </div>
  `;

  const fileArea = document.querySelector('.file-area');
  fileArea?.appendChild(container);

  // 绑定事件
  $('explorerOpenFolder')?.addEventListener('click', openExplorerFolder);
  $('explorerBack')?.addEventListener('click', explorerBack);
  $('explorerForward')?.addEventListener('click', explorerForward);
  $('explorerUp')?.addEventListener('click', explorerUp);
  $('explorerRefresh')?.addEventListener('click', explorerRefresh);
  $('explorerNewFolder')?.addEventListener('click', explorerNewFolder);
  $('explorerDelete')?.addEventListener('click', explorerDelete);
  $('explorerRename')?.addEventListener('click', explorerRename);
  $('explorerSelectAll')?.addEventListener('click', explorerSelectAll);

  // 键盘快捷键
  setupExplorerKeys();

  // 同步数据
  syncExplorerData();
}

// 打开文件夹（共享 API）
export async function openExplorerFolder() {
  const win = window.electronAPI;

  // Electron 环境
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

      // 递归读取所有文件
      const files = [];
      await readDirRecursive(dirPath, files, win);

      if (files.length === 0) {
        toast('文件夹中没有可添加的文件', 'warning');
        return;
      }

      // 添加到左侧列表
      await libraryModule.addFilesToLeft(files);
      toast(`已从「${dirPath.split(/[/\\]/).pop()}」添加 ${files.length} 个文件`, 'success');

      // 更新资源管理器视图
      syncExplorerData();
    } catch (e) {
      toast('打开文件夹失败：' + (e && e.message ? e.message : '未知错误'), 'error');
    }
    return;
  }

  // 浏览器环境
  if (!window.showDirectoryPicker) {
    toast('当前浏览器不支持文件夹访问，请使用 Chrome/Edge', 'error');
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker();
    toast(`正在读取文件夹「${dirHandle.name}」...`, 'info', 2000);
    const files = await readDirectoryHandle(dirHandle);
    if (files.length === 0) return;
    await libraryModule.addFilesToLeft(files);
    toast(`已添加 ${files.length} 个文件`, 'success');
    syncExplorerData();
  } catch (e) {
    if (e.name !== 'AbortError') {
      toast('打开文件夹失败：' + (e && e.message ? e.message : '未知错误'), 'error');
    }
  }
}

async function readDirRecursive(dirPath, files, win) {
  const res = await win.readDir(dirPath);
  if (!res.success) return;

  for (const item of res.items) {
    if (item.isDirectory) {
      await readDirRecursive(item.path, files, win);
    } else {
      const fileRes = await win.readFile(item.path);
      if (fileRes.success) {
        const ext = item.path.split('.').pop()?.toLowerCase();
        const mimeMap = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm',
          txt: 'text/plain', html: 'text/html', json: 'application/json',
        };
        files.push({
          name: item.name,
          mime: mimeMap[ext] || 'application/octet-stream',
          arrayBuffer: fileRes.isBinary
            ? Uint8Array.from(atob(fileRes.content), c => c.charCodeAt(0)).buffer
            : new TextEncoder().encode(fileRes.content).buffer,
          filePath: item.path,
        });
      }
    }
  }
}

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

// 同步资源管理器数据
function syncExplorerData() {
  const leftItems = libraryModule.getLeftItems();
  const content = $('explorerContent');
  if (!content) return;

  content.innerHTML = '';

  // 只显示左侧列表（文件库）
  for (const item of leftItems) {
    const el = document.createElement('div');
    el.className = 'explorer-item';
    el.dataset.id = item.id;
    el.dataset.type = item.isFolder ? 'folder' : 'file';

    const iconEl = document.createElement('div');
    iconEl.className = 'explorer-item-icon';
    if (item.isFolder) {
      iconEl.innerHTML = icon('folder', 32);
      iconEl.style.color = 'var(--code-blue)';
    } else {
      const ext = item.filePath?.split('.').pop()?.toLowerCase() || '';
      const iconMap = {
        jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
        mp4: 'film', webm: 'film', avi: 'film',
        txt: 'file-text', html: 'code', js: 'code', json: 'file-text',
      };
      iconEl.innerHTML = icon(iconMap[ext] || 'file', 32);
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'explorer-item-name';
    nameEl.innerText = item.name;
    nameEl.title = item.name;

    el.appendChild(iconEl);
    el.appendChild(nameEl);

    // 双击添加到待加密列表
    el.ondblclick = () => {
      if (!item.isFolder) {
        libraryModule.moveToRight(item.id);
        toast(`已添加「${item.name}」到待加密列表`);
      }
    };

    content.appendChild(el);
  }
}

// 导航操作
function explorerBack() {}
function explorerForward() {}
function explorerUp() {}
function explorerRefresh() { syncExplorerData(); }
async function explorerNewFolder() {
  const { value } = await Swal.fire({
    title: '新建文件夹',
    input: 'text',
    inputValue: '新建文件夹',
    showCancelButton: true,
    confirmButtonText: '创建',
    cancelButtonText: '取消',
  });
  if (value) {
    libraryModule.createFolder(value);
    syncExplorerData();
    toast('文件夹已创建');
  }
}
function explorerDelete() {
  if (selectedItems.size === 0) {
    toast('请先选择要删除的项目', 'warning');
    return;
  }
  Swal.fire({
    title: '确认删除',
    text: `确定要删除选中的 ${selectedItems.size} 个项目吗？`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  }).then(async (res) => {
    if (res.isConfirmed) {
      for (const id of selectedItems) {
        libraryModule.removeItem(id);
      }
      selectedItems.clear();
      syncExplorerData();
      toast('已删除', 'success');
    }
  });
}
async function explorerRename() {
  if (selectedItems.size !== 1) {
    toast('请选择一个项目重命名', 'warning');
    return;
  }
  const id = Array.from(selectedItems)[0];
  const item = [...libraryModule.getLeftItems(), ...libraryModule.getRightItems()].find(i => i.id === id);
  if (!item) return;
  const { value } = await Swal.fire({
    title: '重命名',
    input: 'text',
    inputValue: item.name,
    showCancelButton: true,
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  });
  if (value && value !== item.name) {
    libraryModule.renameItem(id, value);
    syncExplorerData();
    toast('已重命名');
  }
}
function explorerSelectAll() {
  const content = $('explorerContent');
  if (!content) return;
  content.querySelectorAll('.explorer-item').forEach(el => {
    selectedItems.add(parseInt(el.dataset.id));
  });
  renderExplorerSelection();
}

function setupExplorerKeys() {
  document.addEventListener('keydown', (e) => {
    if (currentViewMode !== VIEW_MODES.EXPLORER) return;
    switch (e.key) {
      case 'Delete':
        if (document.activeElement.tagName !== 'INPUT') explorerDelete();
        break;
      case 'a':
        if (e.ctrlKey) { e.preventDefault(); explorerSelectAll(); }
        break;
    }
  });
}

let selectedItems = new Set();

function renderExplorerSelection() {
  document.querySelectorAll('.explorer-item').forEach(el => {
    const id = parseInt(el.dataset.id);
    el.classList.toggle('selected', selectedItems.has(id));
  });
}
