/* Thread Fight — in-browser video export.
 * Primary: WebCodecs (H.264 + AAC, or Opus where AAC isn't available) muxed to MP4, rendered offline —
 * faster than real time and unaffected by tab throttling.
 * Fallback: MediaRecorder capture of a real-time playback (WebM), for browsers without WebCodecs H.264.
 */
(function (root) {
'use strict';
const W = 1280, H = 720;

// A yield that isn't throttled in background tabs (setTimeout is).
const yieldNow = (() => { const ch = new MessageChannel(), q = []; ch.port1.onmessage = () => { const r = q.shift(); r && r(); }; return () => new Promise(r => { q.push(r); ch.port2.postMessage(0); }); })();

async function pickVideo(fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42001f']) {
    const cfg = { codec, width: W, height: H, bitrate: 4_500_000, framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (e) { /* try next */ }
  }
  return null;
}
async function pickAudio(sampleRate) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate, numberOfChannels: 1, bitrate: 128000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch (e) { /* try next */ }
  }
  return null;
}

async function exportMp4(S, pcm, sampleRate, o) {
  o = o || {};
  const fps = o.fps || 30;
  const vcfg = await pickVideo(fps);
  if (!vcfg) return null; // caller falls back to WebM recording
  const acfg = await pickAudio(sampleRate);
  const { Muxer, ArrayBufferTarget } = root.Mp4Muxer;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H, frameRate: fps },
    audio: acfg ? { codec: acfg.mux, numberOfChannels: 1, sampleRate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let failure = null;

  if (acfg) {
    const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { failure = e; } });
    ae.configure(acfg.cfg);
    const step = 4800;
    for (let i = 0; i < pcm.length; i += step) {
      const part = pcm.subarray(i, Math.min(pcm.length, i + step));
      const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round(i / sampleRate * 1e6), data: part });
      ae.encode(ad); ad.close();
    }
    await ae.flush(); ae.close();
  }

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { failure = e; } });
  ve.configure(vcfg);
  const n = Math.ceil(S.duration * fps), us = 1e6 / fps;
  for (let i = 0; i < n; i++) {
    if (o.signal && o.signal.aborted) { ve.close(); throw new DOMException('Export cancelled', 'AbortError'); }
    if (failure) throw failure;
    root.ThreadFight.render(ctx, S, i / fps);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
    ve.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (ve.encodeQueueSize > 6) await yieldNow();
    if (i % 15 === 0) { if (o.onProgress) o.onProgress(i / n); await yieldNow(); }
  }
  await ve.flush(); ve.close();
  if (failure) throw failure;
  muxer.finalize();
  if (o.onProgress) o.onProgress(1);
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4', audio: acfg ? acfg.mux : 'none' };
}

// Real-time fallback: plays the fight into a MediaRecorder.
async function recordWebm(S, audioBuffer, o) {
  o = o || {};
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const ac = new AudioContext({ sampleRate: audioBuffer.sampleRate });
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource(); src.buffer = audioBuffer; src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => { rec.onstop = r; });
  root.ThreadFight.render(ctx, S, 0);
  rec.start(500); await ac.resume(); const t0 = ac.currentTime; src.start();
  await new Promise(resolve => {
    const tick = () => {
      const t = ac.currentTime - t0;
      root.ThreadFight.render(ctx, S, Math.min(t, S.duration));
      if (o.onProgress) o.onProgress(Math.min(1, t / S.duration));
      if (t >= S.duration || (o.signal && o.signal.aborted)) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop(); await done; ac.close();
  if (o.signal && o.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
  return { blob: new Blob(chunks, { type: 'video/webm' }), ext: 'webm', audio: 'opus' };
}

root.TFEncode = { exportMp4, recordWebm };
})(typeof window !== 'undefined' ? window : globalThis);
