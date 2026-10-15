/* =======================================================
   AMV Converter - motor de conversão 100% client-side
   FFmpeg.wasm 0.12 (core single-thread: NÃO exige
   SharedArrayBuffer, funciona no GitHub Pages)
   ======================================================= */

const FFMPEG_VER = '0.12.10';
const CORE_VER = '0.12.6';
// Motor hospedado junto com o site (pasta ffmpeg/), sem depender de CDN
const BASE_FF = new URL('ffmpeg/', location.href).href.replace(/\/$/, '');
const BASE_CORE = BASE_FF;

const { FFmpeg } = FFmpegWASM;
const { fetchFile, toBlobURL } = FFmpegUtil;

const ffmpeg = new FFmpeg();

let selectedFile = null;
let isFFmpegReady = false;
let isLoading = false;
let isConverting = false;
let lastUrl = null;
let durationSec = 0;
let isDetecting = false;
let detectedCrop = null;

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
  else {
    const f = document.getElementById('format').value;
    convertBtn.innerText = f === 'xvid' ? 'Converter para .AVI (XviD)' : 'Converter para .' + f.toUpperCase();
  }
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
  loadTrimPreview(file);
  updateButton();
}

/* ---------- carregamento do FFmpeg ---------- */
ffmpeg.on('log', ({ message }) => {
  if (isDetecting) {
    const c = message.match(/crop=(\d+):(\d+):(\d+):(\d+)/);
    if (c) detectedCrop = c.slice(1).map(Number);
    return;
  }
  log(message);
  const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(message);
  if (m) durationSec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
  const t = /time=\s*(\d+):(\d+):(\d+\.\d+)/.exec(message);
  if (t && durationSec > 0 && isConverting) {
    const cur = (+t[1]) * 3600 + (+t[2]) * 60 + parseFloat(t[3]);
    const pct = 10 + Math.round((cur / effectiveDuration()) * 85);
    setProgress(pct);
    setStatus(`Convertendo vídeo... (${Math.min(99, pct)}%)`);
  }
});

