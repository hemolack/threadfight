/* Thread Fight engine — turns a fight script into a deterministic, frame-addressable animation.
 *
 *   const S = ThreadFight.build(script);   // choreography: keyframes, events, captions, health
 *   ThreadFight.render(ctx, S, t);         // draw the frame at time t (seconds)
 *
 * Fighters are 2D skeletons posed with two-bone IK. Every technique is a small keyframe program
 * built from generic martial-arts vocabulary (direct attacks, combinations, feints, trapping, stop-hits).
 */
(function (root) {
'use strict';

// ---------------------------------------------------------------- constants
// Branding shown on the closing card of every exported video.
const BRAND = { name: 'THREAD FIGHT', tagline: 'Turn any comment-section argument into a fight video', url: 'datavikings.com' };
const END_CARD_SECONDS = 2.6;
const W = 1280, H = 720, PPM = 215, GROUND = 545, HORIZON = 462;
const L = { thigh: 0.44, shin: 0.44, upper: 0.30, fore: 0.28, torso: 0.50, neck: 0.12, headR: 0.105, foot: 0.19 };
const ARM = L.upper + L.fore, LEG = L.thigh + L.shin;
const SH_OFF = 0.035, HIP_OFF = 0.03, HOME = 0.85;
const OUT = '#0c0a0e', OL = 0.026;
const TEAM = {
  red:  { name: 'RED',  main: '#d6403a', dark: '#8a2521', light: '#ffa294', ui: '#ff5d50' },
  blue: { name: 'BLUE', main: '#3279dc', dark: '#1d4a8e', light: '#a3cbff', ui: '#55a3ff' },
};
const KIND_LABEL = {
  claim: 'CLAIM', evidence: 'EVIDENCE', rebuttal: 'REBUTTAL', trap: 'CONTRADICTION EXPOSED', bait: 'LEADING QUESTION',
  fallacy: 'FALLACY', ad_hominem: 'PERSONAL ATTACK', gish_gallop: 'GISH GALLOP', concession: 'CONCESSION', exit: 'EXIT',
};
const OUTCOME_LABEL = { landed: 'LANDED', blocked: 'BLOCKED', countered: 'COUNTERED', missed: 'MISSED', foul: 'FOUL', none: '' };
const BASE_DMG = [0, 8, 13, 20];

const EASE = {
  linear: s => s,
  inOut: s => (s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2),
  out: s => 1 - Math.pow(1 - s, 3),
  in: s => s * s * s,
};

// ---------------------------------------------------------------- poses
// Local frame: x points toward the opponent, y up, origin on the ground at the fighter's base.
// Hands are relative to their shoulder; feet (ankles) are relative to the base.
const GUARD = { hip: [0, 0.80], lean: 0.14, head: 0.04, lH: [0.34, -0.05], rH: [0.14, 0.10],
  lF: [0.32, 0], lFa: 0, rF: [-0.32, 0.08], rFa: -0.5, bounce: 1, open: 0 };
function P(o) {
  const p = {};
  for (const k in GUARD) { const v = (o && o[k] !== undefined) ? o[k] : GUARD[k]; p[k] = Array.isArray(v) ? v.slice() : v; }
  return p;
}
const lerp = (a, b, s) => a + (b - a) * s;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function lerpPose(a, b, s) {
  const p = {};
  for (const k in a) { const x = a[k], y = b[k]; p[k] = Array.isArray(x) ? [lerp(x[0], y[0], s), lerp(x[1], y[1], s)] : lerp(x, y, s); }
  return p;
}

const RELAX = { hip: [0, 0.86], lean: 0.02, head: 0, lH: [0.04, -0.53], rH: [-0.02, -0.53], lF: [0.1, 0], rF: [-0.1, 0], rFa: 0, bounce: 0 };
const BOW = { hip: [-0.05, 0.84], lean: 0.6, head: 0.3, lH: [0.2, -0.2], rH: [0.18, -0.17], lF: [0.1, 0], rF: [-0.1, 0], rFa: 0, bounce: 0 };
const VICTORY = { hip: [0, 0.85], lean: 0.02, head: -0.08, lH: [0.22, -0.25], rH: [0.06, 0.52], lF: [0.2, 0], rF: [-0.2, 0], rFa: 0, bounce: 0 };
const KNEEL = { hip: [-0.05, 0.5], lean: 0.35, head: 0.35, lF: [0.32, 0], lFa: 0, rF: [-0.42, 0.06], rFa: -0.15, lH: [0.12, -0.42], rH: [0.05, -0.48], bounce: 0 };
const DUCK = { lean: 0.6, head: -0.25, hip: [-0.1, 0.58], lF: [0.36, 0], rF: [-0.38, 0.05], rFa: -0.3, lH: [0.24, 0.06], rH: [0.14, 0.12], bounce: 0 };
const LS = { lean: 0.28, hip: [0.07, 0.79], lF: [0.44, 0], rF: [-0.26, 0.08], rH: [0.12, 0.12], head: -0.06 };      // lead straight
const RC = { lean: 0.32, hip: [0.1, 0.78], lF: [0.38, 0], rF: [-0.22, 0.1], rFa: -0.85, lH: [0.16, 0.08], head: -0.06 }; // rear cross
const SK_CH = { lean: -0.05, hip: [0, 0.83], lF: [0.16, 0.48], lFa: 1.2, rF: [-0.08, 0], rFa: 0, lH: [0.24, 0.02], rH: [0.12, 0.1] };
const SK = { lean: -0.42, hip: [0.02, 0.86], lFa: 1.45, rF: [-0.1, 0], rFa: 0, lH: [0.14, -0.12], rH: [0.1, 0.1], head: 0.32 };
const LSK_CH = { lean: 0, hip: [0, 0.82], lF: [0.2, 0.32], lFa: 1.0, rF: [-0.1, 0], rFa: 0 };
const LSK = { lean: -0.3, hip: [0.03, 0.84], lFa: 1.3, rF: [-0.12, 0], rFa: 0, head: 0.2, lH: [0.2, 0], rH: [0.12, 0.08] };
const HK_CH = { lean: -0.15, hip: [0, 0.84], lF: [0.1, 0.62], lFa: 0.5, rF: [-0.06, 0], rFa: 0, lH: [0.22, 0.05], rH: [0.12, 0.12] };
const HK = { lean: -0.5, hip: [0.04, 0.86], lFa: 0.8, rF: [-0.08, 0], rFa: 0, lH: [0.1, -0.15], rH: [0.05, 0.12], head: 0.4 };
const FK_CH = { lF: [0.25, 0.45], lFa: 0.3, lean: -0.05, hip: [0, 0.83], rF: [-0.1, 0], rFa: 0 };
const FK = { lean: -0.2, hip: [0.05, 0.84], lFa: 0, rF: [-0.1, 0], rFa: 0, head: 0.1 };

// ---------------------------------------------------------------- skeleton
function ik(r, t, a, b, sg) {
  const dx = t[0] - r[0], dy = t[1] - r[1];
  const d = Math.hypot(dx, dy) || 1e-6, ux = dx / d, uy = dy / d;
  const dc = clamp(d, Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const A = Math.acos(clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1));
  const c = Math.cos(A), s = Math.sin(A) * sg;
  return [[r[0] + a * (ux * c - uy * s), r[1] + a * (ux * s + uy * c)], [r[0] + ux * dc, r[1] + uy * dc]];
}
function solve(pose, base, dir, time, noBounce) {
  const bo = (!noBounce && pose.bounce) ? pose.bounce * 0.016 * Math.sin(time * 2 * Math.PI * 1.7 + (dir > 0 ? 0 : 1.3)) : 0;
  const hip = [pose.hip[0], pose.hip[1] + bo];
  const sh = [hip[0] + L.torso * Math.sin(pose.lean), hip[1] + L.torso * Math.cos(pose.lean)];
  const ha = pose.lean + pose.head;
  const head = [sh[0] + (L.neck + L.headR) * Math.sin(ha), sh[1] + (L.neck + L.headR) * Math.cos(ha)];
  const lSh = [sh[0] + SH_OFF, sh[1]], rSh = [sh[0] - SH_OFF, sh[1]];
  const [lEl, lHd] = ik(lSh, [lSh[0] + pose.lH[0], lSh[1] + pose.lH[1]], L.upper, L.fore, -1);
  const [rEl, rHd] = ik(rSh, [rSh[0] + pose.rH[0], rSh[1] + pose.rH[1]], L.upper, L.fore, -1);
  const lHp = [hip[0] + HIP_OFF, hip[1]], rHp = [hip[0] - HIP_OFF, hip[1]];
  const [lKn, lAn] = ik(lHp, pose.lF, L.thigh, L.shin, 1);
  const [rKn, rAn] = ik(rHp, pose.rF, L.thigh, L.shin, 1);
  const lToe = [lAn[0] + L.foot * Math.cos(pose.lFa), lAn[1] + L.foot * Math.sin(pose.lFa)];
  const rToe = [rAn[0] + L.foot * Math.cos(pose.rFa), rAn[1] + L.foot * Math.sin(pose.rFa)];
  const loc = { hip, sh, head, lSh, rSh, lEl, lHd, rEl, rHd, lHp, rHp, lKn, lAn, rKn, rAn, lToe, rToe };
  const o = { dir, open: pose.open };
  for (const k in loc) o[k] = [base + dir * loc[k][0], loc[k][1]];
  return o;
}

// ---------------------------------------------------------------- keyframe tracks
class Track {
  constructor(id, dir, base) {
    this.id = id; this.dir = dir; this.home = base;
    this.k = [{ t: 0, base, pose: P(RELAX), dirv: dir, ease: 'linear' }];
  }
  get last() { return this.k[this.k.length - 1]; }
  get t() { return this.last.t; }
  get base() { return this.last.base; }
  get pose() { return this.last.pose; }
  to(dt, pose, o) {
    o = o || {}; const l = this.last;
    this.k.push({ t: l.t + Math.max(dt, 0.001), base: o.base !== undefined ? o.base : l.base, pose: pose || l.pose,
      dirv: o.dirv !== undefined ? o.dirv : l.dirv, ease: o.ease || 'inOut' });
    return this;
  }
  hold(dt) { return this.to(dt, this.last.pose, { ease: 'linear' }); }
  until(t) { if (t > this.t + 1e-6) this.hold(t - this.t); return this; }
  cut(t) { // interrupt: drop everything after t
    if (t >= this.t - 1e-6) return this.until(t);
    const s = this.at(t);
    this.k = this.k.filter(k => k.t < t - 1e-6);
    this.k.push({ t, base: s.base, pose: s.pose, dirv: s.dir, ease: 'linear' });
    return this;
  }
  at(t) {
    const k = this.k;
    if (t <= k[0].t) return { base: k[0].base, pose: k[0].pose, dir: k[0].dirv };
    if (t >= this.t) { const l = this.last; return { base: l.base, pose: l.pose, dir: l.dirv }; }
    let lo = 0, hi = k.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (k[m].t <= t) lo = m; else hi = m; }
    const a = k[lo], b = k[hi], s = EASE[b.ease]((t - a.t) / (b.t - a.t));
    return { base: lerp(a.base, b.base, s), pose: lerpPose(a.pose, b.pose, s), dir: a.dirv };
  }
}

function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h; }

