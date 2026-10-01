/* =======================================================
   AMV Converter - motor de conversão 100% client-side
   FFmpeg.wasm 0.12 (core single-thread: NÃO exige
   SharedArrayBuffer, funciona no GitHub Pages)
   ======================================================= */

const FFMPEG_VER = '0.12.10';
const CORE_VER = '0.12.6';
const BASE_FF = `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VER}/dist/umd`;
const BASE_CORE = `https://unpkg.com/@ffmpeg/core@${CORE_VER}/dist/esm`;

const { FFmpeg } = FFmpegWASM;
const { fetchFile, toBlobURL } = FFmpegUtil;

const ffmpeg = new FFmpeg();

let selectedFile = null;
let isFFmpegReady = false;
let isLoading = false;
let isConverting = false;
let lastUrl = null;
let durationSec = 0;

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileNameSpan = document.getElementById('fileName');
const convertBtn = document.getElementById('convertBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('statusText');
const resultContainer = document.getElementById('resultContainer');
const downloadLink = document.getElementById('downloadLink');
const logBox = document.getElementById('logBox');

/* ---------- helpers ---------- */
function setStatus(msg) {
  progressContainer.style.display = 'block';
  statusText.innerText = msg;
}
function setProgress(p) {
  progressBar.style.width = Math.max(0, Math.min(100, p)) + '%';
}
function log(line) {
  if (!logBox) return;
  logBox.style.display = 'block';
  logBox.textContent += line + '\n';
  logBox.scrollTop = logBox.scrollHeight;
}
function updateButton() {
  convertBtn.disabled = !(selectedFile && isFFmpegReady && !isConverting);
  if (isConverting) convertBtn.innerText = 'Convertendo...';
  else if (!isFFmpegReady) convertBtn.innerText = 'Carregando motor...';
  else convertBtn.innerText = 'Converter para .' + document.getElementById('format').value.toUpperCase();
}

/* ---------- seleção de arquivo ---------- */
dropZone.addEventListener('click', () => fileInput.click());
['dragover', 'dragenter'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragging');
  })
);
['dragleave', 'dragend'].forEach((ev) =>
  dropZone.addEventListener(ev, () => dropZone.classList.remove('dragging'))
);
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragging');
  if (e.dataTransfer.files && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file) {
  if (!file) return;
  if (file.size > 400 * 1024 * 1024) {
    alert('Arquivo muito grande para o navegador (limite prático: 400 MB). Corte o vídeo antes.');
    return;
  }
  selectedFile = file;
  fileNameSpan.innerText = `${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`;
  fileInfo.style.display = 'block';
  resultContainer.style.display = 'none';
  durationSec = 0;
  updateButton();
}

/* ---------- carregamento do FFmpeg ---------- */
ffmpeg.on('log', ({ message }) => {
  log(message);
  const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(message);
  if (m) durationSec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
  const t = /time=\s*(\d+):(\d+):(\d+\.\d+)/.exec(message);
  if (t && durationSec > 0 && isConverting) {
    const cur = (+t[1]) * 3600 + (+t[2]) * 60 + parseFloat(t[3]);
    const pct = 10 + Math.round((cur / durationSec) * 85);
    setProgress(pct);
    setStatus(`Convertendo vídeo... (${Math.min(99, pct)}%)`);
  }
});

ffmpeg.on('progress', ({ progress }) => {
  if (!isConverting || durationSec > 0) return;
  const pct = 10 + Math.round(progress * 85);
  setProgress(pct);
  setStatus(`Convertendo vídeo... (${Math.min(99, pct)}%)`);
});

async function initFFmpeg() {
  if (isFFmpegReady || isLoading) return isFFmpegReady;
  isLoading = true;
  updateButton();
  try {
    setStatus('Carregando motor de conversão (alguns segundos na primeira vez)...');
    setProgress(5);
    await ffmpeg.load({
      coreURL: `${BASE_CORE}/ffmpeg-core.js`,
      wasmURL: `${BASE_CORE}/ffmpeg-core.wasm`,
      classWorkerURL: await toBlobURL(`${BASE_FF}/814.ffmpeg.js`, 'text/javascript'),
    });
    isFFmpegReady = true;
    setStatus('Motor pronto. Selecione um vídeo e clique em Converter.');
    setProgress(0);
  } catch (err) {
    console.error(err);
    setStatus('Não foi possível carregar o motor de conversão. Verifique sua conexão e recarregue a página.');
  } finally {
    isLoading = false;
    updateButton();
  }
  return isFFmpegReady;
}

