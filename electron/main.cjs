// ============================================================================
// electron/main.cjs —— Electron 主进程（支持文件系统操作）
// ============================================================================
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { getDefaultKey, encryptBuffer, decryptBuffer } = require('./crypto.cjs');

let mainWindow;
let currentWorkspace = null;
let defaultKey = getDefaultKey();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hidden', // macOS 隐藏默认标题栏
    trafficLightPosition: { x: 10, y: 10 }, // macOS 控制按钮位置
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('ready-to-show', () => { mainWindow.show(); });
}

// ========== 窗口控制 ==========
ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.handle('window:close', () => { if (mainWindow) mainWindow.close(); });

// ========== 文件加密存储 ==========
ipcMain.handle('file:saveEncrypted', async (_event, filePath, content) => {
  try {
    const buffer = Buffer.from(content, 'base64');
    // 如果选择了工作目录，不加密直接保存；否则加密保存
    const dataToSave = currentWorkspace 
      ? buffer 
      : await encryptBuffer(buffer, defaultKey);
    
    await fs.writeFile(filePath, dataToSave);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('file:loadEncrypted', async (_event, filePath) => {
  try {
    let buffer = await fs.readFile(filePath);
    
    // 如果选择了工作目录，直接读取；否则尝试解密
    if (!currentWorkspace) {
      // 尝试解密
      try {
        buffer = await decryptBuffer(buffer, defaultKey);
      } catch (e) {
        // 解密失败，可能是明文文件或损坏
        return { success: true, content: buffer.toString('base64'), isEncrypted: false };
      }
    }
    
    return { success: true, content: buffer.toString('base64') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ========== 工作目录管理 ==========
ipcMain.handle('workspace:set', async (_event, dirPath) => {
  currentWorkspace = dirPath;
  return { success: true, path: dirPath };
});

ipcMain.handle('workspace:get', () => {
  return { 
    path: currentWorkspace,
    isUsingDefaultKey: !currentWorkspace 
  };
});

// ========== 文件系统操作 ==========
ipcMain.handle('fs:readDir', async (_event, dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const stat = await fs.stat(fullPath);
      items.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
    // 文件夹优先排序
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    return { success: true, items };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:readFile', async (_event, filePath) => {
  try {
    const buffer = await fs.readFile(filePath);
    // 尝试检测编码
    const isBinary = isBinaryFile(buffer);
    if (isBinary) {
      return { success: true, content: buffer.toString('base64'), isBinary: true };
    } else {
      return { success: true, content: buffer.toString('utf-8'), isBinary: false };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:writeFile', async (_event, filePath, content, isBinary) => {
  try {
    let buffer;
    if (isBinary) {
      buffer = Buffer.from(content, 'base64');
    } else {
      buffer = Buffer.from(content, 'utf-8');
    }
    await fs.writeFile(filePath, buffer);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:getFileInfo', async (_event, filePath) => {
  try {
    const stat = await fs.stat(filePath);
    return {
      success: true,
      info: {
        name: path.basename(filePath),
        path: filePath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        isDirectory: stat.isDirectory(),
        ext: path.extname(filePath),
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ========== 文件夹选择 ==========
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择工作文件夹',
  });
  return result;
});

// ========== 文件选择 ==========
ipcMain.handle('dialog:openFiles', async (_event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: filters || [{ name: '所有文件', extensions: ['*'] }],
  });
  return result;
});

// ========== 保存文件 ==========
ipcMain.handle('dialog:saveFile', async (_event, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath,
    filters: [
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  return result;
});

// ========== 辅助函数 ==========
function isBinaryFile(buffer) {
  // 检查是否为二进制文件（通过 NUL 字节）
  for (let i = 0; i < Math.min(buffer.length, 8000); i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

// ========== 应用生命周期 ==========
app.whenReady().then(() => { createWindow(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 关闭前提示未保存更改
app.on('before-quit', async (event) => {
  if (mainWindow && mainWindow.webContents.isCrashed()) return;
  // 这里可以添加未保存更改检查逻辑
});
