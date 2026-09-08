const express = require('express');
const multer = require('multer');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- directories ---------- */
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
[UPLOAD_DIR, OUTPUT_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

/* ---------- middleware ---------- */
app.use(express.json({ limit: '1mb' }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

/* ---------- multer ---------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    cb(null, id + ext);
  }
});

// Max upload size — configurable via MAX_UPLOAD_GB env var (default 10 GB)
const MAX_UPLOAD_GB = parseInt(process.env.MAX_UPLOAD_GB, 10) || 10;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_GB * 1024 * 1024 * 1024;

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.mpg', '.mpeg', '.ts', '.3gp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('不支持的视频格式: ' + (ext || '未知')));
    }
    cb(null, true);
  }
});

/* ---------- in-memory job store ---------- */
const jobs = new Map();

/* ---------- helpers ---------- */

// Get video metadata via ffprobe
function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath
    ], (err, stdout) => {
      if (err) return reject(err);
      try {
        const data = JSON.parse(stdout);
        const stream = (data.streams && data.streams[0]) || {};
        resolve({
          duration: parseFloat(data.format && data.format.duration ? data.format.duration : '0'),
          width: stream.width || 0,
          height: stream.height || 0
        });
      } catch (e) { reject(e); }
    });
  });
}

// Generate evenly-spaced thumbnails for the timeline strip
function generateThumbnails(inputPath, duration, fileId) {
  return new Promise((resolve) => {
    const numFrames = Math.min(20, Math.max(8, Math.ceil(duration)));
    const thumbDir = path.join(UPLOAD_DIR, fileId + '_thumbs');
    fs.mkdirSync(thumbDir, { recursive: true });

    const fps = (numFrames / duration).toFixed(6);
    const timeout = setTimeout(() => resolve([]), 30000);

    execFile('ffmpeg', [
      '-i', inputPath,
      '-vf', `fps=${fps},scale=200:-1`,
      '-frames:v', String(numFrames),
      '-y', path.join(thumbDir, 't_%03d.jpg')
    ], (err) => {
      clearTimeout(timeout);
      if (err) { resolve([]); return; }
      try {
        const files = fs.readdirSync(thumbDir)
          .filter(f => f.endsWith('.jpg'))
          .sort()
          .map(f => `/uploads/${fileId}_thumbs/${f}`);
        resolve(files);
      } catch { resolve([]); }
    });
  });
}

/* ---------- routes ---------- */

// Main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload video
app.post('/api/upload', (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: `文件过大，单个视频不能超过 ${MAX_UPLOAD_GB} GB` });
        }
        return res.status(400).json({ error: '上传失败: ' + err.message });
      }
      return res.status(400).json({ error: err.message || '上传失败' });
    }

    if (!req.file) return res.status(400).json({ error: '未选择文件' });

  const filePath = req.file.path;
  const filename = req.file.filename;
  const fileId = path.basename(filename, path.extname(filename));

  try {
    const info = await getVideoInfo(filePath);

    if (info.duration < 0.1) {
      fs.unlink(filePath, () => {});
      return res.status(400).json({ error: '视频时长过短，无法裁剪' });
    }

    const thumbnails = await generateThumbnails(filePath, info.duration, fileId);

    res.json({
      filename,
      originalName: req.file.originalname,
      duration: info.duration,
      width: info.width,
      height: info.height,
      size: req.file.size,
      thumbnails,
      url: `/uploads/${filename}`
    });
  } catch (err) {
    fs.unlink(filePath, () => {});
    res.status(500).json({ error: '视频分析失败: ' + err.message });
  }
  });
});