ffmpeg.on('progress', ({ progress }) => {
  if (!isConverting || isDetecting || durationSec > 0) return;
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
    // O wasm fica comprimido (.gz, ~10 MB) para caber no limite de 25 MB do
    // GitHub. Aqui ele é baixado e descomprimido no navegador antes de carregar.
    const gzRes = await fetch(`${BASE_CORE}/ffmpeg-core.wasm.gz`);
    if (!gzRes.ok) throw new Error('Falha ao baixar ffmpeg-core.wasm.gz');
    const wasmBlob = await new Response(
      gzRes.body.pipeThrough(new DecompressionStream('gzip'))
    ).blob();
    const wasmURL = URL.createObjectURL(wasmBlob);
    await ffmpeg.load({
      coreURL: `${BASE_CORE}/ffmpeg-core.js`,
      wasmURL,
      classWorkerURL: `${BASE_FF}/814.ffmpeg.js`,
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

/* ---------- Perfil YP3: AMV 160x128, 15 fps, mono 22050 Hz ---------- */
const YP3 = { format: 'amv', resolution: '160x128', fps: '15', quality: '6' };
document.getElementById('profile').addEventListener('change', (e) => {
  if (e.target.value !== 'yp3') return;
  for (const [id, v] of Object.entries(YP3)) document.getElementById(id).value = v;
  updateButton();
});
['format', 'resolution', 'fps', 'quality'].forEach((id) =>
  document.getElementById(id).addEventListener('change', () => {
    const p = document.getElementById('profile');
    if (p.value === 'yp3' && document.getElementById(id).value !== YP3[id]) p.value = 'custom';
  }));

/* ---------- opção "Remover faixas pretas" (só com Esticar) ---------- */
const aspectSel = document.getElementById('aspect');
const cropBarsWrap = document.getElementById('cropBarsWrap');
const cropBarsChk = document.getElementById('cropBars');
function updateCropOption() {
  const show = aspectSel.value === 'stretch';
  cropBarsWrap.style.display = show ? 'block' : 'none';
  if (!show) cropBarsChk.checked = false;
}
aspectSel.addEventListener('change', updateCropOption);
updateCropOption();

// Analisa trechos do vídeo com cropdetect e retorna "crop=w:h:x:y" ou ''.
async function detectBlackBars(inputName) {
  detectedCrop = null;
  isDetecting = true;
  let best = null;
  try {
    const starts = durationSec > 30
      ? [durationSec * 0.2, durationSec * 0.5, durationSec * 0.8]
      : [0];
    for (const ss of starts) {
      detectedCrop = null;
      await ffmpeg.exec([
        '-ss', String(Math.floor(ss)), '-i', inputName, '-t', '6',
        '-vf', 'cropdetect=limit=24:round=2:reset=0', '-an', '-f', 'null', '-',
      ]);
      if (detectedCrop) {
        const [cw, ch, cx, cy] = detectedCrop;
        // fica com a maior área (evita cortar demais em cenas escuras)
        if (!best || cw * ch > best[0] * best[1]) best = [cw, ch, cx, cy];
      }
    }
  } catch (e) {
    console.warn('cropdetect falhou', e);
  } finally {
    isDetecting = false;
  }
  if (!best || best[0] < 16 || best[1] < 16) return '';
  log(`>> Faixas pretas detectadas: recortando para ${best[0]}x${best[1]} (x=${best[2]}, y=${best[3]})`);
  return `crop=${best[0]}:${best[1]}:${best[2]}:${best[3]},`;
}

window.addEventListener('DOMContentLoaded', () => {
  updateButton();
  setTimeout(initFFmpeg, 300);
});

/* ---------- Ajustar duração (corte de início/fim) ---------- */
const trimSection = document.getElementById('trimSection');
const trimVideo = document.getElementById('trimVideo');
const trimNoPreview = document.getElementById('trimNoPreview');
const tStartRange = document.getElementById('trimStartRange');
const tEndRange = document.getElementById('trimEndRange');
const tStartMin = document.getElementById('trimStartMin');
const tStartSec = document.getElementById('trimStartSec');
const tEndMin = document.getElementById('trimEndMin');
const tEndSec = document.getElementById('trimEndSec');
let trimTotal = 0;   // duração original (s)
let trimStart = 0;   // segundos cortados do início
let trimEnd = 0;     // segundos cortados do fim
let trimUrl = null;
let previewStopAt = null;

function fmtTime(t) {
  t = Math.max(0, Math.round(t));
  const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}
function effectiveDuration() {
  const total = trimTotal || durationSec;
  const d = total - trimStart - trimEnd;
  return d > 0 ? d : (durationSec || 1);
}
// Argumentos do FFmpeg para o corte (vão antes de -i)
function trimArgs() {
  const total = trimTotal || durationSec;
  if (!total || (trimStart <= 0 && trimEnd <= 0)) return [];
  const len = total - trimStart - trimEnd;
  if (len <= 0) return [];
  const a = [];
  if (trimStart > 0) a.push('-ss', trimStart.toFixed(2));
  a.push('-t', len.toFixed(2));
  return a;
}
function renderTrim() {
  const max = Math.floor(trimTotal);
  tStartRange.max = max; tEndRange.max = max;
  tStartRange.value = trimStart; tEndRange.value = trimEnd;
  tStartMin.value = Math.floor(trimStart / 60); tStartSec.value = Math.floor(trimStart % 60);
  tEndMin.value = Math.floor(trimEnd / 60); tEndSec.value = Math.floor(trimEnd % 60);
  document.getElementById('trimOrig').innerText = trimTotal ? fmtTime(trimTotal) : '--:--';
  document.getElementById('trimRange').innerText = trimTotal ? `${fmtTime(trimStart)} → ${fmtTime(trimTotal - trimEnd)}` : '--:--';
  document.getElementById('trimNew').innerText = trimTotal ? fmtTime(trimTotal - trimStart - trimEnd) : '--:--';
}
// Garante que sempre sobre pelo menos 1 segundo de vídeo
function setTrim(start, end, changed) {
  const max = Math.max(0, trimTotal - 1);
  start = Math.max(0, Math.min(Number(start) || 0, max));
  end = Math.max(0, Math.min(Number(end) || 0, max));
  if (start + end > max) {
    if (changed === 'start') start = max - end; else end = max - start;
  }
  trimStart = start; trimEnd = end;
  renderTrim();
}
tStartRange.addEventListener('input', () => { setTrim(tStartRange.value, trimEnd, 'start'); seekPreview(trimStart); });
tEndRange.addEventListener('input', () => { setTrim(trimStart, tEndRange.value, 'end'); seekPreview(trimTotal - trimEnd); });
[tStartMin, tStartSec].forEach((el) => el.addEventListener('change', () =>
  setTrim((+tStartMin.value || 0) * 60 + (+tStartSec.value || 0), trimEnd, 'start')));
[tEndMin, tEndSec].forEach((el) => el.addEventListener('change', () =>
  setTrim(trimStart, (+tEndMin.value || 0) * 60 + (+tEndSec.value || 0), 'end')));
document.getElementById('trimSetStart').addEventListener('click', () => setTrim(Math.floor(trimVideo.currentTime), trimEnd, 'start'));
document.getElementById('trimSetEnd').addEventListener('click', () => setTrim(trimStart, Math.floor(trimTotal - trimVideo.currentTime), 'end'));
document.getElementById('trimResetBtn').addEventListener('click', () => setTrim(0, 0));
document.getElementById('trimPreviewBtn').addEventListener('click', () => {
  if (!trimVideo.duration) return;
  previewStopAt = trimTotal - trimEnd;
  trimVideo.currentTime = trimStart;
  trimVideo.play();
});
trimVideo.addEventListener('timeupdate', () => {
  if (previewStopAt != null && trimVideo.currentTime >= previewStopAt) {
    trimVideo.pause();
    previewStopAt = null;
  }
});
trimVideo.addEventListener('pause', () => { if (trimVideo.currentTime < (previewStopAt || 0)) previewStopAt = null; });
function seekPreview(t) {
  if (trimVideo.duration) { previewStopAt = null; trimVideo.pause(); trimVideo.currentTime = Math.min(t, trimVideo.duration); }
}

async function loadTrimPreview(file) {
  if (trimUrl) URL.revokeObjectURL(trimUrl);
  trimUrl = URL.createObjectURL(file);
  trimTotal = 0; trimStart = 0; trimEnd = 0;
  trimSection.style.display = 'block';
  trimNoPreview.style.display = 'none';
  trimVideo.style.display = '';
  renderTrim();
  trimVideo.onloadedmetadata = () => {
    if (isFinite(trimVideo.duration) && trimVideo.duration > 0) {
      trimTotal = trimVideo.duration;
      renderTrim();
    }
  };
  trimVideo.onerror = async () => {
    // Navegador não reproduz o formato: obtém a duração pelo FFmpeg
    trimVideo.style.display = 'none';
    trimNoPreview.style.display = 'block';
    document.getElementById('trimSetStart').style.display = 'none';
    document.getElementById('trimSetEnd').style.display = 'none';
    if (!isFFmpegReady && !(await initFFmpeg())) return;
    try {
      const name = 'probe_' + Date.now();
      await ffmpeg.writeFile(name, await fetchFile(file));
      durationSec = 0;
      try { await ffmpeg.exec(['-i', name]); } catch (e) {}
      await ffmpeg.deleteFile(name).catch(() => {});
      if (durationSec > 0) { trimTotal = durationSec; renderTrim(); }
    } catch (e) { console.warn(e); }
  };
  document.getElementById('trimSetStart').style.display = '';
  document.getElementById('trimSetEnd').style.display = '';
  trimVideo.src = trimUrl;
}

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
  const outputName = 'output.' + (format === 'amv' ? 'amv' : 'avi');

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(selectedFile));

    const resolution = document.getElementById('resolution').value; // ex: 160x128
    const [w, h] = resolution.split('x').map(Number);
    const aspectMode = document.getElementById('aspect').value;
    const stretch = aspectMode === 'stretch';
    const rot = { cw: 'transpose=1,', ccw: 'transpose=2,', '180': 'hflip,vflip,' }[document.getElementById('rotate').value] || '';
    const fps = document.getElementById('fps').value;
    const quality = document.getElementById('quality').value;

    let crop = '';
    if (stretch && cropBarsChk.checked) {
      if (durationSec <= 0) {
        // obtém a duração (o log de "Duration" é lido pelo listener)
        try { await ffmpeg.exec(['-i', inputName]); } catch (e) {}
      }
      setStatus('Detectando faixas pretas...');
      crop = await detectBlackBars(inputName);
      if (!crop) log('>> Nenhuma faixa preta detectada.');
    }

    // O codec AMV exige dimensões exatas; com "manter proporção" usamos padding.
    // Dimensões pares (exigência de MJPEG/MPEG-4) e rotação antes da escala.
    const pad = `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
    let geo;
    if (stretch) geo = `${crop}${rot}scale=${w}:${h}`;
    else if (aspectMode === 'fill') geo = `${rot}scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
    else if (aspectMode === 'vertical') {
      // Recorta o centro em 9:16 e encaixa na tela (ideal para telas em pé 128x160 / 120x160)
      geo = `${rot}crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=${w}:${h}:force_original_aspect_ratio=decrease,${pad}`;
    } else geo = `${rot}scale=${w}:${h}:force_original_aspect_ratio=decrease,${pad}`;
    const pixFmt = format === 'xvid' ? 'yuv420p' : 'yuvj420p';
    const vf = `${geo},setsar=1,fps=${fps},format=${pixFmt}`;

    setStatus('Convertendo vídeo...');
    setProgress(10);

    // AMV exige: áudio ADPCM mono a 22050 Hz e taxa de quadros que divida
    // 22050 exatamente (10, 14, 15, 18, 21, 25, 30) -> block_size = 22050/fps.
    const blockSize = Math.round(22050 / Number(fps));

    let code;
    if (format === 'xvid') {
      // AVI XviD: MPEG-4 Part 2 sem B-frames, GOP curto, FourCC XVID, áudio MP3 mono.
      const vBase = [
        ...trimArgs(), '-i', inputName, '-vf', vf,
        '-c:v', 'mpeg4', '-vtag', 'XVID', '-q:v', String(Math.max(2, Math.round(Number(quality) * 0.8))),
        '-bf', '0', '-g', String(Number(fps) * 2), '-pix_fmt', 'yuv420p',
        '-max_muxing_queue_size', '1024',
      ];
      code = await ffmpeg.exec(vBase.concat(['-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '22050', '-ac', '1', '-f', 'avi', '-y', outputName]));
      if (code !== 0) {
        log('>> MP3 indisponível, usando áudio IMA ADPCM (fallback)...');
        code = await ffmpeg.exec(vBase.concat(['-c:a', 'adpcm_ima_wav', '-ar', '22050', '-ac', '1', '-f', 'avi', '-y', outputName]));
      }
      if (code !== 0) code = await ffmpeg.exec(vBase.concat(['-an', '-f', 'avi', '-y', outputName]));
    } else if (format === 'avi') {
      // AVI compatível com MP4 players: mesmas características do AMV
      // (mesma resolução/fps, vídeo MJPEG, áudio mono 22050 Hz).
      const vBase = [
        ...trimArgs(), '-i', inputName,
        '-vf', vf,
        '-c:v', 'mjpeg',
        '-q:v', quality,
        '-pix_fmt', 'yuvj420p',
        '-vtag', 'MJPG',
        '-max_muxing_queue_size', '1024',
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
        ...trimArgs(), '-i', inputName,
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
          ...trimArgs(), '-i', inputName,
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

    const ext = format === 'amv' ? 'amv' : 'avi';
    const blob = new Blob([data.buffer], { type: ext === 'avi' ? 'video/x-msvideo' : 'video/x-amv' });
    lastUrl = URL.createObjectURL(blob);
    downloadLink.href = lastUrl;
    const baseName = dot > -1 ? selectedFile.name.slice(0, dot) : selectedFile.name;
    downloadLink.download = `${baseName}_player.${ext}`;
    downloadLink.innerText = `Baixar Arquivo .${ext.toUpperCase()}`;
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

// Guarda o motor no navegador para não baixar de novo nas próximas visitas
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
