/* ===== state ===== */
const state = {
  file: null,
  duration: 0,
  startTime: 0,
  endTime: 0,
  previewMode: false,
  segments: [], // [{ id, start, end }]
};

/* ===== dom refs ===== */
const $ = id => document.getElementById(id);
const els = {
  uploadZone: $('uploadZone'),
  fileInput: $('fileInput'),
  editor: $('editor'),
  video: $('videoPlayer'),
  videoWarning: $('videoWarning'),
  videoName: $('videoName'),
  videoMeta: $('videoMeta'),
  seekStepInput: $('seekStepInput'),
  currentTimeLabel: $('currentTimeLabel'),
  volumeLabel: $('volumeLabel'),
  timeline: $('timeline'),
  thumbs: $('thumbs'),
  selection: $('selection'),
  startHandle: $('startHandle'),
  endHandle: $('endHandle'),
  playhead: $('playhead'),
  startTimeLabel: $('startTimeLabel'),
  segDurationLabel: $('segDurationLabel'),
  totalTimeLabel: $('totalTimeLabel'),
  startInput: $('startInput'),
  endInput: $('endInput'),
  setStartBtn: $('setStartBtn'),
  setEndBtn: $('setEndBtn'),
  previewBtn: $('previewBtn'),
  previewBtnText: $('previewBtnText'),
  mergeBtn: $('mergeBtn'),
  separateBtn: $('separateBtn'),
  addSegBtn: $('addSegBtn'),
  segmentsList: $('segmentsList'),
  segmentsHint: $('segmentsHint'),
  progressArea: $('progressArea'),
  progressFill: $('progressFill'),
  progressText: $('progressText'),
  resultArea: $('resultArea'),
  resultMsg: $('resultMsg'),
  resultList: $('resultList'),
  errorArea: $('errorArea'),
  errorText: $('errorText'),
  newVideoBar: $('newVideoBar'),
  newVideoBtn: $('newVideoBtn'),
};

/* ===== utils ===== */
function pad(n, len = 2) { return String(Math.floor(n)).padStart(len, '0'); }

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00.00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds - Math.floor(seconds)) * 100);
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
  return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function formatTimeMs(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00:00.000';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

function parseTime(str) {
  str = str.trim();
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

/* ===== backend cache ===== */
// 后端会把上传的源视频（单个最大 10 GB）和导出片段留在磁盘上。这个工具是单视频
// 工作流,前端一刷新 state 就空了,那些文件再也不会被引用 —— 不及时清就无限堆积
// （实测一晚堆了 12 GB）。所以两个时机主动清空:
//   1. 页面加载完成(window load)
//   2. 放入新视频之前
async function clearBackendCache() {
  try {
    await fetch('/api/clear-cache', { method: 'POST' });
  } catch {
    // 服务没起或网络异常 —— 清不掉也没法补救,静默跳过,不影响主流程
  }
}

// 页面加载完成事件。用 load 而不是 DOMContentLoaded: 它等所有子资源(字体等)
// 就绪后才触发,语义上就是"页面加载完成"。
window.addEventListener('load', clearBackendCache);

/* ===== upload ===== */
function setupUpload() {
  els.uploadZone.addEventListener('click', () => els.fileInput.click());

  els.fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  els.uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    els.uploadZone.classList.add('dragover');
  });

  els.uploadZone.addEventListener('dragleave', () => {
    els.uploadZone.classList.remove('dragover');
  });

  els.uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    els.uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
}

