// ============================================================================
// editor.js —— 文本/HTML 编辑器（新建 + 就地编辑保存）
// ============================================================================
import { $, toast, hideModal, showModal } from './ui.js';
import { addFileToLeft } from './library.js';

let currentEditingItem = null;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, function (m) {
    if (m === '&') return '&amp;'; if (m === '<') return '&lt;'; if (m === '>') return '&gt;'; return m;
  });
}

function isHtmlMode() { return $('modalHtmlPane').style.display !== 'none'; }

function setTab(html) {
  $('modalHtmlPane').style.display = html ? 'block' : 'none';
  $('modalTxtPane').style.display = html ? 'none' : 'block';
  $('modalEditHtmlTab').classList.toggle('active', html);
  $('modalEditTxtTab').classList.toggle('active', !html);
}

export function initEditor({ onSave }) {
  $('modalEditHtmlTab').onclick = () => setTab(true);
  $('modalEditTxtTab').onclick = () => setTab(false);
  $('closeEditorModalBtn').onclick = () => hideModal('editorModal');
  $('cancelEditBtn').onclick = () => hideModal('editorModal');
  $('openEditorBtn').onclick = () => {
    currentEditingItem = null;
    $('inlineEditActions').style.display = 'none';
    $('modalHtmlContent').value = '<h1>新文档</h1>';
    $('modalTxtContent').value = '';
    setTab(true);
    showModal('editorModal');
  };
  $('modalPreviewHtmlBtn').onclick = () => {
    $('modalEditorPreview').style.display = 'block';
    $('modalEditorPreview').innerHTML = $('modalHtmlContent').value;
  };
  $('modalPreviewTxtBtn').onclick = () => {
    $('modalEditorPreview').style.display = 'block';
    $('modalEditorPreview').innerHTML = `<pre>${escapeHtml($('modalTxtContent').value)}</pre>`;
  };
  $('modalAddHtmlToLibBtn').onclick = () => {
    const file = new File([$('modalHtmlContent').value], `editor_${Date.now()}.html`, { type: 'text/html' });
    addFileToLeft(file);
    toast('已加入文件库');
  };
  $('modalAddTxtToLibBtn').onclick = () => {
    const file = new File([$('modalTxtContent').value], `text_${Date.now()}.txt`, { type: 'text/plain' });
    addFileToLeft(file);
    toast('已加入文件库');
  };
  $('saveEditToFileBtn').onclick = async () => {
    if (!currentEditingItem) return;
    const isHtml = isHtmlMode();
    const newContent = isHtml ? $('modalHtmlContent').value : $('modalTxtContent').value;
    const newMime = isHtml ? 'text/html' : 'text/plain';
    let newName = currentEditingItem.name;
    if (!isHtml) newName = newName.replace(/\.html?$/i, '') + '.txt';
    const blob = new Blob([newContent], { type: newMime });
    const newBuf = await blob.arrayBuffer();
    currentEditingItem.arrayBuffer = newBuf;
    currentEditingItem.dataUrl = URL.createObjectURL(blob);
    currentEditingItem.mime = newMime;
    currentEditingItem.name = newName;
    currentEditingItem.hashHex = '';
    if (onSave) onSave(currentEditingItem);
    hideModal('editorModal');
    toast('已保存到原文件');
  };
}

export function openEditorForItem(item) {
  currentEditingItem = item;
  const isHtml = item.mime === 'text/html' || item.name.endsWith('.html');
  const content = new TextDecoder().decode(item.arrayBuffer);
  if (isHtml) $('modalHtmlContent').value = content;
  else $('modalTxtContent').value = content;
  setTab(isHtml);
  $('inlineEditActions').style.display = 'flex';
  showModal('editorModal');
}
