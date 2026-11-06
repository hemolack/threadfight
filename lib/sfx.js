/* Thread Fight — synthesized sound effects mixed from the choreography's events (port of sfx.py). */
(function (root) {
'use strict';
const SR = 48000;

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(7);
function noise(n) { const x = new Float32Array(n); for (let i = 0; i < n; i += 2) { const u = Math.max(rand(), 1e-9), v = rand(), r = Math.sqrt(-2 * Math.log(u)); x[i] = r * Math.cos(6.2832 * v); if (i + 1 < n) x[i + 1] = r * Math.sin(6.2832 * v); } return x; }
function onepole(x, a) { const y = new Float32Array(x.length); let acc = 0; for (let i = 0; i < x.length; i++) { acc += (typeof a === 'number' ? a : a[i]) * (x[i] - acc); y[i] = acc; } return y; }
const N = d => Math.floor(d * SR);

function whoosh(power) {
  const dur = 0.14 + 0.05 * power, n = N(dur), x = noise(n), sweep = new Float32Array(n);
  for (let i = 0; i < n; i++) sweep[i] = 0.04 + 0.28 * Math.pow(Math.sin(Math.PI * i / n), 1.5);
  const lo = onepole(x, sweep), lo2 = onepole(lo, 0.02), y = new Float32Array(n), g = 0.32 * (0.6 + 0.25 * power);
  for (let i = 0; i < n; i++) y[i] = g * Math.pow(Math.sin(Math.PI * i / n), 2) * (lo[i] - lo2[i]);
  return y;
}
function impact(power) {
  const dur = 0.22 + 0.06 * power, n = N(dur), nz = noise(n), body = onepole(nz, 0.25), hp = onepole(nz, 0.5), y = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = 55 + 75 * Math.exp(-t / 0.03); ph += 2 * Math.PI * f / SR;
    const thump = Math.sin(ph) * Math.exp(-t / (0.05 + 0.02 * power));
    const crack = (nz[i] - hp[i]) * Math.exp(-t / 0.006) * (0.25 + 0.2 * power);
    y[i] = (0.55 + 0.2 * power) * (0.9 * thump + 0.7 * body[i] * Math.exp(-t / 0.018) + crack);
  }
  return y;
}
function block() {
  const n = N(0.12), nz = noise(n), lp = onepole(nz, 0.3), y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; y[i] = 0.32 * (Math.sin(2 * Math.PI * 720 * t) + 0.6 * Math.sin(2 * Math.PI * 1530 * t)) * Math.exp(-t / 0.022) + 0.35 * (nz[i] - lp[i]) * Math.exp(-t / 0.004); }
  return y;
}
function whistle() {
  const d = 0.62, n = N(d), y = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 2900 + 110 * Math.sign(Math.sin(2 * Math.PI * 34 * t)); ph += 2 * Math.PI * f / SR;
    y[i] = 0.16 * Math.tanh(2.5 * Math.sin(ph)) * Math.min(1, t / 0.02) * Math.min(1, Math.max(0, (d - t) / 0.08)); }
  return y;
}
function bell() {
  const n = N(1.8), y = new Float32Array(n), P = [[1, 1, 1.1], [2, 0.45, 0.7], [2.76, 0.4, 0.45], [5.4, 0.22, 0.22], [8.9, 0.1, 0.1]];
  for (let i = 0; i < n; i++) { const t = i / SR; let v = 0; for (const [r, a, d] of P) v += a * Math.sin(2 * Math.PI * 830 * r * t) * Math.exp(-t / d); y[i] = 0.22 * v * Math.min(1, t / 0.002); }
  return y;
}
function thud() {
  const n = N(0.5), lp = onepole(noise(n), 0.08), y = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 42 + 40 * Math.exp(-t / 0.04); ph += 2 * Math.PI * f / SR; y[i] = 0.9 * Math.sin(ph) * Math.exp(-t / 0.12) + 1.2 * lp[i] * Math.exp(-t / 0.08); }
  return y;
}

function mix(events, duration) {
  const out = new Float32Array(N(duration + 2.5));
  const add = (sig, at, gain) => { const i0 = Math.floor(Math.max(0, at) * SR); for (let i = 0; i < sig.length && i0 + i < out.length; i++) out[i0 + i] += (gain || 1) * sig[i]; };
  for (const e of events) {
    const t = e.t || 0;
    if (e.type === 'whoosh') add(whoosh(e.power || 1), t);
    else if (e.type === 'hit') add(impact(e.power || 1), t);
    else if (e.type === 'block') add(block(), t);
    else if (e.type === 'miss') add(whoosh(2.5), t - 0.05, 0.8);
    else if (e.type === 'foul') add(whistle(), t);
    else if (e.type === 'thud') add(thud(), t);
    else if (e.type === 'bell') for (let k = 0; k < (e.n || 1); k++) add(bell(), t + k * 0.32);
  }
  let peak = 1e-6;
  for (let i = 0; i < out.length; i++) { out[i] = Math.tanh(out[i] * 1.1); peak = Math.max(peak, Math.abs(out[i])); }
  const g = 0.8 / peak, len = N(duration), res = new Float32Array(len);
  for (let i = 0; i < len; i++) res[i] = out[i] * g;
  return res;
}

root.TFSfx = { SR, mix };
})(typeof window !== 'undefined' ? window : globalThis);
