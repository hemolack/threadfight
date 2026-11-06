/* Thread Fight — referee: settings, LLM clients, prompt, anonymizer, fight-script validation. */
(function (root) {
'use strict';

// ---------------------------------------------------------------- settings
const PROVIDERS = {
  anthropic:        { label: 'Claude (Anthropic)',               style: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', keyRequired: true },
  openai:           { label: 'ChatGPT (OpenAI)',                 style: 'openai',    baseUrl: 'https://api.openai.com/v1', model: 'gpt-5',             keyRequired: true },
  openai_compat:    { label: 'Local / custom — OpenAI API',      style: 'openai',    baseUrl: 'http://localhost:11434/v1', model: 'qwen3',             keyRequired: false },
  anthropic_compat: { label: 'Local / custom — Anthropic API',   style: 'anthropic', baseUrl: 'http://localhost:8080',     model: '',                  keyRequired: false },
};
const DEFAULT_SETTINGS = {
  provider: 'anthropic',
  profiles: Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, { apiKey: '', baseUrl: p.baseUrl, model: p.model }])),
  maxChars: 60000,
};
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  s.profiles = Object.assign({}, DEFAULT_SETTINGS.profiles, (settings && settings.profiles) || {});
  for (const k of Object.keys(PROVIDERS)) s.profiles[k] = Object.assign({}, DEFAULT_SETTINGS.profiles[k], s.profiles[k] || {});
  return s;
}
async function saveSettings(s) { await chrome.storage.local.set({ settings: s }); }
function activeConfig(s) {
  const p = PROVIDERS[s.provider] || PROVIDERS.anthropic, prof = s.profiles[s.provider] || {};
  return { provider: s.provider, label: p.label, style: p.style, keyRequired: p.keyRequired,
    apiKey: (prof.apiKey || '').trim(), baseUrl: (prof.baseUrl || p.baseUrl).trim(), model: (prof.model || p.model).trim() };
}
function originPattern(url) { const u = new URL(url); return `${u.protocol}//${u.hostname}/*`; }

// ---------------------------------------------------------------- LLM clients
function anthropicBase(url) { return url.replace(/\/+$/, '').replace(/\/v1$/, ''); }
function openaiBase(url) {
  const u = url.replace(/\/+$/, '');
  try { const p = new URL(u); if (p.pathname === '' || p.pathname === '/') return u + '/v1'; } catch (e) { /* fallthrough */ }
  return u;
}
class LLMError extends Error {}

async function httpJSON(url, opts, cfg) {
  let res;
  try { res = await fetch(url, opts); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new LLMError(`Couldn't reach ${new URL(url).host}. Check the base URL, that the server is running, and that the extension was allowed to access that address (Settings → Save).`);
  }
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const msg = (data && (data.error && (data.error.message || data.error) || data.message)) || text.slice(0, 300);
    const err = new LLMError(friendly(res.status, String(msg), cfg, url));
    err.status = res.status; err.raw = String(msg);
    throw err;
  }
  return data;
}
function friendly(status, msg, cfg, url) {
  const host = new URL(url).host;
  if (status === 401) return `${host} rejected the API key (401). Check the key in Settings.`;
  if (status === 403 && /localhost|127\.0\.0\.1|192\.168\.|10\.|\.local/.test(host))
    return `${host} refused the request (403). Local servers often block browser-extension origins — for Ollama, set OLLAMA_ORIGINS="chrome-extension://*" and restart it. (${msg})`;
  if (status === 404) return `${host} returned 404 — check the base URL and model name (${cfg.model}). (${msg})`;
  if (status === 429) return `${host} is rate-limiting or out of credit (429). (${msg})`;
  return `${host} returned HTTP ${status}: ${msg}`;
}