async function handleFile(file) {
  els.uploadZone.classList.add('uploading');
  // 沿用卡片外壳(保持 film-rail 齿孔条 + 居中容器)，只替换中部内容，
  // 否则 spinner 会在左上角、卡片也会塌成一窄条。
  els.uploadZone.innerHTML =
    '<div class="film-rail" aria-hidden="true"></div>' +
    '<div class="uz-body uz-body--center">' +
      '<div class="upload-spinner"></div>' +
      '<p class="upload-status">正在处理视频…</p>' +
    '</div>' +
    '<div class="film-rail" aria-hidden="true"></div>';

  // 先清掉上一个视频再落盘新的 —— 顺序不能反,否则会把刚传的文件一起删掉
  await clearBackendCache();

  const formData = new FormData();
  formData.append('video', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.error) {
      alert('\u9519\u8BEF: ' + data.error);
      resetUploadZone();
      return;
    }

    loadVideo(data);
  } catch (err) {
    alert('\u4E0A\u4F20\u5931\u8D25: ' + err.message);
    resetUploadZone();
  }
}

// 必须与 index.html 中 #uploadZone 的初始结构保持一致 —— 该区域会被整体覆写。
function resetUploadZone() {
  els.uploadZone.classList.remove('uploading', 'dragover');
  els.uploadZone.innerHTML =
    '<div class="film-rail" aria-hidden="true"></div>' +
    '<div class="uz-body">' +
      '<div class="uz-left">' +
        '<span class="uz-kicker">Step 01 / 导入素材</span>' +
        '<h2 class="uz-title">拖入视频<br><em>开始裁剪</em></h2>' +
        '<p class="uz-sub">或点击选择文件 —— 文件不会离开本机，处理完即可下载。</p>' +
        '<ul class="uz-formats">' +
          '<li>MP4</li><li>MOV</li><li>MKV</li><li>AVI</li><li>WebM</li><li>FLV</li><li>WMV</li>' +
        '</ul>' +
      '</div>' +
      '<div class="uz-right">' +
        '<div class="uz-drop-mark">＋</div>' +
      '</div>' +
    '</div>' +
    '<div class="film-rail" aria-hidden="true"></div>';
}

/* ===== video loading ===== */
function loadVideo(data) {
  state.file = data;
  state.duration = data.duration;
  state.startTime = 0;
  state.endTime = data.duration;
  state.previewMode = false;
  state.segments = [];
  renderSegments();
  updateExportUI();

  els.video.src = data.url;

  els.uploadZone.classList.add('hidden');
  els.editor.classList.remove('hidden');
  els.newVideoBar.classList.remove('hidden');

  els.videoName.textContent = data.originalName;
  const sizeMb = (data.size / 1048576).toFixed(1);
  els.videoMeta.textContent = `${data.width}\u00D7${data.height} \u00B7 ${formatTime(data.duration)} \u00B7 ${sizeMb} MB`;

  els.video.addEventListener('loadedmetadata', onVideoReady, { once: true });
  els.video.addEventListener('error', onVideoError);
}

function onVideoReady() {
  initThumbnails();
  updateTimeline();
  setupTimelineInteraction();
}

function onVideoError() {
  els.videoWarning.classList.remove('hidden');
}

/* ===== thumbnails ===== */
function initThumbnails() {
  els.thumbs.innerHTML = '';
  const thumbs = state.file.thumbnails || [];
  if (thumbs.length === 0) return;
  thumbs.forEach(url => {
    const div = document.createElement('div');
    div.className = 'timeline-thumb';
    div.style.backgroundImage = `url("${url}")`;
    els.thumbs.appendChild(div);
  });
}

/* ===== timeline ===== */
function updateTimeline() {
  const dur = state.duration || 1;
  const startPct = (state.startTime / dur) * 100;
  const endPct = (state.endTime / dur) * 100;

  els.startHandle.style.left = startPct + '%';
  els.endHandle.style.left = endPct + '%';
  els.selection.style.left = startPct + '%';
  els.selection.style.width = (endPct - startPct) + '%';

  els.startTimeLabel.textContent = formatTime(state.startTime);
  els.totalTimeLabel.textContent = formatTime(state.duration);
  els.segDurationLabel.textContent = '\u7247\u6BB5 ' + formatTime(state.endTime - state.startTime);

  els.startInput.value = formatTimeMs(state.startTime);
  els.endInput.value = formatTimeMs(state.endTime);
}

