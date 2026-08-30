// ============================================================================
// camera.js —— 拍照 + 录像（添加到文件库）
// ============================================================================
import { $, toast } from './ui.js';
import { addFileToLeft } from './library.js';

let currentStream = null;
let mediaRecorder = null;
let recordedChunks = [];

function stopStream() {
  if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
  if (mediaRecorder) { if (mediaRecorder.state !== 'inactive') mediaRecorder.stop(); mediaRecorder = null; }
  recordedChunks = [];
}

export function initCamera() {
  $('transferCameraBtn').onclick = () => {
    stopStream();
    const container = $('transferCameraContainer');
    container.style.display = 'block';
    container.innerHTML = `
        <div>
            <video id="camPreviewVideo" autoplay playsinline class="camera-video"></video>
            <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                <button id="takePhotoBtn" class="btn-sm">📷 拍照添加</button>
                <button id="startRecordBtn" class="btn-sm">🔴 开始录像</button>
                <button id="stopRecordBtn" class="btn-sm" disabled>⏹️ 停止录像</button>
                <button id="closeCamBtn" class="btn-sm">❌ 关闭</button>
            </div>
            <div id="recordStatus" class="small-note"></div>
        </div>
    `;
    const videoElem = $('camPreviewVideo');
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => { currentStream = stream; videoElem.srcObject = stream; videoElem.play(); })
      .catch(err => { toast('摄像头/麦克风失败: ' + err.message, 'error'); container.style.display = 'none'; });

    $('takePhotoBtn').onclick = () => {
      const canvas = document.createElement('canvas');
      canvas.width = videoElem.videoWidth; canvas.height = videoElem.videoHeight;
      canvas.getContext('2d').drawImage(videoElem, 0, 0);
      canvas.toBlob(blob => { if (blob) addFileToLeft(new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' })).then(() => toast('已添加照片')); }, 'image/jpeg', 0.9);
    };
    const startBtn = $('startRecordBtn'), stopBtn = $('stopRecordBtn'), status = $('recordStatus');
    startBtn.onclick = () => {
      if (!currentStream) return;
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(currentStream, { mimeType: 'video/webm' });
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        addFileToLeft(new File([blob], `video_${Date.now()}.webm`, { type: 'video/webm' })).then(() => toast('录像已添加'));
        status.innerText = '录像已添加';
        startBtn.disabled = false; stopBtn.disabled = true;
      };
      mediaRecorder.start();
      startBtn.disabled = true; stopBtn.disabled = false;
      status.innerText = '⏺ 录像中...';
    };
    stopBtn.onclick = () => { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); status.innerText = '停止，处理中...'; };
    $('closeCamBtn').onclick = () => { stopStream(); container.style.display = 'none'; };
  };
}