// Start trim job
app.post('/api/trim', (req, res) => {
  const { filename, start, end, mode } = req.body;

  if (!filename || start == null || end == null || !mode) {
    return res.status(400).json({ error: '参数不完整' });
  }

  const startSec = parseFloat(start);
  const endSec = parseFloat(end);

  if (isNaN(startSec) || isNaN(endSec) || startSec < 0 || endSec <= startSec) {
    return res.status(400).json({ error: '时间范围无效' });
  }

  if (mode !== 'fast' && mode !== 'precise' && mode !== 'original') {
    return res.status(400).json({ error: '裁剪模式无效' });
  }

  // Prevent path traversal
  const inputPath = path.join(UPLOAD_DIR, path.basename(filename));
  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: '源视频不存在，请重新上传' });
  }

  const ext = '.mp4';
  const outputName = 'trim-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
  const outputPath = path.join(OUTPUT_DIR, outputName);
  const duration = endSec - startSec;

  const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  jobs.set(jobId, { status: 'processing', progress: 0 });

  const args = mode === 'original'
    ? ['-ss', String(startSec), '-i', inputPath, '-t', String(duration),
       '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-y', outputPath]
    : (mode === 'precise'
      ? ['-ss', String(startSec), '-i', inputPath, '-t', String(duration),
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
         '-c:a', 'aac', '-y', outputPath]
      : ['-ss', String(startSec), '-i', inputPath, '-t', String(duration),
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
         '-c:a', 'aac', '-y', outputPath]);

  const proc = spawn('ffmpeg', args);
  let stderrBuf = '';

  proc.stderr.on('data', (data) => {
    stderrBuf += data.toString();
    // Parse the last time= field for progress
    const matches = stderrBuf.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/g);
    if (matches) {
      const last = matches[matches.length - 1];
      const m = last.match(/(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      const processed = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
      const progress = Math.min(99, (processed / duration) * 100);
      const job = jobs.get(jobId);
      if (job && job.status === 'processing') {
        job.progress = progress;
      }
    }
  });

  proc.on('close', (code) => {
    const job = jobs.get(jobId);
    if (!job) return;

    if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      job.status = 'done';
      job.progress = 100;
      job.url = `/outputs/${outputName}`;
      job.filename = outputName;
    } else {
      job.status = 'error';
      job.error = '裁剪失败，请尝试切换裁剪模式';
      if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {});
    }

    // Clean up job entry after 5 minutes
    setTimeout(() => jobs.delete(jobId), 5 * 60 * 1000);
  });

  proc.on('error', () => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = 'ffmpeg 启动失败，请确认已安装 ffmpeg';
    }
  });

  res.json({ jobId });
});

// Build ffmpeg args for a single-segment trim.
// - original: stream copy (-c copy), lossless, no size increase, snaps to keyframe.
// - fast / precise: re-encode (libx264/aac) so cuts are frame-accurate.
//   Fast = veryfast/CRF23, Precise = medium/CRF18.
function buildTrimArgs(input, output, start, dur, mode) {
  if (mode === 'original') {
    return ['-ss', String(start), '-i', input, '-t', String(dur),
            '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-y', output];
  }
  const preset = mode === 'precise' ? 'medium' : 'veryfast';
  const crf = mode === 'precise' ? '18' : '23';
  return ['-ss', String(start), '-i', input, '-t', String(dur),
          '-c:v', 'libx264', '-preset', preset, '-crf', crf,
          '-c:a', 'aac', '-y', output];
}

// Run ffmpeg, resolve on exit 0, reject otherwise; report progress fraction 0..1
function runFfmpegWithProgress(args, totalDuration, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderrBuf = '';
    proc.stderr.on('data', data => {
      stderrBuf += data.toString();
      if (totalDuration > 0) {
        const matches = stderrBuf.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/g);
        if (matches) {
          const m = matches[matches.length - 1].match(/(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
          const processed = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          onProgress(Math.min(1, processed / totalDuration));
        }
      }
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg 处理失败 (code ' + code + ')'));
    });
    proc.on('error', err => reject(err));
  });
}