/* ===== timeline interaction ===== */
let dragging = null;

function setupTimelineInteraction() {
  els.startHandle.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    dragging = 'start';
    els.startHandle.setPointerCapture(e.pointerId);
  });

  els.endHandle.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    dragging = 'end';
    els.endHandle.setPointerCapture(e.pointerId);
  });

  document.addEventListener('pointermove', e => {
    if (!dragging) return;
    const rect = els.timeline.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const time = (x / rect.width) * state.duration;

    if (dragging === 'start') {
      state.startTime = Math.max(0, Math.min(time, state.endTime - 0.1));
      els.video.currentTime = state.startTime;
    } else {
      state.endTime = Math.min(state.duration, Math.max(time, state.startTime + 0.1));
      els.video.currentTime = state.endTime;
    }
    updateTimeline();
  });

  document.addEventListener('pointerup', () => { dragging = null; });

  // Click to seek
  els.timeline.addEventListener('click', e => {
    if (dragging) return;
    if (e.target.closest('.timeline-handle')) return;
    const rect = els.timeline.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    els.video.currentTime = (x / rect.width) * state.duration;
  });

  // Playhead
  els.video.addEventListener('timeupdate', () => {
    const pct = (els.video.currentTime / state.duration) * 100;
    els.playhead.style.left = pct + '%';
    els.currentTimeLabel.textContent = formatTime(els.video.currentTime);

    if (state.previewMode && els.video.currentTime >= state.endTime - 0.05) {
      els.video.currentTime = state.startTime;
    }
  });
}

/* ===== time inputs ===== */
els.startInput.addEventListener('change', () => {
  const t = parseTime(els.startInput.value);
  if (!isNaN(t) && t >= 0 && t < state.endTime) {
    state.startTime = t;
    els.video.currentTime = t;
    updateTimeline();
  } else {
    els.startInput.value = formatTimeMs(state.startTime);
  }
});

els.endInput.addEventListener('change', () => {
  const t = parseTime(els.endInput.value);
  if (!isNaN(t) && t > state.startTime && t <= state.duration) {
    state.endTime = t;
    els.video.currentTime = t;
    updateTimeline();
  } else {
    els.endInput.value = formatTimeMs(state.endTime);
  }
});

/* ===== quick actions ===== */
els.setStartBtn.addEventListener('click', () => {
  state.startTime = Math.max(0, Math.min(els.video.currentTime, state.endTime - 0.1));
  updateTimeline();
});

els.setEndBtn.addEventListener('click', () => {
  state.endTime = Math.min(state.duration, Math.max(els.video.currentTime, state.startTime + 0.1));
  updateTimeline();
});

els.previewBtn.addEventListener('click', () => {
  state.previewMode = !state.previewMode;
  if (state.previewMode) {
    els.video.currentTime = state.startTime;
    els.video.play();
    els.previewBtn.classList.add('active');
    els.previewBtnText.textContent = '\u23F9 \u505C\u6B62\u9884\u89C8';
  } else {
    els.video.pause();
    els.previewBtn.classList.remove('active');
    els.previewBtnText.textContent = '\u9884\u89C8\u7247\u6BB5';
  }
});

els.video.addEventListener('ended', () => {
  if (state.previewMode) {
    state.previewMode = false;
    els.previewBtn.classList.remove('active');
    els.previewBtnText.textContent = '\u9884\u89C8\u7247\u6BB5';
  }
});

/* ===== segments ===== */
function addSegment() {
  const dur = state.endTime - state.startTime;
  if (dur < 0.1) {
    alert('选区太短，无法加入切片');
    return;
  }
  state.segments.push({
    id: 'seg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    start: state.startTime,
    end: state.endTime,
  });
  renderSegments();
  updateExportUI();
}

