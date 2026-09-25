// ============================================================================
// electron/preload.js —— Electron 预加载脚本（暴露安全 API 给渲染进程）
// ============================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  // 文件夹选择
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  // 平台检测
  platform: process.platform,
});
