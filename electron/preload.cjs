// ============================================================================
// electron/preload.cjs —— Electron 预加载脚本（暴露安全 API 给渲染进程）
// ============================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ========== 窗口控制 ==========
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // ========== 工作目录管理 ==========
  setWorkspace: (dirPath) => ipcRenderer.invoke('workspace:set', dirPath),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),

  // ========== 文件系统操作 ==========
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content, isBinary) => ipcRenderer.invoke('fs:writeFile', filePath, content, isBinary),
  getFileInfo: (filePath) => ipcRenderer.invoke('fs:getFileInfo', filePath),

  // ========== 对话框 ==========
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFiles: (filters) => ipcRenderer.invoke('dialog:openFiles', filters),
  saveFile: (defaultPath) => ipcRenderer.invoke('dialog:saveFile', defaultPath),

  // ========== 平台检测 ==========
  platform: process.platform,
  isElectron: true,
});

// 浏览器环境
if (!window.electronAPI) {
  window.electronAPI = {
    isElectron: false,
    // 模拟 API 以便网页版也能运行
    openFolder: () => Promise.resolve({ canceled: true }),
    readDir: () => Promise.resolve({ success: false, error: '浏览器环境不支持' }),
  };
}