function renderSegments() {
  els.segmentsList.innerHTML = '';
  if (state.segments.length === 0) {
    els.segmentsHint.classList.remove('hidden');
    return;
  }
  els.segmentsHint.classList.add('hidden');

  state.segments.forEach((seg, idx) => {
    const item = document.createElement('div');
    item.className = 'segment-item';
    const dur = seg.end - seg.start;
    item.innerHTML =
      '<span class="seg-index">#' + (idx + 1) + '</span>' +
      '<span class="seg-range">' + formatTime(seg.start) + ' → ' + formatTime(seg.end) + '</span>' +
      '<span class="seg-dur2">' + formatTime(dur) + '</span>' +
      '<button class="seg-del" title="删除">✕</button>';

    item.querySelector('.seg-del').addEventListener('click', e => {
      e.stopPropagation();
      state.segments = state.segments.filter(s => s.id !== seg.id);
      renderSegments();
      updateExportUI();
    });

    // Click row to load this segment back into the timeline selection
    item.addEventListener('click', () => {
      state.startTime = seg.start;
      state.endTime = seg.end;
      if (els.video) els.video.currentTime = seg.start;
      updateTimeline();
    });

    els.segmentsList.appendChild(item);
  });
}

function updateExportUI() {
  const n = state.segments.length;
  if (n === 0) {
    els.mergeBtn.classList.add('hidden');
    els.separateBtn.classList.add('hidden');
    els.mergeBtn.disabled = true;
    els.separateBtn.disabled = true;
    return;
  }
  els.mergeBtn.disabled = false;
  els.mergeBtn.classList.remove('hidden');
  if (n === 1) {
    els.mergeBtn.textContent = '\u2702\uFE0F \u5BFC\u51FA\u7247\u6BB5';
    els.separateBtn.classList.add('hidden');
    els.separateBtn.disabled = true;
  } else {
    els.mergeBtn.textContent = '\u2702\uFE0F \u5408\u5E76\u5BFC\u51FA (' + n + ')';
    els.separateBtn.classList.remove('hidden');
    els.separateBtn.disabled = false;
    els.separateBtn.textContent = '\u{1F4E6} \u5BFC\u51FA ' + n + ' \u4E2A\u5355\u72EC\u7247\u6BB5';
  }
}

els.addSegBtn.addEventListener('click', addSegment);

/* ===== export ===== */

// 处理中禁用"选择新视频"：中途换片会让正在跑的 ffmpeg 任务失去源文件，
// 而且导出结果里的下载链接指向的文件会被下一次清缓存删掉。
// 用 disabled 而不是隐藏 —— 隐藏会让下方内容往上跳，按钮凭空消失也让人困惑。
// 所有出口（成功 / 失败）都必须走 setBusy(false)，否则按钮会永久卡在禁用态。
function setBusy(busy) {
  els.newVideoBtn.disabled = busy;
  els.mergeBtn.disabled = busy;
  els.separateBtn.disabled = busy;
}

async function startExport(type) {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (state.segments.length === 0) return;

  setBusy(true);
  els.mergeBtn.textContent = '\u5904\u7406\u4E2D...';
  els.separateBtn.classList.add('hidden');
  els.progressArea.classList.remove('hidden');
  els.resultArea.classList.add('hidden');
  els.errorArea.classList.add('hidden');
  els.progressFill.style.width = '0%';
  els.progressText.textContent = `\u6B63\u5728\u5904\u7406 ${state.segments.length} \u4E2A\u5207\u7247...`;

  const endpoint = type === 'separate' ? '/api/trim-separate' : '/api/trim-multi';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: state.file.filename,
        originalName: state.file.originalName,
        mode,
        segments: state.segments.map(s => ({ start: s.start, end: s.end }))
      })
    });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    pollStatus(data.jobId, type);
  } catch (err) {
    showError(err.message);
  }
}