// ---------------------------------------------------------------- choreography
function build(script) {
  const R = new Track('red', 1, -HOME), B = new Track('blue', -1, HOME);
  const F = { red: R, blue: B };
  const other = id => (id === 'red' ? 'blue' : 'red');
  const ev = [], caps = [], hp = [];
  const rand = rng(hashStr(script.title || 'thread fight'));
  let T = 0;
  const sync = () => { T = Math.max(R.t, B.t); R.until(T); B.until(T); };

  const pts = (tr, pose) => solve(pose || tr.pose, tr.base, tr.dir, 0, true);
  function limbRoot(pose, limb) {
    if (limb[1] === 'H') {
      const sh = [pose.hip[0] + L.torso * Math.sin(pose.lean), pose.hip[1] + L.torso * Math.cos(pose.lean)];
      return [sh[0] + (limb === 'lH' ? SH_OFF : -SH_OFF), sh[1]];
    }
    return [pose.hip[0] + (limb === 'lF' ? HIP_OFF : -HIP_OFF), pose.hip[1]];
  }
  function aim(tr, pose, limb, target, base) {
    const r = limbRoot(pose, limb), lx = (target[0] - base) * tr.dir, ly = target[1];
    pose[limb] = limb[1] === 'H' ? [lx - r[0], ly - r[1]] : [lx, ly];
    return pose;
  }
  function reachBase(tr, pose, limb, target, frac) {
    const r = limbRoot(pose, limb), R_ = (limb[1] === 'H' ? ARM : LEG) * (frac || 0.95);
    const dy = target[1] - r[1], hx = Math.sqrt(Math.max(0.0025, R_ * R_ - dy * dy));
    return target[0] - tr.dir * (r[0] + hx);
  }
  function stepTo(tr, nb, dur) {
    const d = (nb - tr.base) * tr.dir, h = dur / 2;
    if (Math.abs(d) < 0.02) { tr.to(dur, P({}), { ease: 'inOut' }); return; }
    if (d > 0) tr.to(h, P({ lF: [0.32 + d, 0], hip: [d * 0.45, 0.79], bounce: 0.3 }), { ease: 'inOut' });
    else tr.to(h, P({ rF: [-0.32 + d, 0.08], hip: [d * 0.45, 0.79], bounce: 0.3 }), { ease: 'inOut' });
    tr.to(h, P({}), { base: nb, ease: 'inOut' });
  }
  function stepsTo(tr, nb, dur) {
    let guard = 0;
    while (Math.abs(nb - tr.base) > 0.02 && guard++ < 8) {
      const d = nb - tr.base, s = Math.sign(d) * Math.min(Math.abs(d), 0.4);
      stepTo(tr, tr.base + s, dur || 0.3);
    }
  }
  function footwork(tr, dur) {
    const n = 1 + Math.floor(rand() * 2), seg = dur / n;
    for (let i = 0; i < n; i++) {
      const nb = tr.home + tr.dir * (rand() * 0.24 - 0.12), st = Math.min(0.3, seg * 0.6);
      stepsTo(tr, nb, st); tr.hold(Math.max(0.05, seg - st));
    }
  }
  function keepGap(A, D, base, mg) {
    const gap = (D.base - base) * A.dir; mg = mg || 0.68;
    return gap < mg ? D.base - A.dir * mg : base;
  }
  function strike(A, limb, target, o) {
    o = o || {};
    const pose = P(Object.assign({ bounce: 0 }, o.pose || {}));
    let base = o.base !== undefined ? o.base : reachBase(A, pose, limb, target, o.frac);
    if (o.opp) base = keepGap(A, o.opp, base, o.minGap);
    if (o.base === undefined && o.approach !== false) {
      const ml = o.maxLunge !== undefined ? o.maxLunge : 0.38;
      if ((base - A.base) * A.dir > ml) stepsTo(A, base - A.dir * ml, 0.28);
    }
    if (o.chamber) A.to(o.chamberDt || 0.1, P(Object.assign({ bounce: 0 }, o.chamber)), { base: lerp(A.base, base, 0.35), ease: 'inOut' });
    ev.push({ t: A.t, type: 'whoosh', power: o.power || 1 });
    aim(A, pose, limb, target, base);
    A.to(o.dt || 0.12, pose, { base, ease: o.ease || 'out' });
    return A.t;
  }
  function retract(A, dt, back) { A.to(dt || 0.24, P({}), { base: A.base - A.dir * (back !== undefined ? back : 0.1), ease: 'inOut' }); }
  function label(t, text, p, color) { ev.push({ t, type: 'label', text, x: p[0], y: p[1], color: color || '#fff' }); }

  function knockdown(D) {
    const d = D.dir;
    D.to(0.12, P({ lean: -0.5, head: -0.5, hip: [-0.1, 0.75], lH: [0.15, 0.25], rH: [0, 0.2], bounce: 0, rF: [-0.4, 0.06] }), { base: D.base - d * 0.15, ease: 'out' });
    D.to(0.32, P({ lean: -1.0, head: -0.2, hip: [-0.25, 0.42], lH: [-0.05, 0.3], rH: [-0.15, 0.2], lF: [0.4, 0.1], lFa: 0.5, rF: [0.15, 0.05], rFa: 0.3, bounce: 0 }), { base: D.base - d * 0.2, ease: 'in' });
    D.to(0.22, P({ lean: -1.5, head: -0.05, hip: [-0.35, 0.1], lH: [-0.2, 0.1], rH: [-0.1, -0.05], lF: [0.45, 0.05], lFa: 0.4, rF: [0.3, 0.25], rFa: 0.6, bounce: 0 }), { base: D.base - d * 0.1, ease: 'in' });
    ev.push({ t: D.t, type: 'thud', x: D.base - d * 0.6, y: 0, power: 3 });
    D.knocked = true;
  }
  function react(D, ti, power, zone, hs, ko) {
    D.cut(ti); if (hs) D.hold(hs);
    if (ko) { knockdown(D); return; }
    const d = D.dir;
    if (zone === 'head') {
      D.to(0.08, P({ lean: -0.18 - 0.07 * power, head: -0.5, hip: [-0.06, 0.81], lH: [0.18, 0.22], rH: [0.02, 0.16], bounce: 0 }), { base: D.base - d * 0.05 * power, ease: 'out' });
      D.to(0.28, P({ lean: -0.05, head: -0.15, hip: [-0.03, 0.8], lH: [0.26, 0.05], bounce: 0, rF: [-0.36, 0.08] }), { base: D.base - d * (0.08 + 0.06 * power), ease: 'out' });
      D.to(0.3, P({}), { ease: 'inOut' });
    } else if (zone === 'body') {
      D.to(0.08, P({ lean: 0.6, head: 0.3, hip: [-0.12, 0.72], lH: [0.12, -0.28], rH: [0.1, -0.22], bounce: 0 }), { base: D.base - d * 0.1 * power, ease: 'out' });
      D.to(0.3, P({ lean: 0.4, head: 0.2, hip: [-0.06, 0.75], lH: [0.18, -0.18], bounce: 0 }), { base: D.base - d * (0.1 + 0.08 * power), ease: 'out' });
      D.to(0.35, P({}), { ease: 'inOut' });
    } else if (zone === 'leg') {
      D.to(0.08, P({ lF: [0.16, 0], lean: 0.3, hip: [-0.04, 0.7], head: 0.15, lH: [0.3, -0.12], bounce: 0 }), { base: D.base - d * 0.03, ease: 'out' });
      D.to(0.25, P({ lF: [0.2, 0], lean: 0.2, hip: [-0.03, 0.74], bounce: 0 }), { ease: 'out' });
      D.to(0.3, P({}), { ease: 'inOut' });
    } else { // snap: quick head snap inside a combination
      D.to(0.06, P({ lean: 0.02, head: -0.4, hip: [-0.03, 0.8], bounce: 0 }), { ease: 'out' });
      D.to(0.14, P({ bounce: 0 }), { ease: 'inOut' });
    }
  }
  function land(A, D, ti, pt, power, dmg, zone, ko) {
    ev.push({ t: ti, type: 'hit', x: pt[0], y: pt[1], power, victim: D.id });
    if (dmg) hp.push({ t: ti, who: D.id, d: -dmg });
    const hs = ko ? 0.18 : power >= 3 ? 0.12 : power >= 2 ? 0.06 : 0;
    if (hs) A.until(ti).hold(hs);
    react(D, ti, power, zone, hs, ko);
  }
  function parry(D, ti, useLead) {
    const pak = useLead ? P({ lH: [0.28, 0.1], lean: 0.1, bounce: 0 }) : P({ rH: [0.3, 0.04], lean: 0.1, bounce: 0 });
    const press = useLead ? P({ lH: [0.24, -0.14], bounce: 0 }) : P({ rH: [0.22, -0.18], bounce: 0 });
    D.cut(ti - 0.08).to(0.08, pak, { ease: 'out' }).to(0.1, press, { ease: 'out' }).to(0.2, P({}), { ease: 'inOut' });
    return pak;
  }
  function slapPoint(D, useLead) {
    const pak = useLead ? P({ lH: [0.28, 0.1], lean: 0.1, bounce: 0 }) : P({ rH: [0.3, 0.04], lean: 0.1, bounce: 0 });
    const p = pts(D, pak)[useLead ? 'lHd' : 'rHd'];
    return [p[0] + D.dir * 0.06, p[1]];
  }

  // ---- techniques. Each returns { name, sub, exec } (exec = who performs the featured technique).
  const TECH = {
    sda(A, D, b, ko) { // direct attack
      const s = b.strength, dmg = BASE_DMG[s], head = pts(D).head;
      if (s === 3) {
        const body = (() => { const p = pts(D); return [(p.hip[0] + p.sh[0]) / 2, (p.hip[1] + p.sh[1]) / 2 + 0.05]; })();
        const ti = strike(A, 'lF', body, { pose: SK, chamber: SK_CH, chamberDt: 0.13, dt: 0.12, power: 3, opp: D, minGap: 0.75 });
        land(A, D, ti, body, 3, dmg, 'body', ko);
        A.to(0.12, P(Object.assign({ bounce: 0 }, SK_CH)), { base: A.base - A.dir * 0.05 }); retract(A, 0.22);
        return { name: 'LEAD SIDE KICK', sub: 'Direct attack' };
      }
      const open = s === 1 ? 1 : 0;
      const ti = strike(A, 'lH', head, { pose: Object.assign({ open }, LS), dt: s === 1 ? 0.1 : 0.12, power: s, opp: D });
      land(A, D, ti, head, s, dmg, 'head', ko); A.hold(0.05); retract(A);
      return { name: s === 1 ? 'FINGER JAB' : 'STRAIGHT LEAD', sub: 'Direct attack' };
    },
    abc(A, D, b, ko) { // combination
      const s = b.strength, total = BASE_DMG[s];
      const seq = ['jab', 'cross']; if (s >= 2) seq.push('hook'); if (s >= 3) seq.push('side');
      const share = seq.map((x, i) => (i === seq.length - 1 ? 0.45 : 0.55 / (seq.length - 1)));
      const names = { jab: 'JAB', cross: 'CROSS', hook: 'HOOK', side: 'SIDE KICK' };
      seq.forEach((m, i) => {
        const last = i === seq.length - 1, dmg = Math.round(total * share[i]);
        const head = pts(D, P({})).head;
        let ti;
        if (m === 'jab') ti = strike(A, 'lH', head, { pose: LS, dt: 0.1, opp: D });
        else if (m === 'cross') ti = strike(A, 'rH', head, { pose: RC, dt: 0.11, opp: D, maxLunge: 0.25 });
        else if (m === 'hook') ti = strike(A, 'lH', head, { pose: Object.assign({}, LS, { lean: 0.22 }), chamber: { lH: [0.06, -0.12], lean: 0.18, hip: [0.04, 0.8] }, chamberDt: 0.07, dt: 0.09, frac: 0.85, opp: D, power: 2, maxLunge: 0.25 });
        else {
          const p = pts(D, P({})), body = [(p.hip[0] + p.sh[0]) / 2, (p.hip[1] + p.sh[1]) / 2 + 0.05];
          ti = strike(A, 'lF', body, { pose: SK, chamber: SK_CH, chamberDt: 0.12, dt: 0.12, power: 3, opp: D, minGap: 0.75 });
          land(A, D, ti, body, 3, dmg, 'body', ko);
          A.to(0.12, P(Object.assign({ bounce: 0 }, SK_CH)), { base: A.base - A.dir * 0.05 });
          return;
        }
        land(A, D, ti, head, last ? Math.max(2, s) : 1, dmg, last ? 'head' : 'snap', last && ko);
        A.to(0.09, P(Object.assign({ bounce: 0 }, LS, { lH: [0.3, 0], rH: [0.14, 0.1] })), { ease: 'inOut' });
      });
      retract(A, 0.26);
      return { name: seq.map(m => names[m]).join(' · '), sub: 'Combination' };
    },
    pia(A, D, b, ko) { // feint high, strike low
      const s = b.strength, dmg = BASE_DMG[s];
      const fake = keepGap(A, D, A.base + A.dir * 0.22, 1.0);
      stepsTo(A, fake, 0.26);
      A.to(0.11, P({ lH: [0.46, 0.06], lean: 0.22, hip: [0.04, 0.8], lF: [0.38, 0], bounce: 0 }), { ease: 'out' });
      D.cut(A.t - 0.04).to(0.1, P({ lH: [0.22, 0.16], rH: [0.12, 0.16], head: -0.12, lean: 0.1, bounce: 0 }), { ease: 'out' });
      label(A.t, 'FEINT', pts(A, A.pose).lHd, '#e8ddd0');
      A.hold(0.07);
      const knee = pts(D, D.pose).lKn;
      const ti = strike(A, 'lF', knee, { pose: LSK, chamber: LSK_CH, chamberDt: 0.09, dt: 0.1, power: 2, opp: D, minGap: 0.7 });
      const fin = s < 3;
      land(A, D, ti, knee, Math.max(2, s), fin ? dmg : Math.round(dmg * 0.5), 'leg', fin && ko);
      A.to(0.12, P(Object.assign({ bounce: 0 }, LSK_CH)), { base: A.base - A.dir * 0.03 });
      if (!fin) {
        const head = pts(D, P({ lF: [0.2, 0], lean: 0.2, hip: [-0.03, 0.74] })).head;
        const t2 = strike(A, 'lH', head, { pose: LS, dt: 0.12, opp: D, maxLunge: 0.5 });
        land(A, D, t2, head, 3, Math.round(dmg * 0.5), 'head', ko);
      }
      retract(A, 0.26);
      return { name: fin ? 'FEINT → STOP-KICK' : 'FEINT → STOP-KICK → STRAIGHT', sub: 'Feint and strike' };
    },
    hia(A, D, b, ko) { // trap the lead arm, backfist
      const s = b.strength, dmg = BASE_DMG[s];
      const bf = P({ lean: 0.22, hip: [0.05, 0.79], lF: [0.42, 0], head: -0.05, bounce: 0 });
      const dPinned = P({ lH: [0.2, -0.34], lean: 0.18, head: 0.05, bounce: 0 });
      const head = pts(D, dPinned).head;
      const base = keepGap(A, D, reachBase(A, bf, 'lH', head, 0.9), 0.66);
      stepsTo(A, base, 0.28);
      const hand = pts(D, dPinned).lHd;
      const pin = aim(A, P({ lean: 0.2, hip: [0.04, 0.79], lF: [0.42, 0], lH: [0.08, 0.2], bounce: 0 }), 'rH', [hand[0] + D.dir * 0.03, hand[1] + 0.04], base);
      A.to(0.12, pin, { base, ease: 'out' });
      D.cut(A.t - 0.06).to(0.06, dPinned, { ease: 'out' });
      ev.push({ t: A.t, type: 'block', x: hand[0], y: hand[1] });
      label(A.t, 'PAK SAO', [hand[0], hand[1] - 0.12], '#e8ddd0');
      A.hold(0.05);
      const strikeP = aim(A, Object.assign(P({ lean: 0.24, hip: [0.05, 0.79], lF: [0.42, 0], bounce: 0 }), { rH: pin.rH }), 'lH', head, base);
      A.to(0.06, Object.assign(P({ lean: 0.24, hip: [0.05, 0.79], lF: [0.42, 0], bounce: 0 }), { rH: pin.rH, lH: [0.12, 0.34] }), { base, ease: 'out' });
      ev.push({ t: A.t, type: 'whoosh', power: 2 });
      A.to(0.08, strikeP, { base, ease: 'out' });
      const fin = s < 3;
      land(A, D, A.t, head, Math.max(2, s), fin ? dmg : Math.round(dmg * 0.5), 'head', fin && ko);
      if (!fin) {
        A.to(0.08, P(Object.assign({ bounce: 0 }, LS, { lH: [0.25, 0.05] })), { ease: 'inOut' });
        const h2 = pts(D, P({ lean: -0.05, head: -0.15, hip: [-0.03, 0.8] })).head;
        h2[0] -= D.dir * 0.06;
        const t2 = strike(A, 'lH', h2, { pose: LS, dt: 0.11, opp: D, maxLunge: 0.5 });
        land(A, D, t2, h2, 3, Math.round(dmg * 0.5), 'head', ko);
      }
      retract(A, 0.26);
      return { name: fin ? 'PAK SAO → BACKFIST' : 'PAK SAO → BACKFIST → STRAIGHT', sub: 'Trapping attack' };
    },
    abd(A, D, b, ko) { // show an opening, make them commit, counter
      const s = b.strength, dmg = BASE_DMG[s];
      A.to(0.3, P({ lH: [0.16, -0.36], rH: [0.12, 0.0], lean: 0.05, head: 0.12, bounce: 0.5 }), { ease: 'inOut' }).hold(0.25);
      label(A.t - 0.2, 'OPENING', pts(A, A.pose).hip, '#e8ddd0');
      const aHead = pts(A, A.pose).head;
      D.until(A.t - 0.05);
      const tiD = strike(D, 'lH', aHead, { pose: LS, dt: 0.14, maxLunge: 0.7, opp: A });
      const slip = P({ lean: -0.32, hip: [-0.12, 0.78], head: 0.1, lH: [0.22, -0.05], rH: [0.12, 0.1], bounce: 0, rF: [-0.4, 0.08] });
      A.cut(tiD - 0.09).to(0.09, slip, { ease: 'out' });
      ev.push({ t: tiD, type: 'miss', x: aHead[0], y: aHead[1] });
      D.hold(0.14);
      const dHead = pts(D, D.pose).head;
      const ti = strike(A, 'lH', dHead, { pose: Object.assign({}, LS, { lean: 0.24 }), chamber: { lH: [0.05, -0.1], lean: 0.05, hip: [-0.04, 0.79] }, chamberDt: 0.06, dt: 0.09, frac: 0.86, maxLunge: 0.45, opp: D, power: 2 });
      land(A, D, ti, dHead, Math.max(2, s), dmg, 'head', ko);
      retract(A, 0.26);
      return { name: 'OPENING → COUNTER HOOK', sub: 'Draw and counter' };
    },
    counter(A, D, b, ko) { // the actor's point is intercepted: stop-hit
      const s = b.strength, dmg = BASE_DMG[s];
      const nb = keepGap(A, D, A.base + A.dir * 0.32, 1.05);
      const tele = P({ rH: [-0.28, 0.14], lH: [0.28, 0.02], lean: 0.1, hip: [0.06, 0.8], lF: [0.46, 0], bounce: 0 });
      label(A.t + 0.1, 'WIND-UP', pts(A, A.pose).hip, '#e8ddd0');
      A.to(0.36, tele, { base: nb, ease: 'in' });
      const tEnd = A.t;
      const ap = solve(tele, nb, A.dir, 0, true);
      if (s >= 3) {
        const knee = ap.lKn;
        D.until(tEnd - 0.2);
        const base = keepGap(D, A, reachBase(D, P(LSK), 'lF', knee, 0.95), 0.7);
        D.to(0.09, P(Object.assign({ bounce: 0 }, LSK_CH)), { base: lerp(D.base, base, 0.4) });
        ev.push({ t: D.t, type: 'whoosh', power: 2 });
        D.to(0.11, aim(D, P(Object.assign({ bounce: 0 }, LSK)), 'lF', knee, base), { base, ease: 'out' });
        land(D, A, D.t, knee, 2, Math.round(dmg * 0.5), 'leg', false);
        D.to(0.12, P(Object.assign({ bounce: 0 }, LSK_CH)), { base: D.base - D.dir * 0.03 });
        const h2 = solve(P({ lF: [0.2, 0], lean: 0.2, hip: [-0.03, 0.74] }), A.at(D.t + 0.12).base, A.dir, 0, true).head;
        const t2 = strike(D, 'lH', h2, { pose: LS, dt: 0.12, opp: A, maxLunge: 0.6 });
        land(D, A, t2, h2, 3, Math.round(dmg * 0.5), 'head', ko);
        retract(D, 0.26);
        return { name: 'STOP-KICK → STRAIGHT', sub: 'Caught mid-attack', exec: D.id };
      }
      D.until(tEnd - 0.13);
      const ti = strike(D, 'lH', ap.head, { pose: LS, dt: 0.13, approach: false, opp: A });
      land(D, A, ti, ap.head, Math.max(2, s), dmg, 'head', ko);
      D.hold(0.05); retract(D);
      return { name: 'STOP-HIT', sub: 'Caught mid-attack', exec: D.id };
    },
    whiff(A, D, b) { // fallacy: swings at a target that isn't there
      const s = b.strength, head = pts(D, P({})).head;
      if (s >= 3) {
        const base = keepGap(A, D, reachBase(A, P(HK), 'lF', head, 0.98), 0.72);
        stepsTo(A, lerp(A.base, base, 0.5), 0.26);
        A.to(0.14, P(Object.assign({ bounce: 0 }, HK_CH)), { base: lerp(A.base, base, 0.4) });
        const tSwing = A.t;
        D.cut(tSwing - 0.04).to(0.1, P(DUCK), { ease: 'out' }).hold(0.35).to(0.3, P({}), { ease: 'inOut' });
        ev.push({ t: tSwing, type: 'whoosh', power: 3 });
        A.to(0.12, aim(A, P(Object.assign({ bounce: 0 }, HK)), 'lF', head, base), { base, ease: 'out' });
        ev.push({ t: A.t, type: 'miss', x: head[0], y: head[1] });
        A.to(0.12, P(Object.assign({ bounce: 0 }, HK, { lF: [0.45, 1.3], lFa: 1.2 })), { ease: 'out' });
        A.to(0.22, P({ lean: 0.55, hip: [0.2, 0.72], lF: [0.62, 0], rF: [-0.18, 0.12], lH: [0.35, 0.2], rH: [-0.1, 0.15], bounce: 0, head: -0.2 }), { base: keepGap(A, D, A.base + A.dir * 0.2, 0.72), ease: 'inOut' });
        A.to(0.35, P({}), { base: A.base - A.dir * 0.25, ease: 'inOut' });
        return { name: 'HOOK KICK — WHIFF', sub: 'Aimed at an argument nobody made' };
      }
      const base = keepGap(A, D, reachBase(A, P(RC), 'rH', head, 1.0), 0.7);
      stepsTo(A, lerp(A.base, base, 0.4), 0.26);
      A.to(0.3, P({ rH: [-0.3, 0.12], lean: -0.05, hip: [-0.02, 0.8], head: 0.08, lH: [0.3, 0.02], bounce: 0 }), { ease: 'inOut' });
      label(A.t - 0.15, 'WIND-UP', pts(A, A.pose).hip, '#e8ddd0');
      const tSwing = A.t;
      D.cut(tSwing - 0.02).to(0.1, P(DUCK), { ease: 'out' }).hold(0.32).to(0.3, P({}), { ease: 'inOut' });
      ev.push({ t: tSwing, type: 'whoosh', power: 2 });
      const mid = [head[0] - A.dir * 0.3, head[1] + 0.22];
      A.to(0.07, aim(A, P(Object.assign({ bounce: 0 }, RC, { lean: 0.15 })), 'rH', mid, lerp(A.base, base, 0.5)), { base: lerp(A.base, base, 0.5), ease: 'linear' });
      A.to(0.07, aim(A, P(Object.assign({ bounce: 0 }, RC)), 'rH', head, base), { base, ease: 'linear' });
      ev.push({ t: A.t, type: 'miss', x: head[0], y: head[1] });
      A.to(0.2, P({ rH: [0.25, -0.45], lH: [0.3, 0.15], lean: 0.7, hip: [0.26, 0.7], lF: [0.62, 0], rF: [-0.15, 0.12], rFa: -0.9, head: -0.25, bounce: 0 }), { base: keepGap(A, D, A.base + A.dir * 0.18, 0.7), ease: 'out' });
      A.to(0.38, P({}), { base: A.base - A.dir * 0.25, ease: 'inOut' });
      return { name: 'WILD HAYMAKER — WHIFF', sub: 'Swinging at a target that isn’t there' };
    },
    parried(A, D, b) { // point answered: pak sao
      const n = b.strength >= 2 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const lead = j === 0, tgt = slapPoint(D, !lead);
        const ti = strike(A, lead ? 'lH' : 'rH', tgt, { pose: lead ? LS : RC, dt: 0.12, frac: 0.95, opp: D, maxLunge: lead ? 0.38 : 0.25 });
        parry(D, ti, !lead);
        ev.push({ t: ti, type: 'block', x: tgt[0], y: tgt[1] });
        const limb = lead ? 'lH' : 'rH', dp = P(Object.assign({}, A.pose)); dp[limb] = [dp[limb][0] - 0.05, dp[limb][1] - 0.2];
        A.to(0.08, dp, { ease: 'out' }).to(0.14, P({ bounce: 0 }), { base: A.base - A.dir * 0.04 });
      }
      label(A.t - 0.25, 'PAK SAO', slapPoint(D, false), '#cfe6ff');
      retract(A, 0.24);
      return { name: 'PAK SAO PARRY', sub: 'Answered — no damage', exec: D.id };
    },
    blast(A, D, b, landed, ko) { // straight blast — a flood of punches
      const n = 6, dmg = landed ? BASE_DMG[Math.min(2, b.strength)] : 0;
      const start = keepGap(A, D, reachBase(A, P(LS), 'lH', pts(D, P({})).head, 0.9), 0.72);
      stepsTo(A, lerp(A.base, start, 0.6), 0.26);
      for (let i = 0; i < n; i++) {
        const hand = i % 2 ? 'rH' : 'lH', useLead = i % 2 === 1;
        const lands = landed && i >= n - 2;
        D.to(0.13, lands ? P({ lean: 0.02, head: -0.35, bounce: 0 }) : (useLead ? P({ lH: [0.28, 0.1], lean: 0.1, bounce: 0 }) : P({ rH: [0.3, 0.04], lean: 0.1, bounce: 0 })), { base: D.base - D.dir * 0.11, ease: 'out' });
        const tgt = lands ? pts(D, D.pose).head : slapPoint(D, useLead);
        const pose = P(Object.assign({ bounce: 0, lean: 0.22, hip: [0.05, 0.8], lF: [0.4, 0] }, hand === 'lH' ? { rH: [0.12, 0.02] } : { lH: [0.14, 0.02] }));
        const base = keepGap(A, D, reachBase(A, pose, hand, tgt, 0.92), 0.66);
        A.until(D.t - 0.13);
        ev.push({ t: A.t, type: 'whoosh', power: 1 });
        A.to(0.13, aim(A, pose, hand, tgt, base), { base, ease: 'out' });
        if (lands) { ev.push({ t: A.t, type: 'hit', x: tgt[0], y: tgt[1], power: 1, victim: D.id }); hp.push({ t: A.t, who: D.id, d: -Math.round(dmg / 2) }); }
        else ev.push({ t: A.t, type: 'block', x: tgt[0], y: tgt[1] });
      }
      if (ko) knockdown(D); else D.to(0.3, P({}));
      retract(A, 0.3);
      return { name: 'STRAIGHT BLAST', sub: landed ? 'Overwhelming volume' : 'Volume over substance — all parried', exec: A.id };
    },
    foul(A, D, b) { // ad hominem: low blow, shin-checked, penalty
      const s = b.strength;
      const check = P({ lF: [0.28, 0.4], lFa: 0.25, hip: [-0.02, 0.84], lean: 0.05, bounce: 0, rF: [-0.3, 0], rFa: -0.2 });
      const cp = pts(D, check), shin = [(cp.lKn[0] + cp.lAn[0]) / 2, (cp.lKn[1] + cp.lAn[1]) / 2];
      const ti = strike(A, 'lF', shin, { pose: FK, chamber: FK_CH, chamberDt: 0.11, dt: 0.1, frac: 0.95, opp: D, minGap: 0.72, power: 2 });
      D.cut(ti - 0.16).to(0.12, check, { ease: 'out' }).hold(0.3).to(0.25, P({}), { ease: 'inOut' });
      ev.push({ t: ti, type: 'block', x: shin[0], y: shin[1] });
      A.hold(0.06);
      A.to(0.25, P({ lF: [0.2, 0.25], lFa: 0.2, lean: 0.12, bounce: 0, head: 0.2 }), { base: A.base - A.dir * 0.2, ease: 'out' });
      A.to(0.3, P({}), { ease: 'inOut' });
      ev.push({ t: ti + 0.18, type: 'foul', penalty: [0, 5, 8, 12][s] });
      hp.push({ t: ti + 0.35, who: A.id, d: -[0, 5, 8, 12][s], penalty: true });
      A.hold(0.6); D.until(A.t);
      return { name: 'LOW BLOW', sub: 'Personal attack — penalty, not a point' };
    },
    concede(A, D, b) {
      A.to(0.45, P(KNEEL), { ease: 'inOut' });
      hp.push({ t: A.t, who: A.id, d: -6 });
      A.hold(0.9).to(0.45, P({}), { ease: 'inOut' });
      D.to(0.4, P({ lH: [0.26, -0.15], rH: [0.12, -0.04], lean: 0.05, bounce: 0.4 }), { ease: 'inOut' }).until(A.t - 0.3).to(0.3, P({}));
      return { name: 'TAKES A KNEE', sub: 'Concedes the point' };
    },
    exit(A, D, b) {
      const away = -A.dir;
      A.to(0.35, P(RELAX), { ease: 'inOut' });
      A.to(0.05, P(RELAX), { dirv: away });
      for (let i = 0; i < 8; i++) {
        const st = i % 2 ? { lF: [0.2, 0], rF: [-0.18, 0.04] } : { lF: [-0.18, 0.04], rF: [0.2, 0] };
        A.to(0.3, P(Object.assign({}, RELAX, st, { hip: [0, 0.84] })), { base: A.base + away * 0.38, ease: 'linear' });
      }
      D.to(0.5, P({ lH: [0.26, -0.15], rH: [0.12, -0.04], lean: 0.05, bounce: 0.4 }));
      A.gone = true;
      return { name: 'WALKS OFF', sub: 'Leaves the thread — forfeit' };
    },
  };

  function runTech(b, ko) {
    const A = F[b.actor], D = F[other(b.actor)], o = b.outcome, k = b.kind;
    if (k === 'exit') return TECH.exit(A, D, b);
    if (k === 'concession') return TECH.concede(A, D, b);
    if (o === 'foul' || k === 'ad_hominem') return TECH.foul(A, D, b);
    if (o === 'countered') return TECH.counter(A, D, b, ko);
    if (o === 'missed') return TECH.whiff(A, D, b);
    if (k === 'gish_gallop') return TECH.blast(A, D, b, o === 'landed', ko);
    if (o === 'blocked') return TECH.parried(A, D, b);
    if (k === 'evidence') return TECH.abc(A, D, b, ko);
    if (k === 'rebuttal') return TECH.pia(A, D, b, ko);
    if (k === 'trap') return TECH.hia(A, D, b, ko);
    if (k === 'bait') return TECH.abd(A, D, b, ko);
    return TECH.sda(A, D, b, ko);
  }
  const damages = (b, who) => (b.outcome === 'landed' && b.actor !== who) || (b.outcome === 'countered' && b.actor === who);

  // ---- intro: bow, then guard
  const beats = script.beats || [];
  const verdict = Object.assign({ winner: 'draw', method: 'decision', summary: '' }, script.verdict || {});
  const loser = verdict.winner === 'draw' ? null : other(verdict.winner);
  let koIdx = -1;
  if (verdict.method === 'KO' && loser && beats.length && damages(beats[beats.length - 1], loser)) koIdx = beats.length - 1;
  const method = verdict.method === 'KO' && koIdx < 0 ? 'decision' : verdict.method;

  for (const tr of [R, B]) { tr.hold(0.7).to(0.5, P(BOW)).hold(0.45).to(0.4, P(RELAX)).hold(0.2).to(0.4, P({})); }
  sync();
  ev.push({ t: T - 0.2, type: 'bell', n: 1 });
  const tFight = T - 0.2;
  R.hold(0.5); B.hold(0.5); sync();

  // ---- beats
  let ended = null;
  beats.forEach((b, i) => {
    if (ended) return;
    sync();
    const t0 = T;
    footwork(R, 1.35); footwork(B, 1.35); sync();
    const tA = T;
    const ko = i === koIdx;
    const res = runTech(b, ko) || {};
    sync();
    if (ko) ended = 'ko';
    else if (b.kind === 'exit') ended = 'forfeit';
    else { stepsTo(R, R.home, 0.32); stepsTo(B, B.home, 0.32); sync(); R.hold(0.4); B.hold(0.4); sync(); }
    caps.push({ i, t0, tA, t1: T + (ended ? 0.6 : 0), actor: b.actor, exec: res.exec || b.actor, name: res.name || '', sub: res.sub || '',
      chip: [KIND_LABEL[b.kind] || b.kind.toUpperCase(), b.kind === 'fallacy' && b.fallacy_type ? b.fallacy_type.replace(/_/g, ' ').toUpperCase() : '', OUTCOME_LABEL[b.outcome] || ''].filter(Boolean),
      point: b.point || '', ruling: b.ruling || '' });
  });

  // ---- outro
  sync();
  const tO = T;
  const win = verdict.winner === 'draw' ? null : F[verdict.winner];
  if (ended === 'ko' || ended === 'forfeit') {
    if (win) { win.to(0.5, P({})).hold(0.3).to(0.5, P(VICTORY)); }
  } else {
    stepsTo(R, R.home, 0.32); stepsTo(B, B.home, 0.32); sync();
    for (const tr of [R, B]) tr.to(0.45, P(RELAX)).to(0.5, P(BOW)).hold(0.4).to(0.45, P(RELAX));
    sync();
    if (win) win.to(0.5, P(VICTORY));
  }
  sync();
  ev.push({ t: tO + 0.25, type: 'bell', n: 3 });
  const tVerdict = Math.max(tO + 0.9, T - 0.4);
  const tEnd = tVerdict + 5.2;
  const duration = tEnd + END_CARD_SECONDS;
  R.until(duration); B.until(duration);

  // ---- scale damage so health bars tell the story (KO = exactly empty)
  for (const who of ['red', 'blue']) {
    const total = hp.filter(h => h.who === who).reduce((s, h) => s - h.d, 0);
    if (!total) continue;
    let scale = Math.min(1, 82 / total);
    if (ended === 'ko' && who === loser) scale = 100 / total;
    hp.filter(h => h.who === who).forEach(h => { h.d = h.d * scale; });
  }
  ev.sort((a, b) => a.t - b.t);
  hp.sort((a, b) => a.t - b.t);
  // rapid hits (combinations) show one combined damage number
  for (const who of ['red', 'blue']) {
    const list = hp.filter(h => h.who === who && !h.penalty && h.d < 0);
    let acc = 0;
    list.forEach((h, i) => { acc += h.d; const n = list[i + 1]; if (n && n.t - h.t <= 0.6) h.show = false; else { h.show = true; h.sum = acc; acc = 0; } });
  }

  return { script, R, B, ev, caps, hp, duration, tFight, tVerdict, tEnd, verdict: Object.assign({}, verdict, { method: ended === 'forfeit' ? 'forfeit' : method }), total: beats.length };
}

