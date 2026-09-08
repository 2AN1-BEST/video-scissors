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
  els.uploadZone.innerHTML = '<div class="upload-spinner"></div><p>\u6B63\u5728\u5904\u7406\u89C6\u9891...</p>';

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

function resetUploadZone() {
  els.uploadZone.classList.remove('uploading', 'dragover');
  els.uploadZone.innerHTML =
    '<div class="upload-icon">\u{1F4F9}</div>' +
    '<h2 class="upload-title">\u62D6\u62FD\u89C6\u9891\u6587\u4EF6\u5230\u6B64\u5904</h2>' +
    '<p class="upload-subtitle">\u6216\u70B9\u51FB\u9009\u62E9\u6587\u4EF6</p>' +
    '<p class="upload-formats">\u652F\u6301 MP4 \u00B7 AVI \u00B7 MOV \u00B7 MKV \u00B7 WebM \u00B7 FLV \u00B7 WMV</p>';
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
async function startExport(type) {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (state.segments.length === 0) return;

  els.mergeBtn.disabled = true;
  els.separateBtn.disabled = true;
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
      '<a class="btn btn-success btn-block" href="' + f.url + '" download="' + dlName + '">\u2B07\uFE0F \u4E0B\u8F7D\u7247\u6BB5 ' + (idx + 1) + '</a>';
    els.resultList.appendChild(item);
  });
}

function showResult(url, filename) {
  els.progressArea.classList.add('hidden');
  els.resultArea.classList.remove('hidden');
  els.resultMsg.textContent = '\u2705 \u5DF2\u5408\u5E76\u5BFC\u51FA\uFF01';
  renderResultItems([{ url, filename }]);
  els.mergeBtn.disabled = false;
  els.separateBtn.disabled = false;
  updateExportUI();
}

function showResults(files, zipUrl, zipName) {
  els.progressArea.classList.add('hidden');
  els.resultArea.classList.remove('hidden');
  els.resultMsg.textContent = '\u2705 \u5DF2\u5BFC\u51FA ' + files.length + ' \u4E2A\u5355\u72EC\u7247\u6BB5\uFF01';
  renderResultItems(files, zipUrl, zipName);
  els.mergeBtn.disabled = false;
  els.separateBtn.disabled = false;
  updateExportUI();
}

function showError(msg) {
  els.progressArea.classList.add('hidden');
  els.errorArea.classList.remove('hidden');
  els.errorText.textContent = '\u274C ' + msg;
  els.mergeBtn.disabled = false;
  els.separateBtn.disabled = false;
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

  els.editor.classList.add('hidden');
  els.newVideoBar.classList.add('hidden');
  els.resultArea.classList.add('hidden');
  els.errorArea.classList.add('hidden');
  els.progressArea.classList.add('hidden');
  els.videoWarning.classList.add('hidden');

  resetUploadZone();
  els.fileInput.value = '';
});

/* ===== keyboard shortcuts ===== */
document.addEventListener('keydown', e => {
  if (!state.file) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (els.video.paused) els.video.play(); else els.video.pause();
      break;
    case '[':
      state.startTime = Math.max(0, Math.min(els.video.currentTime, state.endTime - 0.1));
      updateTimeline();
      break;
    case ']':
      state.endTime = Math.min(state.duration, Math.max(els.video.currentTime, state.startTime + 0.1));
      updateTimeline();
      break;
  }
});

/* ===== init ===== */
setupUpload();
updateExportUI();