async function complete(cfg, system, user, o) {
  o = o || {};
  if (cfg.keyRequired && !cfg.apiKey) throw new LLMError(`No API key set for ${cfg.label}. Open Settings to add one.`);
  if (!cfg.model) throw new LLMError('No model set. Open Settings and choose a model.');
  if (cfg.style === 'anthropic') {
    const url = anthropicBase(cfg.baseUrl) + '/v1/messages';
    const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
    const body = { model: cfg.model, max_tokens: o.maxTokens || 8000, system, messages: [{ role: 'user', content: user }] };
    if (o.temperature !== undefined) body.temperature = o.temperature;
    const data = await withParamRetry(body, b => httpJSON(url, { method: 'POST', headers, body: JSON.stringify(b), signal: o.signal }, cfg));
    const blocks = Array.isArray(data.content) ? data.content : [];
    return { text: blocks.filter(b => b.type === 'text').map(b => b.text).join(''),
      reasoning: blocks.filter(b => b.type === 'thinking').map(b => b.thinking || '').join(''),
      finish: data.stop_reason || '' };
  }
  const url = openaiBase(cfg.baseUrl) + '/chat/completions';
  const headers = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey;
  const official = /(^|\.)openai\.com$/.test(new URL(url).hostname);
  const body = { model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  if (official) body.max_completion_tokens = Math.max(o.maxTokens || 0, 16000); // reasoning models spend tokens thinking
  else {
    body.max_tokens = o.maxTokens || 16000;
    if (o.temperature !== undefined) body.temperature = o.temperature;
    if (o.noThink) body.chat_template_kwargs = { enable_thinking: false }; // vLLM / SGLang / some MLX servers; others ignore or reject (handled below)
  }
  if (o.json) body.response_format = { type: 'json_object' };
  const data = await withParamRetry(body, b => httpJSON(url, { method: 'POST', headers, body: JSON.stringify(b), signal: o.signal }, cfg));
  const ch = (data.choices && data.choices[0]) || {}, m = ch.message || {};
  const text = Array.isArray(m.content) ? m.content.map(p => (typeof p === 'string' ? p : p.text || '')).join('') : (m.content || '');
  return { text, reasoning: m.reasoning_content || m.reasoning || '', finish: ch.finish_reason || '' };
}
// Servers disagree about optional parameters; drop or swap the one they complain about and retry.
async function withParamRetry(body, send) {
  for (let i = 0; i < 4; i++) {
    try { return await send(body); }
    catch (e) {
      if (e.status !== 400 && e.status !== 422) throw e;
      const raw = (e.raw || '').toLowerCase();
      if (raw.includes('max_tokens') && body.max_tokens !== undefined && raw.includes('max_completion_tokens')) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; continue; }
      const p = ['response_format', 'chat_template_kwargs', 'temperature', 'max_completion_tokens', 'max_tokens'].find(k => body[k] !== undefined && raw.includes(k));
      if (!p) throw e;
      delete body[p];
    }
  }
  return send(body);
}
async function listModels(cfg) {
  if (cfg.style === 'anthropic') {
    const headers = { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
    const d = await httpJSON(anthropicBase(cfg.baseUrl) + '/v1/models?limit=100', { headers }, cfg);
    return (d.data || []).map(m => m.id);
  }
  const headers = cfg.apiKey ? { authorization: 'Bearer ' + cfg.apiKey } : {};
  const d = await httpJSON(openaiBase(cfg.baseUrl) + '/models', { headers }, cfg);
  return (d.data || d.models || []).map(m => m.id || m.name).filter(Boolean).sort();
}

// ---------------------------------------------------------------- thread → anonymized text
function formatThread(thread, maxChars) {
  const items = [];
  if (thread.post && (thread.post.text || thread.post.author)) items.push({ id: 'p0', parent_id: null, author: thread.post.author || 'Original poster', text: thread.post.text || '' });
  for (const c of thread.comments || []) items.push(c);
  const alias = new Map();
  for (const it of items) { const a = (it.author || 'unknown').trim(); if (!alias.has(a)) alias.set(a, `User ${alias.size + 1}`); }
  const pats = [];
  [...alias.entries()].sort((a, b) => b[0].length - a[0].length).forEach(([name, al]) => {
    const parts = [name]; const first = name.split(/\s+/)[0];
    if (name.includes(' ') && first.length > 2) parts.push(first);
    for (const p of parts) pats.push([new RegExp('(^|[^\\p{L}])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^\\p{L}])', 'giu'), al]);
  });
  const scrub = s => pats.reduce((acc, [rx, al]) => acc.replace(rx, (m, pre) => pre + al), String(s || ''));
  let out = '';
  if (items.length > (thread.post ? 1 : 0)) {
    out = items.map(it => `[${it.id}] ${alias.get((it.author || 'unknown').trim())}${it.parent_id ? ` (reply to ${it.parent_id})` : ' (original post)'}: ${scrub(it.text).replace(/\s+/g, ' ').trim()}`).join('\n');
  } else if (thread.raw) {
    out = scrub(thread.raw); // structured scrape found nothing: fall back to the page text
  }
  let truncated = false;
  if (out.length > maxChars) { out = out.slice(0, maxChars); truncated = true; }
  return { text: out, raw: !(items.length > (thread.post ? 1 : 0)), truncated, people: alias.size };
}

// ---------------------------------------------------------------- prompt
const SYSTEM = `You are the referee for "Thread Fight". It turns an online comment-section argument into a short animated martial-arts bout. You read a comment thread and produce a FIGHT SCRIPT: a sequence of exchanges ("beats") between two sides, each ruled on by the quality of the argumentation.

JUDGING RULES
- Judge how well each point was argued, not which overall position you prefer. Apply the same standard to both sides.
- A point LANDS when it is relevant, supported (evidence, sound reasoning, or a concrete example), and the other side fails to answer it adequately.
- A point is BLOCKED when the other side gives an adequate, on-topic answer that neutralizes it.
- A point is COUNTERED when the answer neutralizes it AND turns it against the person who made it (their evidence actually supports the other side, or their claim backfires).
- A point MISSES when it is a fallacy, irrelevant, or attacks a position the other side never took.
- Claims that are demonstrably false, or that misrepresent their sources, cannot land.
- A FOUL is a personal attack (insult, ad hominem, mockery of the person) used in place of an argument.
- Conceding a point, or walking away, counts against the side that does it.

SIDES
- Find the main dispute in the thread. "red" = the side of the first commenter who takes a position in that dispute; "blue" = the opposing side. If several people argue the same side, merge them into one fighter.
- Ignore jokes, off-topic comments and pile-ons that add no argument.
- NEVER output anyone's name or username. Refer to the sides only as Red and Blue.

BEATS (4 to 10, in the order the arguments happened; merge minor back-and-forth, skip filler)
- actor: "red" | "blue" (the side making the point)
- kind: one of
    claim        a plain assertion
    evidence     a point backed by data, a source, or a concrete example
    rebuttal     a direct answer to the previous point
    trap         exposes a contradiction in the opponent's own statements
    bait         a question that leads the opponent into an answer that undermines them
    fallacy      a logical fallacy (also set fallacy_type, e.g. strawman, appeal_to_tradition, whataboutism, slippery_slope, false_dilemma, moving_goalposts, anecdotal, appeal_to_authority, red_herring)
    ad_hominem   attacks the person instead of the point
    gish_gallop  a flood of loosely related points
    concession   the actor gives ground
    exit         the actor leaves the thread or gives up
- outcome: "landed" | "blocked" | "countered" | "missed" | "foul" | "none"
    fallacy -> missed (or countered if the opponent turned it around)
    ad_hominem -> foul
    concession, exit -> none
- strength: 1 (minor), 2 (solid), 3 (decisive)
- point: the point in your own words, at most 110 characters, instantly understandable to a viewer. Paraphrase; do not quote at length.
- ruling: why it got that outcome, at most 90 characters.
- source_comment_ids: the ids of the comments the beat is drawn from (when ids are provided).

VERDICT
- winner: "red" | "blue" | "draw"
- method: "KO" | "decision" | "draw" | "forfeit"
    KO only when one side is clearly routed (core claim decisively refuted or conceded). Then the LAST beat must damage the loser: a winner's point that lands, or a loser's point that gets countered.
    forfeit when the last beat is an exit.
- summary: at most 160 characters, neutral tone, about the argumentation rather than the people.

Also produce:
- title: the dispute as a neutral question, at most 60 characters.
- fighters.red.stance / fighters.blue.stance: each side's position in at most 24 characters.

If the thread contains no real disagreement, still return a script: pick the closest thing to opposing views and use a "draw" verdict.

OUTPUT: exactly one JSON object and nothing else, in this shape:
{
  "title": "...",
  "fighters": {"red": {"label": "Commenter A", "stance": "..."}, "blue": {"label": "Commenter B", "stance": "..."}},
  "beats": [
    {"id": 1, "actor": "red", "kind": "claim", "fallacy_type": null, "outcome": "blocked", "strength": 2,
     "point": "...", "ruling": "...", "source_comment_ids": ["c1"]}
  ],
  "verdict": {"winner": "blue", "method": "decision", "summary": "..."}
}`;

function userMessage(fmt, platform) {
  const site = { linkedin: 'LinkedIn', reddit: 'Reddit' }[platform] || 'Facebook';
  const note = fmt.raw
    ? `This is the raw visible text of a ${site} comment section. Ignore interface text such as "Like", "Reply", "Share", "Comment", timestamps ("3h", "2d"), reaction counts, "Most relevant", "View more replies", "Author", "Top fan", connection degrees ("2nd"), job titles under names, and Reddit's vote counts, "points", "OP", "level N", "Award", "Share", "more replies" and "[deleted]". Reply structure is only implied by order.\n\n`
    : `${site} thread. Each line is one comment: [id] author (reply to parent-id): text. Authors are already anonymized.\n\n`;
  return `${note}${fmt.truncated ? '(The thread was long and has been truncated.)\n\n' : ''}THREAD:\n${fmt.text}\n\nReturn the fight script JSON.`;
}

// ---------------------------------------------------------------- fight-script validation (mirror of schema.py)
const KINDS = new Set(['claim', 'evidence', 'rebuttal', 'trap', 'bait', 'fallacy', 'ad_hominem', 'gish_gallop', 'concession', 'exit']);
const OUTCOMES = new Set(['landed', 'blocked', 'countered', 'missed', 'foul', 'none']);
class ScriptError extends Error {}
function stripThinking(text) {
  let t = String(text || '');
  const close = t.toLowerCase().lastIndexOf('</think>');
  if (close >= 0) t = t.slice(close + 8);
  else if (/^\s*<think>/i.test(t)) t = '';           // thinking never finished
  return t;
}
function parseJSON(text) {
  const t = stripThinking(text).replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new ScriptError('no JSON object found in the model output');
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { throw new ScriptError('invalid JSON: ' + e.message); }
}
const TRUNC = new Set(['length', 'max_tokens', 'max_output_tokens']);
function diagnose(reply, err) {
  const visible = stripThinking(reply.text).trim();
  const thinking = (reply.reasoning || '').length + (String(reply.text || '').length - stripThinking(reply.text).length);
  const cut = TRUNC.has(reply.finish);
  let why;
  if (!visible && thinking && cut) why = `The model used its whole output budget thinking (${thinking.toLocaleString()} characters of reasoning) and never wrote the answer.`;
  else if (!visible && cut) why = 'The reply was cut off at the output limit before any answer appeared.';
  else if (!visible) why = `The model returned an empty answer${reply.finish ? ` (finish reason: ${reply.finish})` : ''}.`;
  else if (cut) why = 'The reply was cut off at the output limit in the middle of the JSON.';
  else why = `The reply wasn't a fight script (${err.message}).`;
  const excerpt = visible ? `\n\nThe model said: “${visible.slice(0, 280).replace(/\s+/g, ' ')}${visible.length > 280 ? '…' : ''}”` : '';
  return { why, excerpt, thinkingProblem: !visible && (thinking > 0 || cut) };
}
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; };
const damages = (b, who) => (b.outcome === 'landed' && b.actor !== who) || (b.outcome === 'countered' && b.actor === who);
function normalize(raw) {
  const warn = [];
  if (!raw || typeof raw !== 'object') throw new ScriptError('script must be a JSON object');
  const bin = raw.beats;
  if (!Array.isArray(bin) || !bin.length) throw new ScriptError("script needs a non-empty 'beats' list");
  const beats = [];
  for (let i = 0; i < bin.length; i++) {
    const b = bin[i] || {};
    const actor = String(b.actor || '').toLowerCase();
    if (actor !== 'red' && actor !== 'blue') throw new ScriptError(`beat ${i + 1}: actor must be red or blue`);
    let kind = String(b.kind || 'claim').toLowerCase().replace(/[- ]/g, '_');
    if (!KINDS.has(kind)) { warn.push(`beat ${i + 1}: unknown kind ${kind} → claim`); kind = 'claim'; }
    let outcome = String(b.outcome || 'landed').toLowerCase();
    if (!OUTCOMES.has(outcome)) { warn.push(`beat ${i + 1}: unknown outcome ${outcome} → blocked`); outcome = 'blocked'; }
    const forced = { ad_hominem: 'foul', concession: 'none', exit: 'none' }[kind];
    if (forced && outcome !== forced) outcome = forced;
    if (kind === 'fallacy' && outcome !== 'missed' && outcome !== 'countered') outcome = 'missed';
    if (outcome === 'foul' && kind !== 'ad_hominem') kind = 'ad_hominem';
    if (outcome === 'none' && kind !== 'concession' && kind !== 'exit') outcome = 'blocked';
    let strength = parseInt(b.strength, 10); if (!(strength >= 1)) strength = 2;
    const beat = { id: i + 1, actor, kind, outcome, strength: Math.max(1, Math.min(3, strength)),
      point: clip(b.point, 120), ruling: clip(b.ruling, 100),
      source_comment_ids: (Array.isArray(b.source_comment_ids) ? b.source_comment_ids : []).map(String).slice(0, 12) };
    if (kind === 'fallacy' && b.fallacy_type) beat.fallacy_type = String(b.fallacy_type).toLowerCase().replace(/ /g, '_').replace(/[^a-z_]/g, '').slice(0, 30);
    beats.push(beat);
    if (kind === 'exit') { if (i < bin.length - 1) warn.push('beats after an exit were dropped'); break; }
  }
  const v = raw.verdict || {};
  let winner = String(v.winner || 'draw').toLowerCase(); if (!['red', 'blue', 'draw'].includes(winner)) winner = 'draw';
  let method = String(v.method || 'decision'); const ml = method.toLowerCase();
  method = ['ko', 'tko', 'knockout'].includes(ml) ? 'KO' : ml;
  if (!['KO', 'decision', 'draw', 'forfeit'].includes(method)) method = 'decision';
  const last = beats[beats.length - 1];
  if (last.kind === 'exit') { method = 'forfeit'; winner = last.actor === 'red' ? 'blue' : 'red'; }
  if (winner === 'draw') method = 'draw'; else if (method === 'draw') method = 'decision';
  if (method === 'KO' && !damages(last, winner === 'red' ? 'blue' : 'red')) { warn.push('KO requested but the last beat does not hit the loser → decision'); method = 'decision'; }
  const f = raw.fighters || {};
  const fighter = (side, def) => ({ label: clip((f[side] || {}).label || def, 28), stance: clip((f[side] || {}).stance || '', 30) });
  return { script: { title: clip(raw.title || 'Comment-section showdown', 70), fighters: { red: fighter('red', 'Commenter A'), blue: fighter('blue', 'Commenter B') },
    beats, verdict: { winner, method, summary: clip(v.summary, 180) } }, warnings: warn };
}

