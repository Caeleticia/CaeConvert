import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();
const logEl = document.getElementById('log');
const fileInput = document.getElementById('fileInput');
const convertBtn = document.getElementById('convertBtn');
const progressBar = document.getElementById('progressBar');
const videoOptions = document.getElementById('videoOptions');
const audioOptions = document.getElementById('audioOptions');

let inputFile = null;
let ffmpegReady = false;

// —— 日志与进度 ——
ffmpeg.on('log', ({ message }) => {
  logEl.textContent += message + '\n';
  logEl.scrollTop = logEl.scrollHeight;
});
ffmpeg.on('progress', ({ progress }) => {
  progressBar.value = Math.round(progress * 100);
});

// —— 初始化：加载单线程核心 ——
async function initFFmpeg() {
  try {
    await ffmpeg.load({
      coreURL: '/ffmpeg-core/ffmpeg-core.js',
      wasmURL: '/ffmpeg-core/ffmpeg-core.wasm',
    });
    ffmpegReady = true;
    convertBtn.disabled = false;
    convertBtn.textContent = '开始转换';
    logEl.textContent = 'FFmpeg 已加载，可以离线使用。\n';
  } catch (err) {
    logEl.textContent = '加载失败：' + err.message;
  }
}

// —— 文件选择 ——
fileInput.addEventListener('change', () => {
  inputFile = fileInput.files[0];
  if (!inputFile) return;
  document.getElementById('fileInfo').textContent =
    `${inputFile.name}（${(inputFile.size / 1024 / 1024).toFixed(1)} MB）`;

  const isVideo = inputFile.type.startsWith('video/');
  const isAudio = inputFile.type.startsWith('audio/');
  videoOptions.style.display = isVideo ? 'block' : 'none';
  audioOptions.style.display = (isVideo || isAudio) ? 'block' : 'none';
});

// —— 根据输出格式切换输入框可见性 ——
document.getElementById('outputFormat').addEventListener('change', (e) => {
  const fmt = e.target.value;
  const isVideoOut = ['mp4', 'avi', 'mov'].includes(fmt);
  const isAudioOut = ['mp3', 'ogg', 'wav'].includes(fmt);
  videoOptions.style.display = isVideoOut ? 'block' : 'none';
  audioOptions.style.display = (isVideoOut || isAudioOut) ? 'block' : 'none';
});

// —— 核心：构造 ffmpeg 命令 ——
function buildArgs(inputName, outputName, targetFormat) {
  const args = ['-i', inputName];
  const isImageOut = ['jpg', 'png', 'webp'].includes(targetFormat);
  const isAudioOut = ['mp3', 'ogg', 'wav'].includes(targetFormat);
  const isVideoOut = ['mp4', 'avi', 'mov'].includes(targetFormat);

  // 1) 分辨率 & 视频滤镜（仅视频输出）
  if (isVideoOut) {
    const filters = [];
    const scale = document.getElementById('scale').value.trim();
    if (scale) filters.push(`scale=${scale}`);

    const fps = document.getElementById('fps').value.trim();
    if (fps) filters.push(`fps=${fps}`);

    if (filters.length) args.push('-vf', filters.join(','));

    const vb = document.getElementById('videoBitrate').value.trim();
    if (vb) args.push('-b:v', vb);
    else args.push('-crf', '23'); // 未指定码率时用 CRF 质量模式

    // 音频流处理
    const audioMode = document.getElementById('audioMode').value;
    if (audioMode === 'remove') {
      args.push('-an');
    } else if (audioMode === 'mute') {
      args.push('-af', 'volume=0');
    } else {
      const ab = document.getElementById('audioBitrate').value.trim();
      if (ab) args.push('-b:a', ab);
    }

    // 视频编码器：兼容性优先
    if (targetFormat === 'mp4' || targetFormat === 'mov') args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
    if (targetFormat === 'avi') args.push('-c:v', 'mpeg4', '-q:v', '4');
    if (targetFormat === 'mp4') args.push('-movflags', '+faststart');
  }

  // 2) 图片输出：缩放与质量
  if (isImageOut) {
    const scale = document.getElementById('scale').value.trim();
    if (scale) args.push('-vf', `scale=${scale}`);
    if (targetFormat === 'jpg') args.push('-q:v', '2');
    if (targetFormat === 'webp') args.push('-quality', '80');
  }

  // 3) 音频输出：码率与编码器
  if (isAudioOut) {
    const ab = document.getElementById('audioBitrate').value.trim();
    if (ab) args.push('-b:a', ab);
    if (targetFormat === 'mp3') args.push('-c:a', 'libmp3lame');
    if (targetFormat === 'ogg') args.push('-c:a', 'libvorbis');
    if (targetFormat === 'wav') args.push('-c:a', 'pcm_s16le');
  }

  args.push(outputName);
  return args;
}

// —— 开始转换 ——
convertBtn.addEventListener('click', async () => {
  if (!inputFile || !ffmpegReady) return;
  convertBtn.disabled = true;
  progressBar.style.display = 'block';
  progressBar.value = 0;

  const targetFormat = document.getElementById('outputFormat').value;
  const inputExt = inputFile.name.split('.').pop();
  const inputName = `input.${inputExt}`;
  const outputName = `output.${targetFormat}`;

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(inputFile));
    const args = buildArgs(inputName, outputName, targetFormat);
    logEl.textContent += `\n$ ffmpeg ${args.join(' ')}\n`;

    await ffmpeg.exec(args);

    const data = await ffmpeg.readFile(outputName);
    const mime = {
      jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
      mp4: 'video/mp4', avi: 'video/x-msvideo', mov: 'video/quicktime',
    }[targetFormat] || 'application/octet-stream';

    const blob = new Blob([data.buffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `converted.${targetFormat}`;
    a.click();
    URL.revokeObjectURL(url);

    logEl.textContent += '\n✅ 转换完成，已触发下载。\n';
  } catch (err) {
    logEl.textContent += '\n❌ 失败：' + err.message + '\n';
  } finally {
    convertBtn.disabled = false;
    progressBar.style.display = 'none';
    try { await ffmpeg.deleteFile(inputName); } catch (_) {}
    try { await ffmpeg.deleteFile(outputName); } catch (_) {}
  }
});

// —— 注册 Service Worker 与启动 ——
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
initFFmpeg();
