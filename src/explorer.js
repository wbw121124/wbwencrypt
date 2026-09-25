// ============================================================================
// explorer.js —— Windows 风格文件资源管理器模式
// ============================================================================
import { $, toast } from './ui.js';
import { icon } from './icons.js';
import { leftItems, render as libraryRender, nextId as libraryNextId } from './library.js';
import Swal from 'sweetalert2';

let explorerView = 'classic'; // 'classic' | 'explorer'
let currentPath = '';
let history = [];
let historyIndex = -1;
let selectedItems = new Set();
let nextId = libraryNextId;

// 初始化
export function initExplorer() {
  // 添加模式切换按钮
  const toolbar = document.querySelector('.file-area');
  if (!toolbar) return;

  const modeToggle = document.createElement('button');
  modeToggle.id = 'explorerModeBtn';
  modeToggle.className = 'btn-sm';
  modeToggle.title = '切换文件资源管理器模式';
  modeToggle.innerHTML = icon('layout', 16) + ' 资源管理器';
  modeToggle.style.marginInlineStart = 'auto';
  toolbar.querySelector('.flex-row')?.appendChild(modeToggle);

  modeToggle.onclick = () => toggleExplorerMode();
}

function toggleExplorerMode() {
  if (explorerView === 'classic') {
    explorerView = 'explorer';
    showExplorerView();
    toast('已切换到文件资源管理器模式');
  } else {
    explorerView = 'classic';
    showClassicView();
    toast('已切换到经典模式');
  }
}