// ---------------------------------------------------------------- rendering helpers
function hpAt(S, who, t, lag) {
  let v = 100;
  for (const h of S.hp) if (h.who === who) v += h.d * clamp((t - h.t - (lag || 0)) / (lag ? 0.45 : 0.25), 0, 1);
  return clamp(v, 0, 100);
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text; while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
function spaced(ctx, px) { try { ctx.letterSpacing = px + 'px'; } catch (e) { /* older canvas */ } }

// ---------------------------------------------------------------- background
function drawBG(ctx, camX, sx, sy) {
  ctx.save(); ctx.translate(sx * 0.4, sy * 0.4);
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
  g.addColorStop(0, '#170f13'); g.addColorStop(1, '#3b2219');
  ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, HORIZON + 20);
  const wx = -camX * PPM * 0.35;
  const glow = ctx.createRadialGradient(W / 2 + wx * 0.5, 300, 40, W / 2 + wx * 0.5, 300, 700);
  glow.addColorStop(0, 'rgba(255,168,92,0.42)'); glow.addColorStop(1, 'rgba(255,168,92,0)');
  ctx.fillStyle = glow; ctx.fillRect(-20, -20, W + 40, HORIZON + 20);
  // shoji panels
  for (let i = -1; i < 6; i++) {
    const x0 = i * 300 - 91 + wx, y0 = 60, w = 262, h = 390;
    if (x0 > W || x0 + w < 0) continue;
    if (i === 2) continue; // gap for the banner
    ctx.fillStyle = 'rgba(245,222,180,0.14)'; ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = '#26160f'; ctx.lineWidth = 10; ctx.strokeRect(x0, y0, w, h);
    ctx.lineWidth = 3.5;
    for (let c = 1; c < 3; c++) { ctx.beginPath(); ctx.moveTo(x0 + w * c / 3, y0); ctx.lineTo(x0 + w * c / 3, y0 + h); ctx.stroke(); }
    for (let r = 1; r < 5; r++) { ctx.beginPath(); ctx.moveTo(x0, y0 + h * r / 5); ctx.lineTo(x0 + w, y0 + h * r / 5); ctx.stroke(); }
  }
  // banner
  const bx = W / 2 + wx;
  ctx.fillStyle = '#26160f'; ctx.fillRect(bx - 52, 54, 104, 10);
  ctx.fillStyle = '#7d1915'; ctx.fillRect(bx - 40, 64, 80, 290);
  ctx.beginPath(); ctx.moveTo(bx - 40, 354); ctx.lineTo(bx, 380); ctx.lineTo(bx + 40, 354); ctx.fill();
  ctx.fillStyle = '#f0dcb8'; ctx.font = '52px IPAGothic, "Hiragino Sans", "Yu Gothic", "Microsoft YaHei", "Noto Sans CJK JP", "PingFang SC", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ['武', '道'].forEach((ch, i) => ctx.fillText(ch, bx, 160 + i * 100));
  ctx.textBaseline = 'alphabetic';
  // wooden dummy silhouette
  const dx = 120 - camX * PPM * 0.55;
  ctx.fillStyle = '#1d120d';
  ctx.fillRect(dx - 18, 220, 36, HORIZON - 220 + 20);
  ctx.fillRect(dx - 60, 270, 120, 10); ctx.fillRect(dx - 52, 300, 104, 9); ctx.fillRect(dx + 10, 360, 70, 10);
  ctx.beginPath(); ctx.arc(dx, 222, 18, Math.PI, 0); ctx.fill();
  // floor
  const fg = ctx.createLinearGradient(0, HORIZON, 0, H);
  fg.addColorStop(0, '#5c3a23'); fg.addColorStop(1, '#24160d');
  ctx.fillStyle = fg; ctx.fillRect(-20, HORIZON, W + 40, H - HORIZON + 20);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 2;
  for (let k = -24; k <= 24; k++) {
    const xf = W / 2 + k * 64 - camX * PPM * 0.8, xn = W / 2 + k * 150 - camX * PPM * 1.6;
    ctx.beginPath(); ctx.moveTo(xf, HORIZON); ctx.lineTo(xn, H + 20); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-20, HORIZON - 4, W + 40, 6);
  const sheen = ctx.createRadialGradient(W / 2, GROUND, 20, W / 2, GROUND, 520);
  sheen.addColorStop(0, 'rgba(255,190,120,0.16)'); sheen.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = sheen; ctx.fillRect(-20, HORIZON, W + 40, H - HORIZON + 20);
  ctx.restore();
}

