// ============================================================================
// decrypt.js —— 解密 + 多文件网格预览 + 单文件下载 + JSZip 批量 ZIP
// ============================================================================
import { $, toast, hideProgress, setProgress, openImageModal, openVideoModal } from './ui.js';
import { decryptEncodedBytes, decompress, sha256, splitPayload, uint8FromBuffer, importKeyFromB64, deriveKeyFromPasswordIter } from './crypto.js';
import { makeKeyResolver } from './key.js';
import { addFileToLeft } from './library.js';

// ---- 批量载荷解析（继承旧版"多重"格式） ----
function parseBatchPayload(buf) {
  const u = uint8FromBuffer(buf);
  if (u.length < 4 || String.fromCharCode(u[0], u[1], u[2], u[3]) !== 'MULT') return null;
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let off = 4;
  const ver = dv.getUint8(off); off += 1;
  if (ver !== 1) throw new Error('批量版本不支持');
  const cnt = dv.getUint32(off, true); off += 4;
  const files = [];
  for (let i = 0; i < cnt; i++) {
    const nameLen = dv.getUint16(off, false); off += 2;
    const name = new TextDecoder().decode(u.subarray(off, off + nameLen)); off += nameLen;
    const mimeLen = dv.getUint16(off, false); off += 2;
    const mime = new TextDecoder().decode(u.subarray(off, off + mimeLen)); off += mimeLen;
    const dataLen = dv.getUint32(off, true); off += 4;
    const data = u.slice(off, off + dataLen).buffer; off += dataLen;
    files.push({ name, mime, dataBuffer: data });
  }
  return files;
}

function parseSinglePayload(buf) {
  const u = uint8FromBuffer(buf);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const mimeLen = dv.getUint16(0, false);
  let off = 2;
  const mime = new TextDecoder().decode(u.subarray(off, off + mimeLen)); off += mimeLen;
  const expectedHash = u.slice(off, off + 32); off += 32;
  const compressedData = u.slice(off).buffer;
  return { mimeType: mime, expectedHash, compressedData };
}

function extFromMime(mime, fallback) {
  if (mime.startsWith('image/')) { const e = mime.split('/')[1].replace('jpeg', 'jpg'); return e ? '.' + e : '.img'; }
  if (mime.startsWith('video/')) { const e = mime.split('/')[1]; return e ? '.' + e : '.mp4'; }
  if (mime === 'text/html') return '.html';
  if (mime === 'text/plain') return /\.txt$/i.test(fallback) ? '.txt' : '.' + (fallback.match(/\.[^.]*$/)?.[0] || 'txt');
  const extMatch = fallback.match(/\.[^.]*$/);
  return extMatch ? extMatch[0] : '.bin';
}

function arrayEqual(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }

// ---- 文件网格渲染 ----
async function renderFileGrid(files, container) {
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'file-grid';

  for (const f of files) {
    const card = document.createElement('div');
    card.className = 'file-card';
    const blob = new Blob([f.dataBuffer], { type: f.mime });
    const url = URL.createObjectURL(blob);

    if (f.mime.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = url;
      img.onclick = () => openImageModal(url);
      card.appendChild(img);
    } else if (f.mime.startsWith('video/')) {
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
    dl.onclick = (e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = url; a.download = f.name; a.click(); };
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
    dlAll.innerText = '⬇️ 下载全部文件 (ZIP打包)';
    dlAll.className = 'btn-sm';
    dlAll.onclick = async () => {
      dlAll.disabled = true; dlAll.innerText = '打包中...';
      try {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        for (const f of files) zip.file(f.name, f.dataBuffer);
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(zipBlob);
        a.download = `decrypted_files_${Date.now()}.zip`;
        a.click();
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
  const key = usePassword ? null : await importKeyFromB64(inputStr);

  let finalPlain;
  if (usePassword) {
    const resolver = makeKeyResolver(true, inputStr);
    const r = await decryptEncodedBytes(encBuf, resolver, {});
    finalPlain = r.plain;
  } else {
    const r = await decryptEncodedBytes(encBuf, () => key, {});
    finalPlain = r.plain;
  }

  const { hash: expectedHash, compressed } = splitPayload(finalPlain);
  setProgress('decryptProgress', '📦 解压载荷...');
  let decomp = await decompress(compressed);
  if (decomp.byteLength < 4) decomp = compressed;

  const asBatch = parseBatchPayload(decomp);
  if (asBatch) {
    const computed = await sha256(decomp);
    if (!arrayEqual(computed, expectedHash)) throw new Error('批量哈希校验失败');
    hideProgress('decryptProgress');
    return { badge: '✅ 解密成功 (批量)', cls: 'success', msg: `✓ 完整性通过，共 ${asBatch.length} 个文件`, files: asBatch };
  }

  const single = parseSinglePayload(decomp);
  const original = await decompress(single.compressedData);
  const computedHash = await sha256(original);
  if (!arrayEqual(computedHash, single.expectedHash)) throw new Error('哈希校验失败');
  const fname = file.name.replace(/\.aes$/i, '').replace(/\.encrypted$/i, '') || 'decrypted';
  const base = fname.replace(/\.[^.]*$/, '');
  const properName = base + extFromMime(single.mimeType, fname);
  hideProgress('decryptProgress');
  return { badge: '✅ 解密成功', cls: 'success', msg: '✓ 哈希验证通过', files: [{ name: properName, mime: single.mimeType, dataBuffer: original }] };
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
    btn.disabled = true; buttonText(btn, '⏳ 解密中...');
    try {
      const r = await decryptOne({ file: decryptFile.files[0], usePassword, inputStr });
      badge.innerText = r.badge; badge.className = 'status-badge ' + r.cls;
      verifyMsg.innerHTML = `<span>${r.msg}</span>`;
      preview.style.display = 'block';
      await renderFileGrid(r.files, preview);
      buttonText(btn, '✅ 解密完成');
    } catch (err) {
      badge.innerText = '❌ 失败'; badge.className = 'status-badge error';
      verifyMsg.innerHTML = `<span>${err.message}</span>`;
      preview.innerHTML = '';
      buttonText(btn, '🔎 解密并校验完整性');
    } finally { btn.disabled = false; }
  };
}

function buttonText(btn, text) { if (btn) btn.textContent = text; }