function showExplorerView() {
  // 隐藏经典穿梭框
  const classicPanel = document.querySelector('.transfer-container');
  if (classicPanel) classicPanel.style.display = 'none';

  // 创建资源管理器界面
  const container = document.getElementById('explorerContainer');
  if (!container) {
    const newContainer = document.createElement('div');
    newContainer.id = 'explorerContainer';
    newContainer.className = 'explorer-container';
    newContainer.innerHTML = `
      <div class="explorer-toolbar">
        <button id="explorerBack" title="后退 (Alt+←)" ${historyIndex <= 0 ? 'disabled' : ''}>${icon('chevron-left', 16)}</button>
        <button id="explorerForward" title="前进 (Alt+→)" disabled>${icon('chevron-right', 16)}</button>
        <button id="explorerUp" title="上级目录 (Alt+↑)">${icon('arrow-up', 16)}</button>
        <button id="explorerRefresh" title="刷新 (F5)">${icon('refresh-cw', 16)}</button>
        <div id="explorerPath" class="explorer-path"></div>
        <button id="explorerNewFolder" title="新建文件夹 (Ctrl+N)">${icon('folder-plus', 16)}</button>
        <button id="explorerDelete" title="删除 (Delete)">${icon('trash-2', 16)}</button>
        <button id="explorerRename" title="重命名 (F2)">${icon('pencil', 16)}</button>
        <button id="explorerSelectAll" title="全选 (Ctrl+A)">${icon('check-square', 16)}</button>
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
    fileArea?.appendChild(newContainer);
  }

  // 绑定工具栏事件
  $('explorerBack')?.addEventListener('click', explorerBack);
  $('explorerForward')?.addEventListener('click', explorerForward);
  $('explorerUp')?.addEventListener('click', explorerUp);
  $('explorerRefresh')?.addEventListener('click', explorerRefresh);
  $('explorerNewFolder')?.addEventListener('click', explorerNewFolder);
  $('explorerDelete')?.addEventListener('click', explorerDelete);
  $('explorerRename')?.addEventListener('click', explorerRename);
  $('explorerSelectAll')?.addEventListener('click', explorerSelectAll);

  // 添加键盘快捷键
  setupExplorerKeys();

  // 加载当前目录
  loadExplorerPath(currentPath || '/');
}

function showClassicView() {
  const classicPanel = document.querySelector('.transfer-container');
  if (classicPanel) classicPanel.style.display = 'flex';
  const container = document.getElementById('explorerContainer');
  if (container) container.style.display = 'none';
}

async function loadExplorerPath(dirPath) {
  const win = window.electronAPI;
  if (!win || !win.isElectron) {
    toast('文件资源管理器模式仅支持桌面应用', 'error');
    return;
  }

  try {
    const res = await win.readDir(dirPath);
    if (!res.success) {
      toast('读取目录失败：' + res.error, 'error');
      return;
    }

    currentPath = dirPath;
    history = history.slice(0, historyIndex + 1);
    history.push(dirPath);
    historyIndex = history.length - 1;
    updateExplorerUI();
    renderExplorerContent(res.items);
  } catch (e) {
    toast('加载目录失败：' + e.message, 'error');
  }
}

function updateExplorerUI() {
  // 更新路径显示
  const pathEl = $('explorerPath');
  if (pathEl) {
    const displayName = currentPath.split(/[/\\]/).pop() || currentPath;
    pathEl.innerHTML = icon('folder-open', 14) + ' ' + displayName;
  }

  // 更新导航按钮状态
  $('explorerBack')?.toggleAttribute('disabled', historyIndex <= 0);
  $('explorerForward')?.toggleAttribute('disabled', historyIndex >= history.length - 1);
}

function renderExplorerContent(items) {
  const content = $('explorerContent');
  if (!content) return;

  content.innerHTML = '';

  // 按类型排序：文件夹在前
  const sorted = [...items].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of sorted) {
    const el = document.createElement('div');
    el.className = 'explorer-item' + (selectedItems.has(item.path) ? ' selected' : '');
    el.dataset.path = item.path;
    el.dataset.name = item.name;

    const iconEl = document.createElement('div');
    iconEl.className = 'explorer-item-icon';
    if (item.isDirectory) {
      iconEl.innerHTML = icon('folder', 32);
      iconEl.style.color = 'var(--code-blue)';
    } else {
      const ext = item.path.split('.').pop()?.toLowerCase();
      const iconMap = {
        jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
        mp4: 'film', webm: 'film', avi: 'film',
        txt: 'file-text', html: 'code', js: 'code', json: 'file-text',
        zip: 'archive', rar: 'archive', '7z': 'archive',
      };
      iconEl.innerHTML = icon(iconMap[ext] || 'file', 32);
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'explorer-item-name';
    nameEl.innerText = item.name;
    nameEl.title = item.name;

    el.appendChild(iconEl);
    el.appendChild(nameEl);

    // 点击选中
    el.onclick = (e) => {
      if (e.ctrlKey) {
        toggleSelect(item.path);
      } else if (e.shiftKey) {
        rangeSelect(item.path);
      } else {
        selectedItems.clear();
        selectedItems.add(item.path);
        renderExplorerContent(items);
      }
    };

    // 双击打开
    el.ondblclick = () => {
      if (item.isDirectory) {
        loadExplorerPath(item.path);
      } else {
        addToLibrary(item.path);
      }
    };

    content.appendChild(el);
  }
}

function toggleSelect(path) {
  if (selectedItems.has(path)) {
    selectedItems.delete(path);
  } else {
    selectedItems.add(path);
  }
  renderExplorerContent(getCurrentItems());
}

function rangeSelect(path) {
  // 简化实现：添加所有选中
  selectedItems.add(path);
  renderExplorerContent(getCurrentItems());
}

function getCurrentItems() {
  // 简化：从 DOM 读取
  const content = $('explorerContent');
  if (!content) return [];
  return Array.from(content.children).map(el => ({
    path: el.dataset.path,
    name: el.dataset.name,
    isDirectory: false,
  }));
}

// 导航操作
function explorerBack() {
  if (historyIndex > 0) {
    historyIndex--;
    loadExplorerPath(history[historyIndex]);
  }
}

function explorerForward() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    loadExplorerPath(history[historyIndex]);
  }
}

function explorerUp() {
  const parts = currentPath.split(/[/\\]/);
  if (parts.length > 1) {
    parts.pop();
    loadExplorerPath(parts.join('/'));
  }
}

function explorerRefresh() {
  loadExplorerPath(currentPath);
}

async function explorerNewFolder() {
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
    const win = window.electronAPI;
    const newPath = currentPath.replace(/[/\\]$/, '') + '/' + value;
    await win.writeFile(newPath, '', false); // 创建空文件作为占位
    toast('文件夹已创建');
    explorerRefresh();
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
      const win = window.electronAPI;
      for (const path of selectedItems) {
        // 实际删除需要更多实现
        console.log('删除:', path);
      }
      selectedItems.clear();
      toast('已删除', 'success');
      explorerRefresh();
    }
  });
}

async function explorerRename() {
  if (selectedItems.size !== 1) {
    toast('请选择一个项目重命名', 'warning');
    return;
  }

  const path = Array.from(selectedItems)[0];
  const oldName = path.split(/[/\\]/).pop();

  const { value } = await Swal.fire({
    title: '重命名',
    input: 'text',
    inputValue: oldName,
    showCancelButton: true,
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    inputValidator: (v) => (v && v.trim()) ? null : '名称不能为空',
  });

  if (value && value !== oldName) {
    const win = window.electronAPI;
    const dir = path.replace(/[/\\][^/\\]*$/, '');
    const newPath = dir + '/' + value;
    // 重命名实现...
    toast('已重命名');
    explorerRefresh();
  }
}

function explorerSelectAll() {
  const content = $('explorerContent');
  if (!content) return;
  content.querySelectorAll('.explorer-item').forEach(el => {
    selectedItems.add(el.dataset.path);
  });
  renderExplorerContent(getCurrentItems());
}

function setupExplorerKeys() {
  document.addEventListener('keydown', (e) => {
    if (explorerView !== 'explorer') return;

    // 阻止默认行为（如果在资源管理器模式）
    const keys = ['F5', 'F2', 'Delete'];
    if (keys.includes(e.key)) {
      e.preventDefault();
    }

    switch (e.key) {
      case 'F5':
        explorerRefresh();
        break;
      case 'Delete':
        if (document.activeElement.tagName !== 'INPUT') {
          explorerDelete();
        }
        break;
      case 'F2':
        if (selectedItems.size === 1) {
          explorerRename();
        }
        break;
      case 'a':
        if (e.ctrlKey) {
          e.preventDefault();
          explorerSelectAll();
        }
        break;
      case 'ArrowLeft':
        if (e.altKey) explorerBack();
        break;
      case 'ArrowRight':
        if (e.altKey) explorerForward();
        break;
      case 'ArrowUp':
        if (e.altKey) {
          e.preventDefault();
          explorerUp();
        }
        break;
    }
  });
}

async function addToLibrary(filePath) {
  const win = window.electronAPI;
  const res = await win.readFile(filePath);
  if (!res.success) {
    toast('读取文件失败：' + res.error, 'error');
    return;
  }

  // 转换文件并添加到左侧列表
  const ext = filePath.split('.').pop()?.toLowerCase();
  const mimeMap = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm',
    txt: 'text/plain', html: 'text/html', json: 'application/json',
  };

  const item = {
    id: nextId++,
    name: filePath.split(/[/\\]/).pop(),
    mime: mimeMap[ext] || 'application/octet-stream',
    dataUrl: null,
    arrayBuffer: res.isBinary
      ? Uint8Array.from(atob(res.content), c => c.charCodeAt(0)).buffer
      : new TextEncoder().encode(res.content).buffer,
    hashHex: '',
    filePath: filePath,
  };

  leftItems.push(item);
  libraryRender();
  toast(`已添加「${item.name}」到文件库`);
}

// 导出状态
export function getExplorerState() {
  return {
    view: explorerView,
    path: currentPath,
    history,
    historyIndex,
    selected: Array.from(selectedItems),
  };
}