els.mergeBtn.addEventListener('click', () => startExport('merge'));
els.separateBtn.addEventListener('click', () => startExport('separate'));

function pollStatus(jobId, type) {
  const poll = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      const data = await res.json();

      if (data.status === 'processing') {
        els.progressFill.style.width = data.progress + '%';
        els.progressText.textContent = `\u5904\u7406\u4E2D... ${Math.round(data.progress)}%`;
      } else if (data.status === 'done') {
        clearInterval(poll);
        els.progressFill.style.width = '100%';
        setTimeout(() => {
          if (type === 'separate') showResults(data.files, data.zipUrl, data.zipName);
          else showResult(data.url, data.filename);
        }, 300);
      } else if (data.status === 'error') {
        clearInterval(poll);
        showError(data.error);
      }
    } catch {
      clearInterval(poll);
      showError('\u7F51\u7EDC\u9519\u8BEF\uFF0C\u8BF7\u91CD\u8BD5');
    }
  }, 500);
}

function renderResultItems(files, zipUrl, zipName) {
  els.resultList.innerHTML = '';
  const baseName = (state.file && state.file.originalName ? state.file.originalName : 'video').replace(/\.[^.]+$/, '');
  // "Download all" (ZIP) button — only when there are multiple clips
  if (zipUrl && files.length > 1) {
    const allItem = document.createElement('div');
    allItem.className = 'result-item result-all';
    allItem.innerHTML =
      '<span class="result-all-label">\u{1F4E6} 一次性下载全部 ' + files.length + ' 个片段（ZIP）</span>' +
      '<a class="btn btn-primary btn-block" href="' + zipUrl + '" download="' + (zipName || (baseName + '_clips.zip')) + '">\u{1F4E5} 下载全部 (ZIP)</a>';
    els.resultList.appendChild(allItem);
  }
  files.forEach((f, idx) => {
    const ext = (f.filename.match(/(\.[^.]+)$/) || ['.mp4'])[0];
    const dlName = baseName + '_clip' + (idx + 1) + ext;
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML =
      '<video src="' + f.url + '" controls preload="metadata" class="result-video"></video>' +
      '<a class="btn btn-outline btn-block" href="' + f.url + '" download="' + dlName + '">\u2B07\uFE0F \u4E0B\u8F7D\u7247\u6BB5 ' + (idx + 1) + '</a>';
    els.resultList.appendChild(item);
  });
}

function showResult(url, filename) {
  els.progressArea.classList.add('hidden');
  els.resultArea.classList.remove('hidden');
  els.resultMsg.textContent = '\u2705 \u5DF2\u5408\u5E76\u5BFC\u51FA\uFF01';
  renderResultItems([{ url, filename }]);
  setBusy(false);
  updateExportUI();
}

function showResults(files, zipUrl, zipName) {
  els.progressArea.classList.add('hidden');
  els.resultArea.classList.remove('hidden');
  els.resultMsg.textContent = '\u2705 \u5DF2\u5BFC\u51FA ' + files.length + ' \u4E2A\u5355\u72EC\u7247\u6BB5\uFF01';
  renderResultItems(files, zipUrl, zipName);
  setBusy(false);
  updateExportUI();
}

function showError(msg) {
  els.progressArea.classList.add('hidden');
  els.errorArea.classList.remove('hidden');
  els.errorText.textContent = '\u274C ' + msg;
  setBusy(false);
  updateExportUI();
}

/* ===== new video ===== */
els.newVideoBtn.addEventListener('click', () => {
  state.file = null;
  state.duration = 0;
  state.startTime = 0;
  state.endTime = 0;
  state.previewMode = false;
  state.segments = [];
  renderSegments();
  updateExportUI();

  els.video.pause();
  els.video.removeAttribute('src');
  els.video.load();

  els.uploadZone.classList.remove('hidden'); // loadVideo 时给它加了 hidden,这里要还原
  els.editor.classList.add('hidden');
  els.newVideoBar.classList.add('hidden');
  els.resultArea.classList.add('hidden');
  els.errorArea.classList.add('hidden');
  els.progressArea.classList.add('hidden');
  els.videoWarning.classList.add('hidden');

  resetUploadZone();
  els.fileInput.value = '';
});

