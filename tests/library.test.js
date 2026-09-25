// ============================================================================
// tests/library.test.js —— 文件库穿梭逻辑单元测试
//   node 环境没有 DOM / localStorage，先注入最小桩对象，再动态加载模块
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { arrBufToBase64 } from '../src/crypto.js';

// sweetalert2 只在点击「重命名」按钮时才会用到，测试里不涉及交互，
// 直接替换为桩对象，避免其在 node 环境访问 DOM API。
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));

// ---- 最小 DOM 桩（render 只需要 innerHTML / innerText / appendChild）----
function fakeNode(tag = 'div') {
  return {
    tagName: String(tag).toUpperCase(),
    style: {},
    className: '',
    innerHTML: '',
    innerText: '',
    title: '',
    children: [],
    onclick: null,
    appendChild(child) { this.children.push(child); return child; },
    contains(target) { return this.children.includes(target); },
    addEventListener() {},
    remove() {},
  };
}

// 只有穿梭框渲染用到的容器返回桩节点，其余 id 一律返回 null
const RENDER_IDS = ['leftList', 'rightList', 'leftCount', 'rightCount'];
const nodes = new Map();

globalThis.document = {
  getElementById(id) {
    if (!RENDER_IDS.includes(id)) return null;
    if (!nodes.has(id)) nodes.set(id, fakeNode());
    return nodes.get(id);
  },
  createElement: (tag) => fakeNode(tag),
  body: fakeNode('body'),
};

// ---- localStorage 桩（内存 Map）----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

// ---- URL.createObjectURL 桩（node 中无法对普通对象取 blob URL）----
URL.createObjectURL = () => 'blob:mock-url';
// 回收桩：用于断言「删除/替换条目时确实 revoke 了旧 URL」
URL.revokeObjectURL = vi.fn();

const CACHE_KEY = 'wbwencrypt:library';
const lib = await import('../src/library.js');

// 构造一个带 arrayBuffer() 的文件替身
function fakeFile(name, bytes, type = 'text/plain') {
  const buf = bytes.buffer;
  return { name, type, arrayBuffer: async () => buf };
}

function pattern(len) {
  const u = new Uint8Array(len);
  for (let i = 0; i < len; i++) u[i] = (i * 13 + 5) & 0xff;
  return u;
}

function removeAll() {
  for (const item of [...lib.getLeftItems(), ...lib.getRightItems()]) lib.removeItem(item.id);
}

