// ============================================================================
// decrypt.js —— 解密 + 多文件网格预览 + 单文件下载 + JSZip 批量 ZIP
// ============================================================================
import { $, toast, hideProgress, setProgress, openImageModal, openVideoModal, buttonProgress, downloadBlob } from './ui.js';
import { decryptEncodedBytes, decompress, sha256, splitPayload, importKeyFromB64 } from './crypto.js';
import { makeKeyResolver, rememberDecryptSuccess, getRememberedDecrypt } from './key.js';
import { icon } from './icons.js';
import { addFileToLeft, isImageType, isVideoType } from './library.js';
// 批量/单文件载荷的二进制契约统一归属 payload.js，此处只做解析结果的业务校验
import { parseBatchPayload, parseSinglePayload } from './payload.js';

function extFromMime(mime, fallback) {
  if (isImageType(mime)) { const e = mime.split('/')[1].replace('jpeg', 'jpg'); return e ? '.' + e : '.img'; }
  if (isVideoType(mime)) { const e = mime.split('/')[1]; return e ? '.' + e : '.mp4'; }
  if (mime === 'text/html') return '.html';
  if (mime === 'text/plain') return /\.txt$/i.test(fallback) ? '.txt' : '.' + (fallback.match(/\.[^.]*$/)?.[0] || 'txt');
  const extMatch = fallback.match(/\.[^.]*$/);
  return extMatch ? extMatch[0] : '.bin';
}

function arrayEqual(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }

// 结果网格预览用 blob URL 统一登记：重新渲染/清空结果前批量回收，避免泄漏
let previewUrls = [];
function releasePreviewUrls() {
  for (const u of previewUrls) URL.revokeObjectURL(u);
  previewUrls = [];
}

// ---- 文件网格渲染 ----
async function renderFileGrid(files, container) {
  releasePreviewUrls();
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'file-grid';

  for (const f of files) {
    const card = document.createElement('div');
    card.className = 'file-card';
    const blob = new Blob([f.dataBuffer], { type: f.mime });
    const url = URL.createObjectURL(blob);
    previewUrls.push(url);

    if (isImageType(f.mime)) {
      const img = document.createElement('img');
      img.src = url;
      img.onclick = () => openImageModal(url);
      card.appendChild(img);
    } else if (isVideoType(f.mime)) {
      const vid = document.createElement('video');
      vid.src = url; vid.muted = true; vid.controls = false;
      vid.style.width = '100%'; vid.style.height = '100px'; vid.style.objectFit = 'cover';
      vid.onclick = () => openVideoModal(url);
      card.appendChild(vid);
    } else {
      const icon = document.createElement('div');
      icon.innerText = '📄'; icon.style.fontSize = '48px'; icon.style.padding = '20px 0';
      card.appendChild(icon);
    }

    const nameSpan = document.createElement('div');
    nameSpan.className = 'fname'; nameSpan.innerText = f.name;
    card.appendChild(nameSpan);

    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex'; btnGroup.style.gap = '4px'; btnGroup.style.justifyContent = 'center';
    const dl = document.createElement('button');
    dl.innerText = '💾下载'; dl.className = 'btn-sm';
    // 单文件下载走统一工具：新建 URL 并延迟回收（预览 URL 仍留给缩略图使用）
    dl.onclick = (e) => { e.stopPropagation(); downloadBlob(f.name, blob); };
    btnGroup.appendChild(dl);
    const add = document.createElement('button');
    add.innerText = '📚+库'; add.className = 'btn-sm';
    add.onclick = async (e) => {
      e.stopPropagation();
      const fileObj = new File([f.dataBuffer], f.name, { type: f.mime });
      await addFileToLeft(fileObj);
      toast(`已添加 ${f.name}`);
    };
    btnGroup.appendChild(add);
    card.appendChild(btnGroup);
    grid.appendChild(card);
  }
  container.appendChild(grid);

  if (files.length > 1) {
    const actions = document.createElement('div');
    actions.className = 'batch-actions';
    const dlAll = document.createElement('button');
    dlAll.innerHTML = icon('download') + ' 下载全部文件 (ZIP打包)';
    dlAll.className = 'btn-sm';
    dlAll.onclick = async () => {
      dlAll.disabled = true; dlAll.innerText = '打包中...';
      try {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        for (const f of files) zip.file(f.name, f.dataBuffer);
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(`decrypted_files_${Date.now()}.zip`, zipBlob);
        toast('ZIP 已下载');
      } catch (e) {
        toast('ZIP 打包失败：' + (e.message || e), 'error');
      } finally { dlAll.disabled = false; dlAll.innerText = '⬇️ 下载全部文件 (ZIP打包)'; }
    };
    actions.appendChild(dlAll);
    container.appendChild(actions);
  }
}