// Multi-segment trim + concat
app.post('/api/trim-multi', async (req, res) => {
  const { filename, mode, segments } = req.body;

  if (!filename || !mode || !Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: '参数不完整' });
  }
  if (mode !== 'fast' && mode !== 'precise' && mode !== 'original') {
    return res.status(400).json({ error: '裁剪模式无效' });
  }
  if (segments.length > 100) {
    return res.status(400).json({ error: '切片数量过多（最多 100 个）' });
  }

  const inputPath = path.join(UPLOAD_DIR, path.basename(filename));
  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: '源视频不存在，请重新上传' });
  }

  let info;
  try {
    info = await getVideoInfo(inputPath);
  } catch (e) {
    return res.status(500).json({ error: '视频分析失败: ' + e.message });
  }

  // Validate + normalize segments
  const cleanSegs = [];
  for (const s of segments) {
    const start = parseFloat(s.start);
    const end = parseFloat(s.end);
    if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
      return res.status(400).json({ error: '存在无效的时间范围' });
    }
    if (end > info.duration + 0.2) {
      return res.status(400).json({ error: '切片时间超出视频时长' });
    }
    cleanSegs.push({ start, end, dur: end - start });
  }

  const ext = '.mp4';
  const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const job = { status: 'processing', progress: 0 };
  jobs.set(jobId, job);

  (async () => {
    const totalSegDur = cleanSegs.reduce((a, s) => a + s.dur, 0);
    const listPath = path.join(OUTPUT_DIR, `list-${jobId}.txt`);
    const finalName = 'merged-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    const finalPath = path.join(OUTPUT_DIR, finalName);

    const cleanup = () => {
      try { fs.unlinkSync(listPath); } catch {}
      if (job.status === 'error') { try { fs.unlinkSync(finalPath); } catch {} }
    };

    try {
      if (mode === 'original') {
        // Original quality for MULTIPLE segments: a pure stream-copy concat cannot be
        // frame-accurate (keyframe snapping drifts the duration, as verified). So we cut
        // via the concat demuxer's inpoint/outpoint (frame-accurate) and run ONE
        // near-original re-encode pass over the whole result — single encode, exact
        // duration, quality ~source. (Single-segment original stays truly lossless copy.)
        const srcForList = inputPath.replace(/\\/g, '/');
        const listBody = cleanSegs
          .map(s => `file '${srcForList}'\ninpoint ${s.start}\noutpoint ${s.end}`)
          .join('\n');
        fs.writeFileSync(listPath, listBody);

        await runFfmpegWithProgress(
          ['-f', 'concat', '-safe', '0', '-i', listPath,
           '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
           '-c:a', 'aac', '-y', finalPath],
          totalSegDur,
          frac => { job.progress = Math.min(99, frac * 99); }
        );
      } else {
        // fast / precise: re-encode each segment accurately, then lossless copy-concat.
        const segPaths = [];
        for (let i = 0; i < cleanSegs.length; i++) {
          const s = cleanSegs[i];
          const segPath = path.join(OUTPUT_DIR, `seg-${jobId}-${i}${ext}`);
          await runFfmpegWithProgress(
            buildTrimArgs(inputPath, segPath, s.start, s.dur, mode),
            s.dur,
            frac => { job.progress = Math.min(95, ((i + frac) / cleanSegs.length) * 90 + 1); }
          );
          if (!fs.existsSync(segPath) || fs.statSync(segPath).size === 0) {
            throw new Error('切片 #' + (i + 1) + ' 生成失败');
          }
          segPaths.push(segPath);
        }

        fs.writeFileSync(listPath, segPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));

        await runFfmpegWithProgress(
          ['-fflags', '+genpts', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', finalPath],
          totalSegDur,
          frac => { job.progress = Math.min(99, 95 + frac * 4); }
        );

        segPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
      }

      if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size === 0) {
        throw new Error('合并失败，请尝试切换裁剪模式');
      }

      job.status = 'done';
      job.progress = 100;
      job.url = `/outputs/${finalName}`;
      job.filename = finalName;
    } catch (err) {
      job.status = 'error';
      job.error = err.message || '处理失败';
    } finally {
      cleanup();
      setTimeout(() => jobs.delete(jobId), 5 * 60 * 1000);
    }
  })();

  res.json({ jobId });
});