describe('library 穿梭逻辑', () => {
  beforeEach(() => {
    removeAll();
    store.clear();
  });

  it('添加文件后进入左侧列表并带内容哈希', async () => {
    const item = await lib.addFileToLeft(fakeFile('笔记.txt', pattern(128)));
    expect(lib.getLeftItems().length).toBe(1);
    expect(lib.getRightItems().length).toBe(0);
    expect(item.name).toBe('笔记.txt');
    expect(item.mime).toBe('text/plain');
    expect(item.hashHex).toHaveLength(64);
    expect(item.dataUrl).toBe('blob:mock-url');
  });

  it('moveToRight / moveToLeft 往返穿梭', async () => {
    const item = await lib.addFileToLeft(fakeFile('a.txt', pattern(16)));
    lib.moveToRight(item.id);
    expect(lib.getLeftItems().length).toBe(0);
    expect(lib.getRightItems().length).toBe(1);
    expect(lib.getRightItems()[0].id).toBe(item.id);

    lib.moveToLeft(item.id);
    expect(lib.getLeftItems().length).toBe(1);
    expect(lib.getRightItems().length).toBe(0);
  });

  it('不存在的 id 穿梭时保持原状', async () => {
    const item = await lib.addFileToLeft(fakeFile('a.txt', pattern(16)));
    lib.moveToRight(99999);
    expect(lib.getLeftItems().length).toBe(1);
    expect(lib.getRightItems().length).toBe(0);
    expect(lib.getLeftItems()[0].id).toBe(item.id);
  });

  it('moveAllRight 一次性把左侧全部移到右侧', async () => {
    await lib.addFileToLeft(fakeFile('1.txt', pattern(8)));
    await lib.addFileToLeft(fakeFile('2.txt', pattern(8)));
    await lib.addFileToLeft(fakeFile('3.txt', pattern(8)));
    lib.moveAllRight();
    expect(lib.getLeftItems().length).toBe(0);
    expect(lib.getRightItems().length).toBe(3);
  });

  it('clearRight 清空右侧并全部移回左侧（加密完成后的默认行为）', async () => {
    const a = await lib.addFileToLeft(fakeFile('a.txt', pattern(8)));
    const b = await lib.addFileToLeft(fakeFile('b.txt', pattern(8)));
    lib.moveAllRight();
    expect(lib.getRightItems().length).toBe(2);
    lib.clearRight();
    expect(lib.getRightItems().length).toBe(0);
    expect(lib.getLeftItems().length).toBe(2);
    expect(lib.getLeftItems().map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('removeItem 可从左/右两侧删除指定条目', async () => {
    const a = await lib.addFileToLeft(fakeFile('a.txt', pattern(8)));
    const b = await lib.addFileToLeft(fakeFile('b.txt', pattern(8)));
    lib.moveToRight(a.id);
    lib.removeItem(a.id); // 从右侧删
    expect(lib.getRightItems().length).toBe(0);
    lib.removeItem(b.id); // 从左侧删
    expect(lib.getLeftItems().length).toBe(0);
    lib.removeItem(b.id); // 重复删除不报错
    expect(lib.getLeftItems().length).toBe(0);
  });

  it('renameItem 重命名成功，空名与不存在的 id 返回 false', async () => {
    const a = await lib.addFileToLeft(fakeFile('原始名.txt', pattern(8)));
    expect(lib.renameItem(a.id, '  新名字.txt  ')).toBe(true);
    expect(lib.getLeftItems()[0].name).toBe('新名字.txt');
    expect(lib.renameItem(a.id, '   ')).toBe(false);
    expect(lib.renameItem(99999, '任意')).toBe(false);
    expect(lib.getLeftItems()[0].name).toBe('新名字.txt');
  });

  it('restoreCache 可从 localStorage 恢复左右两侧列表', () => {
    const payload = {
      nextId: 7,
      left: [{ id: 1, name: '左侧文件.txt', mime: 'text/plain', hashHex: 'ab'.repeat(32), bufferB64: arrBufToBase64(pattern(16)) }],
      right: [{ id: 2, name: '待加密文件.txt', mime: 'text/plain', hashHex: 'cd'.repeat(32), bufferB64: arrBufToBase64(pattern(32)) }],
    };
    store.set(CACHE_KEY, JSON.stringify(payload));
    expect(lib.restoreCache()).toBe(true);
    expect(lib.getLeftItems().map((i) => i.name)).toEqual(['左侧文件.txt']);
    expect(lib.getRightItems().map((i) => i.name)).toEqual(['待加密文件.txt']);
    expect(lib.getLeftItems()[0].hashHex).toBe('ab'.repeat(32));
    expect(lib.getLeftItems()[0].dataUrl).toBe('blob:mock-url');
    // 恢复后 nextId 继续自增，不与历史条目冲突
    expect(lib.getLeftItems()[0].id).toBe(1);
  });

  it('缓存缺失或内容损坏时 restoreCache 返回 false 且不抛错', () => {
    expect(lib.restoreCache()).toBe(false);
    store.set(CACHE_KEY, '这不是合法 JSON');
    expect(lib.restoreCache()).toBe(false);
    store.set(CACHE_KEY, JSON.stringify({ left: '不是数组' }));
    expect(lib.restoreCache()).toBe(false);
  });

  it('clearCache 清除缓存键', () => {
    store.set(CACHE_KEY, '{}');
    lib.clearCache();
    expect(store.has(CACHE_KEY)).toBe(false);
  });

  it('类型判断工具按扩展名/MIME 区分文本、图片、视频', () => {
    expect(lib.isEditableType('text/plain', 'a.bin')).toBe(true);
    expect(lib.isEditableType('text/html', 'a.bin')).toBe(true);
    expect(lib.isEditableType('application/octet-stream', 'a.html')).toBe(true);
    expect(lib.isEditableType('application/octet-stream', 'a.png')).toBe(false);
    expect(lib.isImageType('image/png')).toBe(true);
    expect(lib.isImageType('video/mp4')).toBe(false);
    expect(lib.isVideoType('video/webm')).toBe(true);
    expect(lib.isVideoType('image/gif')).toBe(false);
  });

  it('缓存写入成功时保持启用并持续落盘（回归：成功不得被误判为失败）', async () => {
    await lib.addFileToLeft(fakeFile('缓存A.txt', pattern(16)));
    expect(store.has(CACHE_KEY)).toBe(true);
    expect(lib.isCacheEnabled()).toBe(true);
    // 第二次变更仍应继续写入：写入成功后 cacheEnabled 不得被关掉
    await lib.addFileToLeft(fakeFile('缓存B.txt', pattern(16)));
    const payload = JSON.parse(store.get(CACHE_KEY));
    expect(payload.left.length).toBe(2);
    expect(lib.isCacheEnabled()).toBe(true);
  });

  it('删除条目与替换 dataUrl 时回收旧 blob URL', async () => {
    URL.revokeObjectURL.mockClear();
    const item = await lib.addFileToLeft(fakeFile('图.png', pattern(16), 'image/png'));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    lib.setItemDataUrl(item, new Blob(['新内容'], { type: 'text/plain' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    URL.revokeObjectURL.mockClear();
    lib.removeItem(item.id);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  // 放在最后执行：本用例会把 cacheEnabled 置为 false，避免影响前面的写入断言
  it('缓存写入真实失败（setItem 抛异常）时才关闭缓存', async () => {
    const original = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    try {
      await lib.addFileToLeft(fakeFile('写入失败.txt', pattern(8)));
      expect(lib.isCacheEnabled()).toBe(false);
    } finally {
      globalThis.localStorage.setItem = original;
    }
  });
});