async function referee(cfg, thread, maxChars, o) {
  o = o || {};
  const fmt = formatThread(thread, maxChars || 60000);
  if (!fmt.text.trim()) throw new ScriptError('No comments were captured from this thread.');
  const local = cfg.provider === 'openai_compat' || cfg.provider === 'anthropic_compat';
  let noThink = local && o.noThink !== false;
  const base = userMessage(fmt, thread.platform);
  let user = base, last = null;
  for (let n = 0; n < 3; n++) {
    const msg = noThink ? user + '\n\n/no_think' : user;   // Qwen3-style switch; other models ignore it
    const reply = await complete(cfg, SYSTEM, msg, { json: true, temperature: 0.2, signal: o.signal, noThink });
    try { const r = normalize(parseJSON(reply.text)); r.sent = fmt; return r; }
    catch (e) {
      if (!(e instanceof ScriptError)) throw e;
      last = diagnose(reply, e);
      if (o.onRetry) o.onRetry(new ScriptError(last.why));
      if (last.thinkingProblem) noThink = true;               // ask reasoning models to skip straight to the answer
      user = base + `\n\nYour previous reply was rejected: ${last.why} Respond with ONLY the JSON object — no preamble, no explanation.`;
    }
  }
  const hint = last.thinkingProblem
    ? '\n\nThis usually means a reasoning model is thinking too long. Try a non-reasoning model, turn off thinking on your server (for Ollama: run the model with thinking disabled), or pick a larger/faster model.'
    : '\n\nTry again, or switch to a stronger model in Settings — small local models sometimes ignore the JSON format.';
  throw new ScriptError(`The model never produced a valid fight script after 3 tries. ${last.why}${last.excerpt}${hint}`);
}

root.TFReferee = { PROVIDERS, DEFAULT_SETTINGS, loadSettings, saveSettings, activeConfig, originPattern, complete, listModels,
  formatThread, normalize, parseJSON, stripThinking, referee, LLMError, ScriptError, SYSTEM };
})(typeof window !== 'undefined' ? window : globalThis);