// ---- 主解密 ----
async function decryptOne({ file, usePassword, inputStr }) {
  const encBuf = await file.arrayBuffer();
  setProgress('decryptProgress', '🔍 解密中...');

  // 密钥延迟到解析头部之后再导入：先判定是否本工具格式，
  // 否则非本工具文件会先报「密钥格式错误」，永远看不到格式提示
  const resolveKey = usePassword
    ? makeKeyResolver(true, inputStr)
    : () => importKeyFromB64(inputStr);
  // 分片解密进度：接入 onProgress，让 #decryptProgress 真实反映 i/n 与百分比
  const r = await decryptEncodedBytes(encBuf, resolveKey, {
    onProgress: (pct, i, count) => setProgress('decryptProgress', `🔐 解密分片 ${i}/${count} (${pct}%)`),
  });
  // 非本工具格式：头部 MAGIC 不匹配时按旧版解析只会报「载荷损坏」，这里直接给明确提示
  if (r.legacy) throw new Error('不是本工具生成的加密文件');
  const finalPlain = r.plain;

  const { hash: expectedHash, compressed } = splitPayload(finalPlain);
  setProgress('decryptProgress', '📦 解压载荷...');
  let decomp = await decompress(compressed);
  if (decomp.byteLength < 4) decomp = compressed;

  const asBatch = parseBatchPayload(decomp);
  if (asBatch) {
    const computed = await sha256(decomp);
    if (!arrayEqual(computed, expectedHash)) throw new Error('批量哈希校验失败');
    hideProgress('decryptProgress');
    return { badge: icon('check-circle') + ' 解密成功 (批量)', cls: 'success', msg: `✓ 完整性通过，共 ${asBatch.length} 个文件`, files: asBatch };
  }

  const single = parseSinglePayload(decomp);
  const original = await decompress(single.compressedData);
  const computedHash = await sha256(original);
  if (!arrayEqual(computedHash, single.expectedHash)) throw new Error('哈希校验失败');
  const fname = file.name.replace(/\.aes$/i, '').replace(/\.encrypted$/i, '') || 'decrypted';
  const base = fname.replace(/\.[^.]*$/, '');
  const properName = base + extFromMime(single.mimeType, fname);
  hideProgress('decryptProgress');
  return { badge: icon('check-circle') + ' 解密成功', cls: 'success', msg: '✓ 哈希验证通过', files: [{ name: properName, mime: single.mimeType, dataBuffer: original }] };
}

// ---- 初始化解密区 ----
export function initDecrypt() {
  const decryptFile = $('decryptFileInput');
  const nameSpan = $('decryptFileName');
  const statusDiv = $('decryptStatus');
  const verifyMsg = $('verifyMessage');
  const preview = $('decryptPreviewArea');
  const badge = statusDiv.querySelector('.status-badge');

  decryptFile.addEventListener('change', (e) => {
    nameSpan.innerText = e.target.files.length ? e.target.files[0].name : '未选择文件';
    preview.innerHTML = ''; verifyMsg.innerHTML = '';
    releasePreviewUrls(); // 换文件即回收上一结果的预览 URL
    badge.className = 'status-badge'; badge.innerText = '等待解密';
  });

  $('decryptBtn').onclick = async () => {
    if (!decryptFile.files.length) { toast('请上传加密文件', 'error'); return; }
    const inputStr = $('decryptKeyInput').value.trim();
    if (!inputStr) { toast('请输入密钥或密码', 'error'); return; }
    const usePassword = $('decryptUsePassword').checked;
    const btn = $('decryptBtn');
    badge.innerText = '🔍 解密验证...'; badge.className = 'status-badge';
    verifyMsg.innerHTML = ''; preview.innerHTML = ''; preview.style.display = 'none';
    btn.disabled = true; buttonProgress(btn, '⏳ 解密中...');
    try {
      const r = await decryptOne({ file: decryptFile.files[0], usePassword, inputStr });
      // 功能4：记忆成功解密的密钥凭据（仅密钥模式，密码模式不落盘）
      if (!usePassword) rememberDecryptSuccess({ type: 'key', keyB64: inputStr });
      badge.innerText = r.badge; badge.className = 'status-badge ' + r.cls;
      verifyMsg.innerHTML = `<span>${r.msg}</span>`;
      preview.style.display = 'block';
      await renderFileGrid(r.files, preview);
      buttonProgress(btn, icon('check-circle') + ' 解密完成');
    } catch (err) {
      releasePreviewUrls(); // 解密失败清空结果区，同步回收预览 URL
      badge.innerHTML = icon('x') + ' 失败'; badge.className = 'status-badge error';
      verifyMsg.innerHTML = `<span>${err.message}</span>`;
      preview.innerHTML = '';
      buttonProgress(btn, icon('zoom-in') + ' 解密并校验完整性');
      toast(err.message || '解密失败', 'error');
    } finally {
      btn.disabled = false;
      hideProgress('decryptProgress'); // 失败路径此前会残留「解密中...」，统一在这里收尾
    }
  };

  // 功能4：加载时若有历史密钥凭据，自动填入并提示
  const remembered = getRememberedDecrypt();
  if (remembered) {
    const decKeyInput = $('decryptKeyInput');
    if (!decKeyInput.value.trim()) {
      decKeyInput.value = remembered.keyB64;
      toast('已填入上次解密成功的密钥');
    }
  }
}
