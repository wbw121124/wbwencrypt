// ============================================================================
// main.js —— 入口：装配各模块并接线（加密业务流在 encryptFlow.js）
// ============================================================================
import './style.css';
import { $, toast, wireDismissModal, wireDialogModals } from './ui.js';
import { initLibrary, isImageType } from './library.js';
import { initExplorer } from './explorer.js';
import { initEditor, openEditorForItem } from './editor.js';
import { initImageEditor, openImageEditor } from './imageEditor.js';
import { initCamera } from './camera.js';
import { initDecrypt } from './decrypt.js';
import { listStoredRecords, clearKeyForHash, clearAllKeys } from './key.js';
import { setupConfigPanel } from './settings.js';
import { injectIcons, icon } from './icons.js';
import { runEncryptFlow } from './encryptFlow.js';

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

// ---- 全局异常兜底 ----
// 未被 catch 的 Promise 拒绝与脚本错误统一给出中文提示；
// 已被各业务处 catch 的错误不会冒泡到这里，因此不会重复弹出。
function installGlobalErrorFallback() {
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const msg = (reason && reason.message) ? reason.message : String(reason || '未知原因');
    toast('发生未处理的错误：' + msg, 'error');
  });
  window.addEventListener('error', (e) => {
    // 资源加载错误不冒泡到 window，此处只会收到脚本执行错误
    if (e && e.message) toast('发生脚本错误：' + e.message, 'error');
  });
}

function setup() {
  // 先装全局兜底，再装配各模块
  installGlobalErrorFallback();

  // 填充 HTML 中的 [data-icon] 占位图标
  injectIcons();
  // Esc 关闭弹窗与焦点管理
  wireDialogModals();
  // 主题切换
  initThemeToggle();
  // 标题栏控制（仅Electron环境）
  initTitlebar();

  // 模态框点击空白关闭
  wireDismissModal('imageModal');

  // 文件库动作钩子
  initLibrary({
    hooks: {
      editImage: (item) => { if (isImageType(item.mime)) openImageEditor(item); },
      editText: (item) => openEditorForItem(item),
    },
  });
  // 初始化文件资源管理器模式
  initExplorer();

  initEditor();
  initImageEditor();
  initCamera();
  initDecrypt();

  // 功能2：记忆密钥管理面板
  setupMemoryPanel();

  // 导入/导出配置（导入后刷新记忆面板）
  setupConfigPanel(() => renderMemoryPanel());

  // ---- 加密按钮（业务流在 encryptFlow.js，这里只做接线与记忆面板刷新）----
  $('transferEncryptBtn').onclick = () => runEncryptFlow(renderMemoryPanel);

  // 密码派生开关联动
  const pwdCheck = $('usePasswordDerive');
  pwdCheck.addEventListener('change', () => { $('passwordDeriveInput').disabled = !pwdCheck.checked; });
}

// ---- 主题切换 ----
function getTheme() {
  return localStorage.getItem('wbw-theme') || 'auto';
}
function setTheme(t) {
  localStorage.setItem('wbw-theme', t);
  document.documentElement.setAttribute('data-theme', t === 'auto' ? '' : t);
  const icon = $('themeToggle');
  if (icon) { icon.setAttribute('data-icon', t === 'light' ? 'sun' : 'moon'); injectIcons(icon.parentElement); }
}
function initThemeToggle() {
  const t = getTheme();
  document.documentElement.setAttribute('data-theme', t === 'auto' ? '' : t);
  const icon = $('themeToggle');
  if (icon) {
    icon.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }
}

// ---- 标题栏控制（Electron）----
function initTitlebar() {
  const win = window.electronAPI;
  if (!win) return;
  $('titlebarMinimize').onclick = win.minimizeWindow;
  $('titlebarMaximize').onclick = win.maximizeWindow;
  $('titlebarClose').onclick = win.closeWindow;
}

setup();
