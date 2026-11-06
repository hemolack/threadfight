(async function () {
  'use strict';
  const R = window.TFReferee, TF = window.ThreadFight;
  const $ = id => document.getElementById(id);
  const FONTS = ['900 30px Inter', 'italic 900 30px Inter', '800 13px Inter', '700 14px Inter', '600 20px Inter', 'italic 600 15px Inter', '500 16px Inter', 'italic 500 16px Inter'];

  const jobId = new URLSearchParams(location.search).get('job');
  const key = 'job:' + jobId;
  let job = jobId ? (await chrome.storage.session.get(key))[key] : null;
  const saveJob = () => chrome.storage.session.set({ [key]: job }).catch(() => {});

  $('openSettings').onclick = $('errSettings').onclick = () => chrome.runtime.openOptionsPage();

  function progress(title, sub, cancellable) {
    $('progress').hidden = false; $('error').hidden = true;
    $('progressTitle').textContent = title; $('progressSub').textContent = sub || '';
    $('cancel').hidden = !cancellable;
  }
  function fail(msg) {
    $('progress').hidden = true; $('error').hidden = false; $('errorMsg').textContent = msg;
  }

  if (!job) { fail('This fight is no longer available (the browser was restarted or the tab was opened directly). Go back to the post and click the Thread Fight button in the toolbar again.'); $('retry').hidden = true; return; }
  const thread = job.thread;
  const site = { linkedin: 'LinkedIn', reddit: 'Reddit' }[thread.platform] || 'Facebook';
  const n = (thread.comments || []).length;
  $('source').textContent = `${site} thread · ${n ? n + ' visible comment' + (n === 1 ? '' : 's') : 'visible page text'} · captured ${new Date(thread.capturedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  $('source').title = thread.url;

  await Promise.all(FONTS.map(f => document.fonts.load(f))).catch(() => {});

  // ------------------------------------------------------------ player
  const canvas = $('screen'), ctx = canvas.getContext('2d');
  const player = {
    S: null, pcm: null, buf: null, ac: null, gain: null, src: null, t: 0, playing: false, startAt: 0, muted: false,
    load(script) {
      this.pause(); this.S = TF.build(script); this.pcm = TFSfx.mix(this.S.ev, this.S.duration); this.buf = null; this.t = 0;
      $('bigPlay').hidden = false;
    },
    ensureAudio() {
      if (!this.ac) { this.ac = new AudioContext({ sampleRate: TFSfx.SR }); this.gain = this.ac.createGain(); this.gain.connect(this.ac.destination); this.gain.gain.value = this.muted ? 0 : 1; }
      if (!this.buf) { this.buf = this.ac.createBuffer(1, this.pcm.length, TFSfx.SR); this.buf.copyToChannel(this.pcm, 0); }
    },
    play() {
      this.ensureAudio(); this.ac.resume();
      if (this.t >= this.S.duration - 0.05) this.t = 0;
      this.src = this.ac.createBufferSource(); this.src.buffer = this.buf; this.src.connect(this.gain);
      this.src.start(0, this.t); this.startAt = this.ac.currentTime - this.t; this.playing = true;
      $('bigPlay').hidden = true; $('play').textContent = 'Pause';
    },
    pause() {
      if (this.playing) this.t = this.now();
      if (this.src) { try { this.src.stop(); } catch (e) { /* already stopped */ } this.src.disconnect(); this.src = null; }
      this.playing = false; $('play').textContent = 'Play';
    },
    now() { return this.playing ? Math.min(this.S.duration, this.ac.currentTime - this.startAt) : this.t; },
    seek(t) { const was = this.playing; this.pause(); this.t = t; if (was) this.play(); },
  };
  const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  (function loop() {
    if (player.S) {
      let t = player.now();
      if (player.playing && t >= player.S.duration) { player.pause(); player.t = t = player.S.duration; }
      TF.render(ctx, player.S, t);
      if (document.activeElement !== $('seek')) $('seek').value = Math.round(t / player.S.duration * 1000);
      $('time').textContent = `${fmtT(t)} / ${fmtT(player.S.duration)}`;
    }
    requestAnimationFrame(loop);
  })();
  $('bigPlay').onclick = () => player.play();
  $('play').onclick = () => (player.playing ? player.pause() : player.play());
  $('seek').oninput = () => player.S && player.seek($('seek').value / 1000 * player.S.duration);
  $('mute').onclick = () => {
    player.muted = !player.muted; if (player.gain) player.gain.gain.value = player.muted ? 0 : 1;
    $('mute').textContent = player.muted ? 'Sound off' : 'Sound on';
  };

  // ------------------------------------------------------------ scorecard
  const KIND = { claim: 'claim', evidence: 'evidence', rebuttal: 'rebuttal', trap: 'contradiction exposed', bait: 'leading question', fallacy: 'fallacy', ad_hominem: 'personal attack', gish_gallop: 'gish gallop', concession: 'concession', exit: 'exit' };
  function showScript(script) {
    $('progress').hidden = true; $('error').hidden = true; $('playerWrap').hidden = false; $('details').hidden = false;
    player.load(script);
    const ol = $('beats'); ol.textContent = '';
    for (const b of script.beats) {
      const li = document.createElement('li');
      const tag = document.createElement('div'); tag.className = 'tag ' + b.actor;
      tag.textContent = `${b.actor} · ${KIND[b.kind] || b.kind}${b.fallacy_type ? ' (' + b.fallacy_type.replace(/_/g, ' ') + ')' : ''}${b.outcome !== 'none' ? ' · ' + b.outcome : ''} · strength ${b.strength}`;
      const pt = document.createElement('div'); pt.className = 'pt'; pt.textContent = b.point;
      const rl = document.createElement('div'); rl.className = 'rl'; rl.textContent = b.ruling + (b.source_comment_ids.length ? `  [${b.source_comment_ids.join(', ')}]` : '');
      li.append(tag, pt, rl); ol.appendChild(li);
    }
    const v = player.S.verdict;
    $('verdictLine').textContent = (v.winner === 'draw' ? 'Draw' : `${v.winner === 'red' ? 'Red' : 'Blue'} wins by ${{ KO: 'knockout', decision: 'decision', forfeit: 'forfeit' }[v.method] || v.method}`) + (v.summary ? ` — ${v.summary}` : '');
    if (job.sent) {
      $('sentMeta').textContent = `${job.sent.people} participants, anonymized${job.sent.raw ? ' · sent as raw page text (structured capture found no comments)' : ''}${job.sent.truncated ? ' · truncated to the size limit' : ''} · referee: ${job.model || ''}`;
      $('sentText').textContent = job.sent.text;
    }
  }

  // ------------------------------------------------------------ referee
  let abort = null;
  async function runReferee() {
    const settings = await R.loadSettings();
    const cfg = R.activeConfig(settings);
    abort = new AbortController();
    $('cancel').onclick = () => abort.abort();
    const t0 = Date.now();
    progress(`Refereeing with ${cfg.label}`, `${cfg.model} · reading ${n ? n + ' visible' : 'the'} comments…`, true);
    const timer = setInterval(() => { $('progressSub').textContent = `${cfg.model} · ${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
    try {
      const r = await R.referee(cfg, thread, settings.maxChars, { signal: abort.signal, onRetry: e => { $('progressSub').textContent = `Invalid reply (${e.message}) — asking again…`; } });
      job.script = r.script; job.sent = { text: r.sent.text, raw: r.sent.raw, truncated: r.sent.truncated, people: r.sent.people }; job.model = `${cfg.label} · ${cfg.model}`;
      await saveJob();
      showScript(job.script);
    } catch (e) {
      fail(e.name === 'AbortError' ? 'Cancelled.' : (e.message || String(e)));
    } finally { clearInterval(timer); }
  }
  $('retry').onclick = runReferee;
  $('rereferee').onclick = () => { player.pause(); $('playerWrap').hidden = true; $('details').hidden = true; runReferee(); };

  // ------------------------------------------------------------ export + edit
  const slug = s => (s || 'fight').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'fight';
  function save(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  let exporting = null;
  $('download').onclick = async () => {
    if (exporting) { exporting.abort(); return; }
    exporting = new AbortController();
    const bar = $('exportBar'), fill = bar.querySelector('i');
    bar.hidden = false; fill.style.width = '0%';
    $('download').textContent = 'Cancel export';
    $('exportStatus').className = 'status'; $('exportStatus').textContent = 'Encoding…';
    const t0 = performance.now();
    try {
      const onProgress = p => { fill.style.width = (p * 100).toFixed(1) + '%'; $('exportStatus').textContent = `Encoding… ${Math.round(p * 100)}%`; };
      let out = await TFEncode.exportMp4(player.S, player.pcm, TFSfx.SR, { onProgress, signal: exporting.signal });
      if (!out) {
        $('exportStatus').textContent = 'This browser can’t encode MP4 here — recording WebM in real time (keep this tab visible)…';
        player.ensureAudio();
        out = await TFEncode.recordWebm(player.S, player.buf, { onProgress, signal: exporting.signal });
      }
      save(out.blob, `thread-fight-${slug(job.script.title)}.${out.ext}`);
      $('exportStatus').className = 'status ok';
      $('exportStatus').textContent = `Saved ${out.ext.toUpperCase()} (${(out.blob.size / 1048576).toFixed(1)} MB, ${((performance.now() - t0) / 1000).toFixed(0)}s${out.audio === 'opus' && out.ext === 'mp4' ? ', Opus audio' : ''}).`;
      window.__lastExport = { size: out.blob.size, ext: out.ext, audio: out.audio };
    } catch (e) {
      $('exportStatus').className = 'status err';
      $('exportStatus').textContent = e.name === 'AbortError' ? 'Export cancelled.' : 'Export failed: ' + (e.message || e);
    } finally {
      exporting = null; $('download').textContent = 'Download MP4'; setTimeout(() => { bar.hidden = true; }, 1500);
    }
  };
  $('downloadJson').onclick = () => save(new Blob([JSON.stringify(job.script, null, 2)], { type: 'application/json' }), `thread-fight-${slug(job.script.title)}.json`);
  $('edit').onclick = () => { $('scriptText').value = JSON.stringify(job.script, null, 2); $('editStatus').textContent = ''; $('editor').showModal(); };
  $('apply').onclick = e => {
    try {
      const r = R.normalize(JSON.parse($('scriptText').value));
      job.script = r.script; saveJob(); showScript(job.script);
    } catch (err) { e.preventDefault(); $('editStatus').textContent = err.message; }
  };

  // ------------------------------------------------------------ go
  if (job.script) showScript(job.script); else runReferee();
})();