/* ===== seek step input: positive integers only (no 0, no decimals) ===== */
function sanitizeSeekStep() {
  const cleaned = els.seekStepInput.value
    .split('.')[0]          // drop any decimal part (integers only)
    .replace(/[^0-9]/g, '') // strip anything that isn't a digit
    .replace(/^0+/, '');    // strip leading zeros -> also blocks plain "0"
  if (cleaned !== els.seekStepInput.value) els.seekStepInput.value = cleaned;
}

els.seekStepInput.addEventListener('input', sanitizeSeekStep);

// Leave the field when the value is committed, so Space / ←→ shortcuts work again
// (while an input has focus the shortcut handler is intentionally disabled).
els.seekStepInput.addEventListener('change', () => { sanitizeSeekStep(); els.seekStepInput.blur(); });
els.seekStepInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); sanitizeSeekStep(); els.seekStepInput.blur(); }
});

/* ===== custom stepper buttons (− / +) ===== */
// Bump the step value by `delta` (±1), clamp to [1, 600], then release focus so
// Space / ←→ keyboard shortcuts work again.
function adjustStep(delta) {
  let n = parseInt(els.seekStepInput.value, 10);
  if (isNaN(n)) n = 3;
  n = Math.max(1, Math.min(600, n + delta));
  els.seekStepInput.value = String(n);
  els.seekStepInput.blur();
}
document.querySelectorAll('.stepper-btn').forEach(btn => {
  btn.addEventListener('click', () => adjustStep(parseInt(btn.dataset.delta, 10)));
});

// On blur, restore a sane value if the field was left empty / out of range.
els.seekStepInput.addEventListener('blur', () => {
  let n = parseInt(els.seekStepInput.value, 10);
  if (isNaN(n) || n < 1) n = 3;
  if (n > 600) n = 600;
  els.seekStepInput.value = String(n);
});

/* ===== keyboard shortcuts ===== */

// Step size in seconds: a positive integer, default 3, clamped to [1, 600].
function getSeekStep() {
  const v = parseInt(els.seekStepInput.value, 10);
  if (isNaN(v) || v < 1) return 3;
  return Math.min(600, v);
}

// The position we last asked for. Browsers can land on a slightly different frame
// than requested, so accumulating from this (instead of reading currentTime each
// time) keeps repeated presses stepping by exactly the configured amount.
let seekTarget = null;
let stepSeeking = false;

function seekBy(delta) {
  if (!state.file) return;
  const maxDur = state.duration || els.video.duration || 0;
  // While paused: accumulate from our own target for exact stepping.
  // While playing: follow the live playhead.
  const base = (seekTarget !== null && els.video.paused) ? seekTarget : els.video.currentTime;
  const next = Math.max(0, Math.min(maxDur, base + delta));
  seekTarget = next;
  stepSeeking = true;
  els.video.currentTime = next;
}

// Resync to the real playhead when the position changes for any other reason
// (timeline click, native controls, playback, new video).
els.video.addEventListener('seeked', () => {
  if (stepSeeking) {
    stepSeeking = false;
    // If the browser couldn't actually land near the requested time (coarse
    // seeking / sparse keyframes), resync to the real playhead — otherwise our
    // target drifts away from reality and later presses appear to do nothing.
    if (seekTarget !== null && Math.abs(els.video.currentTime - seekTarget) > 0.75) {
      seekTarget = els.video.currentTime;
    }
  } else {
    seekTarget = null; // external seek (timeline click, native controls)
  }
});
els.video.addEventListener('play', () => { seekTarget = null; });
els.video.addEventListener('loadedmetadata', () => { seekTarget = null; });