document.getElementById('format').addEventListener('change', updateButton);

window.addEventListener('DOMContentLoaded', () => {
  updateButton();
  setTimeout(initFFmpeg, 300);
});

/* ---------- conversão ---------- */
convertBtn.addEventListener('click', async () => {
  if (!selectedFile || isConverting) return;
  if (!isFFmpegReady && !(await initFFmpeg())) return;

  isConverting = true;
  updateButton();
  resultContainer.style.display = 'none';
  if (lastUrl) {
    URL.revokeObjectURL(lastUrl);
    lastUrl = null;
  }
  setProgress(5);
  setStatus('Lendo arquivo...');

  const dot = selectedFile.name.lastIndexOf('.');
  const ext = dot > -1 ? selectedFile.name.slice(dot) : '.mp4';
  const inputName = 'input' + ext.toLowerCase();
  const format = document.getElementById('format').value; // amv | avi
  const outputName = 'output.' + format;

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(selectedFile));

    const resolution = document.getElementById('resolution').value; // ex: 160x128
    const [w, h] = resolution.split('x').map(Number);
    const stretch = document.getElementById('aspect').value === 'stretch';
    const fps = document.getElementById('fps').value;
    const quality = document.getElementById('quality').value;

    // O codec AMV exige dimensões exatas; com "manter proporção" usamos padding.
    const vf = stretch
      ? `scale=${w}:${h},fps=${fps},format=yuvj420p`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},format=yuvj420p`;

    setStatus('Convertendo vídeo...');
    setProgress(10);

    // AMV exige: áudio ADPCM mono a 22050 Hz e taxa de quadros que divida
    // 22050 exatamente (10, 14, 15, 18, 21, 25, 30) -> block_size = 22050/fps.
    const blockSize = Math.round(22050 / Number(fps));

    let code;
    if (format === 'avi') {
      // AVI compatível com MP4 players: mesmas características do AMV
      // (mesma resolução/fps, vídeo MJPEG, áudio mono 22050 Hz).
      const vBase = [
        '-i', inputName,
        '-vf', vf,
        '-c:v', 'mjpeg',
        '-q:v', quality,
        '-pix_fmt', 'yuvj420p',
        '-vtag', 'MJPG',
      ];
      code = await ffmpeg.exec(vBase.concat([
        '-c:a', 'adpcm_ima_wav', '-ar', '22050', '-ac', '1',
        '-f', 'avi', '-y', outputName,
      ]));
      if (code !== 0) {
        log('>> Tentando novamente com áudio PCM (fallback)...');
        setStatus('Ajustando parâmetros e tentando novamente...');
        code = await ffmpeg.exec(vBase.concat([
          '-c:a', 'pcm_s16le', '-ar', '22050', '-ac', '1',
          '-f', 'avi', '-y', outputName,
        ]));
      }
      if (code !== 0) {
        log('>> Tentando novamente sem áudio (fallback)...');
        code = await ffmpeg.exec(vBase.concat(['-an', '-f', 'avi', '-y', outputName]));
      }
    } else {
      const args = [
        '-i', inputName,
        '-vf', vf,
        '-c:v', 'amv',
        '-q:v', quality,
        '-pix_fmt', 'yuvj420p',
        '-c:a', 'adpcm_ima_amv',
        '-ar', '22050',
        '-ac', '1',
        '-block_size', String(blockSize),
        '-f', 'amv',
        '-y', outputName,
      ];

      code = await ffmpeg.exec(args);

      if (code !== 0) {
        // Fallback: alguns arquivos falham no mux AMV com áudio; tenta sem áudio.
        log('>> Tentando novamente sem áudio (fallback)...');
        setStatus('Ajustando parâmetros e tentando novamente...');
        code = await ffmpeg.exec([
          '-i', inputName,
          '-vf', vf,
          '-c:v', 'amv',
          '-q:v', '6',
          '-pix_fmt', 'yuvj420p',
          '-an',
          '-f', 'amv',
          '-y', outputName,
        ]);
      }
    }

    if (code !== 0) throw new Error('FFmpeg retornou código ' + code);

    const data = await ffmpeg.readFile(outputName);
    if (!data || data.length === 0) throw new Error('Arquivo de saída vazio');

    const blob = new Blob([data.buffer], { type: format === 'avi' ? 'video/x-msvideo' : 'video/x-amv' });
    lastUrl = URL.createObjectURL(blob);
    downloadLink.href = lastUrl;
    const baseName = dot > -1 ? selectedFile.name.slice(0, dot) : selectedFile.name;
    downloadLink.download = `${baseName}_player.${format}`;
    downloadLink.innerText = `Baixar Arquivo .${format.toUpperCase()}`;
    document.getElementById('resultSize').innerText =
      `Tamanho final: ${(blob.size / (1024 * 1024)).toFixed(2)} MB`;

    addSessionFile(downloadLink.download, blob);

    setProgress(100);
    setStatus('Conversão concluída!');
    progressContainer.style.display = 'none';
    resultContainer.style.display = 'block';
  } catch (error) {
    console.error(error);
    setStatus('Erro na conversão: ' + (error && error.message ? error.message : 'falha desconhecida') +
      '. Tente outro arquivo, uma resolução menor ou um vídeo mais curto.');
  } finally {
    // limpa a memória virtual para permitir novas conversões
    try { await ffmpeg.deleteFile(inputName); } catch (e) {}
    try { await ffmpeg.deleteFile(outputName); } catch (e) {}
    isConverting = false;
    updateButton();
  }
});

/* =======================================================
   PLAYER - reproduz .AMV convertidos (memória RAM) ou
   qualquer vídeo do computador do usuário.
   ======================================================= */

const navConverter = document.getElementById('navConverter');
const navPlayer = document.getElementById('navPlayer');
const viewConverter = document.getElementById('view-converter');
const viewPlayer = document.getElementById('view-player');
const sessionList = document.getElementById('sessionList');
const playerDropZone = document.getElementById('player-drop-zone');
const playerFileInput = document.getElementById('playerFileInput');
const videoPlayer = document.getElementById('videoPlayer');
const nowPlaying = document.getElementById('nowPlaying');
const playerStatus = document.getElementById('playerStatus');
const playerProgressContainer = document.getElementById('playerProgressContainer');
const playerProgressBar = document.getElementById('playerProgressBar');
const playResultBtn = document.getElementById('playResultBtn');

// Arquivos convertidos nesta sessão (ficam apenas na memória do navegador)
const sessionFiles = [];
let playbackUrl = null;
let isDecoding = false;

function showView(which) {
  const isPlayer = which === 'player';
  viewPlayer.style.display = isPlayer ? 'block' : 'none';
  viewConverter.style.display = isPlayer ? 'none' : 'block';
  navPlayer.classList.toggle('active', isPlayer);
  navConverter.classList.toggle('active', !isPlayer);
  if (!isPlayer) videoPlayer.pause();
  window.scrollTo(0, 0);
}

navConverter.addEventListener('click', (e) => { e.preventDefault(); showView('converter'); });
navPlayer.addEventListener('click', (e) => { e.preventDefault(); showView('player'); });

function setPlayerStatus(msg) {
  if (!msg) { playerStatus.style.display = 'none'; return; }
  playerStatus.style.display = 'block';
  playerStatus.innerText = msg;
}
function setPlayerProgress(p) {
  playerProgressContainer.style.display = p === null ? 'none' : 'block';
  if (p !== null) playerProgressBar.style.width = Math.max(0, Math.min(100, p)) + '%';
}

/* ---------- lista de convertidos (RAM) ---------- */
function addSessionFile(name, blob) {
  sessionFiles.push({ name: name, blob: blob, size: blob.size });
  renderSessionList();
}

function renderSessionList() {
  sessionList.innerHTML = '';
  if (!sessionFiles.length) {
    const li = document.createElement('li');
    li.className = 'session-empty';
    li.innerText = 'Nenhum vídeo convertido ainda nesta sessão.';
    sessionList.appendChild(li);
    return;
  }
  sessionFiles.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'session-item';

    const label = document.createElement('span');
    label.className = 'session-name';
    label.innerText = `${item.name} — ${(item.size / (1024 * 1024)).toFixed(2)} MB`;

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'btn-secondary';
    play.innerText = '▶ Reproduzir';
    play.addEventListener('click', () => playBlob(item.blob, item.name));

    const dl = document.createElement('a');
    dl.className = 'btn-secondary';
    dl.innerText = '⬇ Baixar';
    dl.href = URL.createObjectURL(item.blob);
    dl.download = item.name;

    li.appendChild(label);
    li.appendChild(play);
    li.appendChild(dl);
    sessionList.appendChild(li);
  });
}

if (playResultBtn) {
  playResultBtn.addEventListener('click', () => {
    const last = sessionFiles[sessionFiles.length - 1];
    showView('player');
    if (last) playBlob(last.blob, last.name);
  });
}

/* ---------- abrir arquivo do computador ---------- */
playerDropZone.addEventListener('click', () => playerFileInput.click());
['dragover', 'dragenter'].forEach((ev) =>
  playerDropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    playerDropZone.classList.add('dragging');
  })
);
['dragleave', 'dragend'].forEach((ev) =>
  playerDropZone.addEventListener(ev, () => playerDropZone.classList.remove('dragging'))
);
playerDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  playerDropZone.classList.remove('dragging');
  if (e.dataTransfer.files && e.dataTransfer.files.length) playBlob(e.dataTransfer.files[0], e.dataTransfer.files[0].name);
});
playerFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length) playBlob(e.target.files[0], e.target.files[0].name);
});

/* ---------- reprodução ---------- */
function setSource(url, label) {
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl = url;
  videoPlayer.src = url;
  videoPlayer.style.display = 'block';
  nowPlaying.innerText = label ? 'Reproduzindo: ' + label : '';
  videoPlayer.play().catch(() => {});
}

function tryNativePlayback(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const probe = document.createElement('video');
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!ok) URL.revokeObjectURL(url);
      resolve(ok ? url : null);
    };
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => finish(true);
    probe.onerror = () => finish(false);
    probe.src = url;
    const timer = setTimeout(() => finish(false), 6000);
  });
}

async function playBlob(blob, name) {
  if (isDecoding) return;
  const lower = (name || '').toLowerCase();
  const isAmv = lower.endsWith('.amv');

  setPlayerStatus('');
  setPlayerProgress(null);

  if (!isAmv) {
    setPlayerStatus('Abrindo vídeo...');
    const url = await tryNativePlayback(blob);
    if (url) {
      setPlayerStatus('');
      setSource(url, name);
      return;
    }
  }

  // .AMV (ou formato não suportado pelo navegador): decodifica localmente para MP4
  isDecoding = true;
  try {
    setPlayerStatus('Preparando o vídeo para exibição (decodificando no seu computador)...');
    setPlayerProgress(5);
    if (!isFFmpegReady && !(await initFFmpeg())) {
      setPlayerStatus('Não foi possível carregar o motor de vídeo. Verifique sua conexão e recarregue a página.');
      setPlayerProgress(null);
      return;
    }

    const dot = lower.lastIndexOf('.');
    const ext = dot > -1 ? lower.slice(dot) : '.amv';
    const inName = 'play_input' + ext;
    const outName = 'play_output.mp4';

    await ffmpeg.writeFile(inName, await fetchFile(blob));
    setPlayerProgress(25);

    const baseArgs = [
      '-i', inName,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
    ];

    let code = await ffmpeg.exec(baseArgs.concat(['-c:a', 'aac', '-ac', '1', '-ar', '44100', '-y', outName]));
    if (code !== 0) {
      code = await ffmpeg.exec(baseArgs.concat(['-an', '-y', outName]));
    }
    if (code !== 0) throw new Error('não foi possível decodificar este arquivo');

    const data = await ffmpeg.readFile(outName);
    if (!data || data.length === 0) throw new Error('saída vazia');

    setPlayerProgress(100);
    const mp4 = new Blob([data.buffer], { type: 'video/mp4' });
    setPlayerStatus('');
    setPlayerProgress(null);
    setSource(URL.createObjectURL(mp4), name);

    try { await ffmpeg.deleteFile(inName); } catch (e) {}
    try { await ffmpeg.deleteFile(outName); } catch (e) {}
  } catch (err) {
    console.error(err);
    setPlayerProgress(null);
    setPlayerStatus('Não foi possível reproduzir este arquivo: ' + (err && err.message ? err.message : 'erro desconhecido'));
  } finally {
    isDecoding = false;
  }
}

renderSessionList();