// Multi-segment trim, export each segment as a separate file
app.post('/api/trim-separate', async (req, res) => {
  const { filename, mode, segments } = req.body;

  if (!filename || !mode || !Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: '参数不完整' });
  }
  if (mode !== 'fast' && mode !== 'precise' && mode !== 'original') {
    return res.status(400).json({ error: '裁剪模式无效' });
  }
  if (segments.length > 100) {
    return res.status(400).json({ error: '切片数量过多（最多 100 个）' });
  }

  const inputPath = path.join(UPLOAD_DIR, path.basename(filename));
  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: '源视频不存在，请重新上传' });
  }

  let info;
  try {
    info = await getVideoInfo(inputPath);
  } catch (e) {
    return res.status(500).json({ error: '视频分析失败: ' + e.message });
  }

  const cleanSegs = [];
  for (const s of segments) {
    const start = parseFloat(s.start);
    const end = parseFloat(s.end);
    if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
      return res.status(400).json({ error: '存在无效的时间范围' });
    }
    if (end > info.duration + 0.2) {
      return res.status(400).json({ error: '切片时间超出视频时长' });
    }
    cleanSegs.push({ start, end, dur: end - start });
  }

  const ext = '.mp4';
  const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const job = { status: 'processing', progress: 0 };
  jobs.set(jobId, job);

  // Friendly clip name prefix for the ZIP (falls back to the stored filename).
  const baseName = (req.body.originalName
    ? String(req.body.originalName).replace(/\.[^.]+$/, '')
    : path.basename(filename, ext)) || 'video';

  (async () => {
    const outFiles = [];
    const total = cleanSegs.length;
    // Separate export makes each segment a standalone file. A pure stream-copy cut would
    // snap to the previous keyframe and produce overlapping/wrong-length clips, so for
    // original mode we re-encode each clip once at near-original quality (CRF 18).
    const segMode = (mode === 'original') ? 'precise' : mode;
    try {
      for (let i = 0; i < total; i++) {
        const s = cleanSegs[i];
        const outName = 'clip-' + jobId + '-' + i + ext;
        const outPath = path.join(OUTPUT_DIR, outName);
        await runFfmpegWithProgress(
          buildTrimArgs(inputPath, outPath, s.start, s.dur, segMode),
          s.dur,
          frac => { job.progress = Math.min(99, ((i + frac) / total) * 100); }
        );
        if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
          throw new Error('片段 #' + (i + 1) + ' 生成失败');
        }
        outFiles.push({ url: '/outputs/' + outName, filename: outName });
      }

      // For multiple clips, also bundle them into one ZIP so the user can download all
      // at once. Videos are already compressed, so store (level 0) to avoid wasting CPU.
      if (total > 1) {
        const zipName = 'clips-' + jobId + '.zip';
        const zipPath = path.join(OUTPUT_DIR, zipName);
        await new Promise((resolve, reject) => {
          const output = fs.createWriteStream(zipPath);
          const archive = new archiver.ZipArchive({ zlib: { level: 0 } });
          output.on('close', resolve);
          archive.on('error', reject);
          archive.pipe(output);
          outFiles.forEach((f, i) => {
            archive.file(path.join(OUTPUT_DIR, f.filename), { name: baseName + '_clip' + (i + 1) + ext });
          });
          archive.finalize();
        });
        job.zipUrl = '/outputs/' + zipName;
        job.zipName = zipName;
      }

      job.status = 'done';
      job.progress = 100;
      job.files = outFiles;
    } catch (err) {
      job.status = 'error';
      job.error = err.message || '处理失败';
      outFiles.forEach(f => { try { fs.unlinkSync(path.join(OUTPUT_DIR, f.filename)); } catch {} });
      if (job.zipName) { try { fs.unlinkSync(path.join(OUTPUT_DIR, job.zipName)); } catch {} }
    } finally {
      setTimeout(() => jobs.delete(jobId), 5 * 60 * 1000);
    }
  })();

  res.json({ jobId });
});

// Poll job status
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '任务不存在或已过期' });
  res.json(job);
});

/* ---------- cleanup ---------- */
function cleanupOldFiles() {
  const now = Date.now();
  const maxAge = 2 * 60 * 60 * 1000; // 2 hours

  [UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(item => {
      const itemPath = path.join(dir, item);
      try {
        const stat = fs.statSync(itemPath);
        if (stat.isFile() && now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(itemPath);
        } else if (stat.isDirectory() && now - stat.mtimeMs > maxAge) {
          fs.rmSync(itemPath, { recursive: true, force: true });
        }
      } catch {}
    });
  });
}

cleanupOldFiles();

/* ---------- start ---------- */
app.listen(PORT, () => {
  console.log(`\n  \u2702\uFE0F  Video Scissors running\n  \u2192  http://localhost:${PORT}\n`);
});