// ---------------------------------------------------------------- fighter
function chain(ctx, p, widths, color) {
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? color : OUT;
    for (let i = 0; i < p.length - 1; i++) {
      ctx.lineWidth = widths[i] + (pass ? 0 : OL);
      ctx.beginPath(); ctx.moveTo(p[i][0], p[i][1]); ctx.lineTo(p[i + 1][0], p[i + 1][1]); ctx.stroke();
    }
  }
}
function disc(ctx, p, r, color) {
  ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(p[0], p[1], r + OL / 2, 0, 7); ctx.fill();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill();
}
function hand(ctx, el, hd, open, color) {
  if (open > 0.5) {
    const ux = hd[0] - el[0], uy = hd[1] - el[1], l = Math.hypot(ux, uy) || 1;
    chain(ctx, [hd, [hd[0] + ux / l * 0.12, hd[1] + uy / l * 0.12]], [0.05], color);
  } else disc(ctx, hd, 0.05, color);
}
function drawFighter(ctx, s, team, t, far) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pantsN = '#2b2731', pantsF = '#1a1820', wrapN = '#efe8da', wrapF = '#b6ae9f', shoe = '#121014';
  const f = s.dir;
  // far leg + arm
  chain(ctx, [s.rHp, s.rKn, s.rAn], [0.115, 0.095], pantsF);
  chain(ctx, [s.rAn, s.rToe], [0.07], shoe);
  chain(ctx, [s.rSh, s.rEl, s.rHd], [0.085, 0.075], team.dark);
  disc(ctx, s.rHd, 0.05, wrapF);
  // torso
  const ux = s.sh[0] - s.hip[0], uy = s.sh[1] - s.hip[1], l = Math.hypot(ux, uy), nx = -uy / l, ny = ux / l;
  const poly = [[s.hip[0] + nx * 0.1, s.hip[1] + ny * 0.1], [s.sh[0] + nx * 0.122, s.sh[1] + ny * 0.122], [s.sh[0] - nx * 0.122, s.sh[1] - ny * 0.122], [s.hip[0] - nx * 0.1, s.hip[1] - ny * 0.1]];
  const torso = (col, grow) => {
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = grow;
    ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); if (grow) ctx.stroke();
    ctx.beginPath(); ctx.arc(s.sh[0], s.sh[1], 0.118 + grow / 2, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(s.hip[0], s.hip[1], 0.105 + grow / 2, 0, 7); ctx.fill();
  };
  // neck + head outline first so the torso overlaps the neck base
  const hx = s.head[0] - s.sh[0], hy = s.head[1] - s.sh[1], hl = Math.hypot(hx, hy), ax = hx / hl, ay = hy / hl;
  chain(ctx, [s.sh, [s.sh[0] + ax * 0.14, s.sh[1] + ay * 0.14]], [0.07], team.dark);
  torso(OUT, OL * 2); torso(team.main, 0);
  ctx.fillStyle = pantsN; ctx.beginPath(); ctx.arc(s.hip[0], s.hip[1], 0.1, 0, 7); ctx.fill();
  // belt
  const bc = [s.hip[0] + ux / l * 0.06, s.hip[1] + uy / l * 0.06];
  chain(ctx, [[bc[0] + nx * 0.1, bc[1] + ny * 0.1], [bc[0] - nx * 0.1, bc[1] - ny * 0.1]], [0.045], '#ece2cc');
  const sway = Math.sin(t * 7 + f) * 0.03;
  chain(ctx, [[bc[0] - f * 0.09, bc[1]], [bc[0] - f * 0.15 + sway, bc[1] - 0.16]], [0.03], '#ece2cc');
  // head
  disc(ctx, s.head, L.headR, team.main);
  const pnx = -ay, pny = ax; // perpendicular across the head
  const band = [s.head[0] + ax * 0.03, s.head[1] + ay * 0.03];
  ctx.save(); ctx.beginPath(); ctx.arc(s.head[0], s.head[1], L.headR, 0, 7); ctx.clip();
  chain(ctx, [[band[0] + pnx * 0.12, band[1] + pny * 0.12], [band[0] - pnx * 0.12, band[1] - pny * 0.12]], [0.034], '#f4efe6');
  ctx.restore();
  const back = [band[0] - f * 0.09, band[1]], fl = Math.sin(t * 9 + f * 2) * 0.03;
  chain(ctx, [back, [back[0] - f * 0.13, back[1] - 0.02 + fl]], [0.024], '#f4efe6');
  chain(ctx, [back, [back[0] - f * 0.11, back[1] - 0.08 + fl * 0.7]], [0.022], '#f4efe6');
  const eye = [s.head[0] + f * 0.055 + ax * 0.0, s.head[1] - 0.005];
  ctx.strokeStyle = OUT; ctx.lineWidth = 0.014; ctx.beginPath(); ctx.moveTo(eye[0], eye[1]); ctx.lineTo(eye[0] + f * 0.035, eye[1] - 0.004); ctx.stroke();
  // near leg + arm
  chain(ctx, [s.lHp, s.lKn, s.lAn], [0.118, 0.098], pantsN);
  chain(ctx, [s.lAn, s.lToe], [0.072], shoe);
  chain(ctx, [s.lSh, s.lEl, s.lHd], [0.088, 0.078], team.main);
  hand(ctx, s.lEl, s.lHd, s.open, wrapN);
}
function drawGhosts(ctx, tr, team, t) {
  const now = tr.at(t), sn = solve(now.pose, now.base, now.dir, t);
  ctx.lineCap = 'round';
  for (let k = 1; k <= 4; k++) {
    const a = tr.at(t - k * 0.018), sp = solve(a.pose, a.base, a.dir, t - k * 0.018);
    ctx.globalAlpha = 0.22 * (1 - k / 5);
    ctx.strokeStyle = team.light;
    const limbs = [['lSh', 'lEl', 'lHd', 0.08], ['rSh', 'rEl', 'rHd', 0.075], ['lHp', 'lKn', 'lAn', 0.1], ['rHp', 'rKn', 'rAn', 0.1]];
    for (const [p0, p1, p2, w] of limbs) {
      if (Math.hypot(sp[p2][0] - sn[p2][0], sp[p2][1] - sn[p2][1]) < 0.07 * k) continue;
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(sp[p0][0], sp[p0][1]); ctx.lineTo(sp[p1][0], sp[p1][1]); ctx.lineTo(sp[p2][0], sp[p2][1]); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- effects + HUD
function star(ctx, x, y, r1, r2, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = rot + i * Math.PI / n; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.closePath();
}
function drawFX(ctx, S, t, ws, solved) {
  for (const e of S.ev) {
    const dt = t - e.t;
    if (dt < 0 || dt > 1.2) continue;
    if (e.type === 'hit' && dt < 0.24) {
      const [x, y] = ws([e.x, e.y]), k = dt / 0.24, R = (24 + 16 * e.power) * (0.7 + k * 0.8);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = '#fff4cf'; star(ctx, x, y, R, R * 0.42, 9, e.t * 10); ctx.fill();
      ctx.fillStyle = '#ffd36b'; star(ctx, x, y, R * 0.6, R * 0.25, 9, e.t * 10 + 0.3); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 18 + k * 70 * (0.6 + e.power * 0.3), 0, 7); ctx.stroke();
      ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) { const a = i * 0.785 + e.t * 7, r0 = 26 + k * 120, r1 = r0 + 16; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); ctx.stroke(); }
      ctx.globalAlpha = 1;
    } else if (e.type === 'block' && dt < 0.2) {
      const [x, y] = ws([e.x, e.y]), k = dt / 0.2;
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#cfeaff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, 10 + k * 40, 0, 7); ctx.stroke();
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 6; i++) { const a = i * 1.05 + e.t * 5, r0 = 12 + k * 50; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a) * (r0 + 10), y + Math.sin(a) * (r0 + 10)); ctx.stroke(); }
      ctx.globalAlpha = 1;
    } else if ((e.type === 'miss' || e.type === 'label') && dt < 0.9) {
      const [x, y] = ws([e.x, e.y]), k = dt / 0.9;
      ctx.globalAlpha = Math.min(1, (1 - k) * 2);
      ctx.font = e.type === 'miss' ? 'italic 900 30px Inter' : '800 17px Inter'; spaced(ctx, 2); ctx.textAlign = 'center';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,8,12,0.9)';
      const ty = y - 34 - k * 40;
      ctx.strokeText(e.type === 'miss' ? 'MISS' : e.text, x, ty);
      ctx.fillStyle = e.type === 'miss' ? '#d9d2ca' : e.color; ctx.fillText(e.type === 'miss' ? 'MISS' : e.text, x, ty);
      spaced(ctx, 0); ctx.globalAlpha = 1;
    } else if (e.type === 'thud' && dt < 0.6) {
      const [x, y] = ws([e.x, 0]), k = dt / 0.6;
      ctx.fillStyle = `rgba(200,170,130,${0.35 * (1 - k)})`;
      for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(x + (i - 3) * (24 + k * 30), y - 6 - k * 14 * (i % 2 + 1), 14 + k * 18, 0, 7); ctx.fill(); }
    } else if (e.type === 'foul' && dt < 1.3) {
      const k = dt / 1.3, sc = dt < 0.12 ? 1.6 - (dt / 0.12) * 0.6 : 1;
      ctx.save(); ctx.translate(W / 2, 250); ctx.rotate(-0.08); ctx.scale(sc, sc);
      ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
      ctx.font = '900 110px Inter'; spaced(ctx, 6); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 14; ctx.strokeStyle = '#0c0a0e'; ctx.strokeText('FOUL', 0, 0);
      ctx.fillStyle = '#ffcf3a'; ctx.fillText('FOUL', 0, 0);
      ctx.font = '800 26px Inter'; spaced(ctx, 3); ctx.lineWidth = 6; ctx.strokeText(`−${e.penalty} PENALTY`, 0, 78); ctx.fillStyle = '#fff'; ctx.fillText(`−${e.penalty} PENALTY`, 0, 78);
      ctx.restore(); spaced(ctx, 0); ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
    }
  }
  // floating damage numbers
  for (const h of S.hp) {
    const dt = t - h.t; if (dt < 0 || dt > 1.0 || !h.show) continue;
    const s = solved[h.who], [x, y] = ws([s.head[0], s.head[1] + 0.25]), k = dt / 1.0;
    ctx.globalAlpha = Math.min(1, (1 - k) * 2.5);
    ctx.font = '900 34px Inter'; ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = '#0c0a0e';
    const txt = `−${Math.round(-h.sum)}`, ty = y - k * 46;
    ctx.strokeText(txt, x, ty); ctx.fillStyle = TEAM[h.who].light; ctx.fillText(txt, x, ty);
    ctx.globalAlpha = 1;
  }
}
function drawHUD(ctx, S, t) {
  const sc = S.script, fighters = sc.fighters || {};
  const bw = 470, bh = 20, y = 40;
  for (const side of ['red', 'blue']) {
    const left = side === 'red', x = left ? 46 : W - 46 - bw, team = TEAM[side], fi = fighters[side] || {};
    const v = hpAt(S, side, t) / 100, g = hpAt(S, side, t, 0.55) / 100;
    ctx.fillStyle = 'rgba(8,6,10,0.78)'; rr(ctx, x - 5, y - 5, bw + 10, bh + 10, 7); ctx.fill();
    ctx.fillStyle = '#2a2228'; ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = '#f3e4cc';
    if (left) ctx.fillRect(x, y, bw * g, bh); else ctx.fillRect(x + bw * (1 - g), y, bw * g, bh);
    const gr = ctx.createLinearGradient(0, y, 0, y + bh); gr.addColorStop(0, team.light); gr.addColorStop(0.45, team.ui); gr.addColorStop(1, team.dark);
    ctx.fillStyle = gr;
    if (left) ctx.fillRect(x, y, bw * v, bh); else ctx.fillRect(x + bw * (1 - v), y, bw * v, bh);
    ctx.textAlign = left ? 'left' : 'right';
    ctx.font = '900 19px Inter'; spaced(ctx, 2); ctx.fillStyle = team.ui;
    const nm = team.name; ctx.fillText(nm, left ? x : x + bw, y - 13);
    const nw = ctx.measureText(nm).width; spaced(ctx, 0);
    ctx.font = '600 14px Inter'; ctx.fillStyle = '#d8cec4';
    ctx.fillText(fitText(ctx, fi.label || '', 260), left ? x + nw + 12 : x + bw - nw - 12, y - 14);
    ctx.font = 'italic 600 15px Inter'; ctx.fillStyle = '#efe5da';
    ctx.fillText(fitText(ctx, fi.stance ? `“${fi.stance}”` : '', bw), left ? x : x + bw, y + bh + 24);
  }
  ctx.textAlign = 'center';
  const cap = S.caps.find(c => t >= c.t0 && t < c.t1);
  ctx.font = '800 13px Inter'; spaced(ctx, 2.5); ctx.fillStyle = '#b5aaa0';
  ctx.fillText(cap ? `EXCHANGE ${cap.i + 1} / ${S.total}` : (t < S.tFight + 0.5 ? 'MARTIAL ARTS RULES' : 'FINAL BELL'), W / 2, 40);
  spaced(ctx, 0); ctx.font = '600 14px Inter'; ctx.fillStyle = '#e6dcd2';
  ctx.fillText(fitText(ctx, sc.title || '', 250), W / 2, 60);
}
function drawCaption(ctx, S, t) {
  const c = S.caps.find(c => t >= c.t0 && t < c.t1); if (!c) return;
  const a = clamp(Math.min((t - c.t0) / 0.25, (c.t1 - t) / 0.25), 0, 1);
  const x = 56, y = 548, w = W - 112, h = 162;
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(13,10,15,0.88)'; rr(ctx, x, y, w, h, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = TEAM[c.actor].ui; rr(ctx, x, y, 8, h, 4); ctx.fill();
  // chip line
  ctx.textAlign = 'left'; ctx.font = '800 13px Inter'; spaced(ctx, 2);
  let cx = x + 30;
  ctx.fillStyle = TEAM[c.actor].ui; ctx.fillText(TEAM[c.actor].name, cx, y + 32); cx += ctx.measureText(TEAM[c.actor].name).width + 14;
  for (const chip of c.chip) {
    const cw = ctx.measureText(chip).width + 18;
    ctx.fillStyle = chip === 'LANDED' ? 'rgba(255,211,107,0.22)' : chip === 'FOUL' ? 'rgba(255,207,58,0.28)' : 'rgba(255,255,255,0.1)';
    rr(ctx, cx, y + 16, cw, 23, 5); ctx.fill();
    ctx.fillStyle = '#ece3d9'; ctx.fillText(chip, cx + 9, y + 32); cx += cw + 8;
  }
  spaced(ctx, 0);
  // technique (appears when the action starts)
  if (t >= c.tA && c.name) {
    const k = clamp((t - c.tA) / 0.18, 0, 1), s = 1 + (1 - k) * 0.25;
    ctx.save(); ctx.translate(x + w - 28, y + 40); ctx.scale(s, s); ctx.globalAlpha = a * k;
    ctx.textAlign = 'right'; ctx.font = '900 30px Inter'; spaced(ctx, 1);
    let fs = 30; while (ctx.measureText(c.name).width > 560 && fs > 18) { fs -= 2; ctx.font = `900 ${fs}px Inter`; }
    ctx.fillStyle = TEAM[c.exec].light; ctx.fillText(c.name, 0, 0); spaced(ctx, 0);
    ctx.font = 'italic 600 14px Inter'; ctx.fillStyle = '#c9bfb4'; ctx.fillText(c.sub, 0, 22);
    ctx.restore(); ctx.globalAlpha = a;
  }
  // the point
  ctx.textAlign = 'left'; ctx.font = '600 22px Inter'; ctx.fillStyle = '#f6f1ea';
  const lines = wrap(ctx, `“${c.point}”`, w - 60).slice(0, 2);
  lines.forEach((ln, i) => ctx.fillText(ln, x + 30, y + 96 + i * 28));
  ctx.font = 'italic 500 16px Inter'; ctx.fillStyle = '#b9aea4';
  ctx.fillText(fitText(ctx, c.ruling ? `Ruling: ${c.ruling}` : '', w - 60), x + 30, y + 96 + lines.length * 28 + 4);
  ctx.globalAlpha = 1;
}
function drawTitle(ctx, S, t) {
  const sc = S.script, fi = sc.fighters || {};
  if (t < S.tFight + 0.1) {
    const a = clamp((S.tFight + 0.1 - t) / 0.4, 0, 1) * clamp(t / 0.3, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(8,6,10,0.72)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = '900 88px Inter'; spaced(ctx, 8); ctx.fillStyle = '#f6efe6'; ctx.fillText('THREAD FIGHT', W / 2, 250);
    spaced(ctx, 0); ctx.fillStyle = '#ffcf3a'; ctx.fillRect(W / 2 - 60, 276, 120, 5);
    ctx.font = '700 34px Inter'; ctx.fillStyle = '#efe5da';
    wrap(ctx, sc.title || '', 1000).slice(0, 2).forEach((ln, i) => ctx.fillText(ln, W / 2, 336 + i * 42));
    ctx.font = '900 26px Inter';
    ctx.textAlign = 'right'; ctx.fillStyle = TEAM.red.ui; ctx.fillText(`RED  “${fi.red && fi.red.stance || ''}”`, W / 2 - 50, 440);
    ctx.textAlign = 'center'; ctx.fillStyle = '#8f857c'; ctx.fillText('VS', W / 2, 440);
    ctx.textAlign = 'left'; ctx.fillStyle = TEAM.blue.ui; ctx.fillText(`“${fi.blue && fi.blue.stance || ''}”  BLUE`, W / 2 + 50, 440);
    ctx.textAlign = 'center'; ctx.font = '700 14px Inter'; spaced(ctx, 3); ctx.fillStyle = '#9d938a';
    ctx.fillText('MARTIAL ARTS RULES  ·  SCORED ON ARGUMENTATION', W / 2, 500); spaced(ctx, 0);
    ctx.globalAlpha = 1;
  }
  const dt = t - S.tFight;
  if (dt > 0.1 && dt < 1.1) {
    const k = (dt - 0.1) / 1.0, s = 1.35 - Math.min(1, k * 4) * 0.35;
    ctx.save(); ctx.translate(W / 2, 300); ctx.scale(s, s); ctx.globalAlpha = k > 0.6 ? (1 - k) / 0.4 : 1;
    ctx.font = 'italic 900 130px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 14; ctx.strokeStyle = '#0c0a0e'; ctx.strokeText('FIGHT!', 0, 0); ctx.fillStyle = '#ffcf3a'; ctx.fillText('FIGHT!', 0, 0);
    ctx.restore(); ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
  }
}
function drawVerdict(ctx, S, t) {
  const dt = t - S.tVerdict; if (dt < 0) return;
  const v = S.verdict, a = clamp(dt / 0.4, 0, 1);
  ctx.globalAlpha = a; ctx.fillStyle = 'rgba(8,6,10,0.66)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  const k = clamp(dt / 0.25, 0, 1), s = 1.3 - k * 0.3;
  ctx.save(); ctx.translate(W / 2, 270); ctx.scale(s, s);
  ctx.font = '900 104px Inter'; spaced(ctx, 6);
  const head = v.winner === 'draw' ? 'DRAW' : `${TEAM[v.winner].name} WINS`;
  ctx.lineWidth = 14; ctx.strokeStyle = '#0c0a0e'; ctx.strokeText(head, 0, 0);
  ctx.fillStyle = v.winner === 'draw' ? '#f3e4cc' : TEAM[v.winner].ui; ctx.fillText(head, 0, 0);
  ctx.restore(); spaced(ctx, 0);
  const how = { KO: 'BY KNOCKOUT', decision: 'BY DECISION', forfeit: 'BY FORFEIT', draw: 'ON POINTS' }[v.method] || '';
  ctx.font = '800 26px Inter'; spaced(ctx, 5); ctx.fillStyle = '#efe5da'; ctx.fillText(v.winner === 'draw' ? 'ON POINTS' : how, W / 2, 330); spaced(ctx, 0);
  ctx.font = '500 23px Inter'; ctx.fillStyle = '#e5dbd1';
  wrap(ctx, v.summary || '', 900).slice(0, 3).forEach((ln, i) => ctx.fillText(ln, W / 2, 396 + i * 32));
  ctx.font = '700 15px Inter'; spaced(ctx, 2); ctx.fillStyle = '#a2978d';
  ctx.fillText(`FINAL  ·  RED ${Math.round(hpAt(S, 'red', 1e9))}  ·  BLUE ${Math.round(hpAt(S, 'blue', 1e9))}`, W / 2, 520); spaced(ctx, 0);
  ctx.globalAlpha = 1;
}

function drawEndCard(ctx, S, t) {
  const dt = t - S.tEnd; if (dt < 0) return;
  const a = clamp(dt / 0.45, 0, 1), up = (1 - a) * 14;
  ctx.globalAlpha = a; ctx.fillStyle = '#0a080c'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.font = '900 84px Inter'; spaced(ctx, 8); ctx.fillStyle = '#f6efe6'; ctx.fillText(BRAND.name, W / 2, 292 + up);
  spaced(ctx, 0); ctx.fillStyle = '#ffcf3a'; ctx.fillRect(W / 2 - 60, 322 + up, 120, 5);
  ctx.font = '600 28px Inter'; ctx.fillStyle = '#d9cec3'; ctx.fillText(BRAND.tagline, W / 2, 390 + up);
  ctx.font = '800 34px Inter'; spaced(ctx, 2); ctx.fillStyle = '#ffcf3a'; ctx.fillText(BRAND.url, W / 2, 462 + up);
  spaced(ctx, 0); ctx.font = '600 16px Inter'; ctx.fillStyle = '#8f857c';
  ctx.fillText('Free Chrome extension', W / 2, 500 + up);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- frame
function render(ctx, S, t) {
  const r = S.R.at(t), b = S.B.at(t);
  const camX = clamp((r.base + b.base) / 2, -0.5, 0.5);
  let sx = 0, sy = 0;
  for (const e of S.ev) {
    if (e.type !== 'hit' && e.type !== 'thud') continue;
    const dt = t - e.t; if (dt < 0 || dt > 0.3) continue;
    const amp = (e.type === 'thud' ? 8 : e.power * 3.2) * (1 - dt / 0.3);
    sx += amp * Math.sin(t * 97 + e.t * 13); sy += amp * Math.cos(t * 83 + e.t * 7);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawBG(ctx, camX, sx, sy);
  const ox = W / 2 - camX * PPM + sx, oy = GROUND + sy;
  const ws = p => [ox + p[0] * PPM, oy - p[1] * PPM];
  const sr = solve(r.pose, r.base, r.dir, t), sb = solve(b.pose, b.base, b.dir, t);
  for (const s of [sr, sb]) {
    const [x, y] = ws([s.hip[0], 0]), k = clamp(s.hip[1] / 0.85, 0.3, 1.2);
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 95 * k + 20, 12, 0, 0, 7); ctx.fill();
  }
  ctx.setTransform(PPM, 0, 0, -PPM, ox, oy);
  drawGhosts(ctx, S.R, TEAM.red, t); drawGhosts(ctx, S.B, TEAM.blue, t);
  drawFighter(ctx, sr, TEAM.red, t); drawFighter(ctx, sb, TEAM.blue, t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawFX(ctx, S, t, ws, { red: sr, blue: sb });
  const vg = ctx.createRadialGradient(W / 2, H / 2, 300, W / 2, H / 2, 820);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  drawHUD(ctx, S, t);
  drawCaption(ctx, S, t);
  drawTitle(ctx, S, t);
  drawVerdict(ctx, S, t);
  drawEndCard(ctx, S, t);
}

root.ThreadFight = { W, H, build, render, solve, hpAt };
if (typeof module !== 'undefined') module.exports = root.ThreadFight;
})(typeof window !== 'undefined' ? window : globalThis);