// 常驻音量读数。视频在播放时播放头本来就在动,没有这个读数就无法判断
// ↑↓ 到底改的是音量还是进度 —— 它是唯一能自证的反馈。
let volumeBumpTimer = null;
function renderVolume() {
  if (!els.volumeLabel) return;
  const pct = Math.round(els.video.volume * 100);
  const silent = els.video.muted || pct === 0;
  els.volumeLabel.textContent = (silent ? '\u{1F507}' : '\u{1F50A}') + ' ' + pct + '%';
  els.volumeLabel.classList.toggle('is-muted', silent);
}

// 换档时读数会点亮一下。
function flashVolume() {
  if (!els.volumeLabel) return;
  els.volumeLabel.classList.add('is-bumped');
  clearTimeout(volumeBumpTimer);
  volumeBumpTimer = setTimeout(() => {
    if (els.volumeLabel) els.volumeLabel.classList.remove('is-bumped');
  }, 450);
}

els.video.addEventListener('volumechange', () => { renderVolume(); flashVolume(); });
els.video.addEventListener('loadedmetadata', renderVolume);

// Change playback volume by `delta` (±0.1 = ±10%), clamped to [0, 1].
// Rounding to 2 decimals avoids float drift (0.1 + 0.2 => 0.30000000000000004).
function adjustVolume(delta) {
  if (!state.file) return;
  let next = Math.round((els.video.volume + delta) * 100) / 100;
  next = Math.min(1, Math.max(0, next));
  els.video.volume = next;
  // Raising the volume should also un-mute, otherwise nothing is heard.
  if (next > 0 && els.video.muted) els.video.muted = false;
}

// 监听放在【捕获阶段】(capture: true) —— 这是关键。
// <video controls> 的原生播放/暂停、方向键快进、音量都是在它自己的 UA shadow DOM
// 内部处理的,而 shadow DOM 里的监听器会在事件冒泡到 document 【之前】就执行。
// 用冒泡监听的话顺序是: 原生先切一次 → 我们再切一次 → 两次抵消,表现就是
// "按空格没反应";方向键同理(原生 ±5s 再叠加我们的步进,所以步长也对不上)。
// 捕获阶段从 window 往下走,我们第一个拿到事件,stopPropagation 后事件根本
// 到不了 video 的内部处理器,原生行为就不会叠加了。
window.addEventListener('keydown', e => {
  if (!state.file) return;
  const t = e.target;
  const inEditable = (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

  // 空格：除了正在输入文本,一律切换播放/暂停。
  // 覆盖 button / radio / video 自身获得焦点的情况 —— 这些元素本来会各自吃掉空格
  // (button 会被再次"点击"、radio 会被选中、video 会原生切换一次)。
  if (e.key === ' ') {
    if (inEditable && t !== els.seekStepInput) return; // 文本框里要能打空格
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;                              // 忽略长按自动重复
    if (els.video.paused) els.video.play(); else els.video.pause();
    return;
  }
  if (inEditable) return;

  switch (e.key) {
    case '[':
      e.stopPropagation();
      state.startTime = Math.max(0, Math.min(els.video.currentTime, state.endTime - 0.1));
      updateTimeline();
      break;
    case ']':
      e.stopPropagation();
      state.endTime = Math.min(state.duration, Math.max(els.video.currentTime, state.startTime + 0.1));
      updateTimeline();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      e.stopPropagation();
      seekBy(-getSeekStep());
      break;
    case 'ArrowRight':
      e.preventDefault();
      e.stopPropagation();
      seekBy(getSeekStep());
      break;
    case 'ArrowUp':
      e.preventDefault();
      e.stopPropagation();
      adjustVolume(0.1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      e.stopPropagation();
      adjustVolume(-0.1);
      break;
  }
}, true);

/* ===== init ===== */
setupUpload();
updateExportUI();
