(async function () {
  'use strict';
  const R = window.TFReferee;
  const $ = id => document.getElementById(id);
  const panels = ['consent', 'setup', 'wrongSite', 'loading', 'pick', 'none'];
  const show = id => panels.forEach(p => { $(p).hidden = p !== id; });
  const err = msg => { $('err').hidden = !msg; $('err').textContent = msg || ''; };
  const SITE = /^https:\/\/((www\.|web\.)?(facebook|linkedin)\.com|(www\.|old\.|new\.|sh\.)?reddit\.com)\//;

  $('settings').onclick = $('openSetup').onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
  $('decline').onclick = () => window.close();

  // The popup acts on the tab it was opened from. (?tab= lets the popup page be opened directly for testing.)
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  const tab = forced ? await chrome.tabs.get(forced) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

  async function gate() {
    const { consentAt } = await chrome.storage.local.get('consentAt');
    if (!consentAt) { show('consent'); return false; }
    const cfg = R.activeConfig(await R.loadSettings());
    if (cfg.keyRequired && !cfg.apiKey) { show('setup'); return false; }
    if (!tab || !SITE.test(tab.url || '')) { show('wrongSite'); return false; }
    return true;
  }
  $('agree').onclick = async () => { await chrome.storage.local.set({ consentAt: new Date().toISOString() }); start(); };

  async function send(msg) {
    try { return await chrome.tabs.sendMessage(tab.id, msg); }
    catch (e) { // reader not injected yet (or page reloaded): inject and retry
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      return chrome.tabs.sendMessage(tab.id, msg);
    }
  }

  let selected = null;
  async function scan() {
    err(''); show('loading');
    let res;
    try { res = await send({ type: 'tf:list' }); }
    catch (e) { show('none'); err('Couldn’t read this page: ' + (e.message || e)); return; }
    if (!res || !res.ok) { show('none'); err((res && res.error) || 'The page didn’t respond. Reload it and try again.'); return; }
    if (!res.threads.length) { show('none'); return; }
    const box = $('threads'); box.textContent = '';
    selected = res.threads[0].id;
    $('pickTitle').textContent = res.threads.length > 1 ? 'Pick the argument' : 'Ready to fight';
    for (const t of res.threads) {
      const lab = document.createElement('label'); lab.className = 'thread' + (t.id === selected ? ' on' : '');
      const r = document.createElement('input'); r.type = 'radio'; r.name = 'thread'; r.value = t.id; r.checked = t.id === selected;
      const snip = document.createElement('span'); snip.className = 'snip'; snip.textContent = t.snippet;
      const meta = document.createElement('span'); meta.className = 'meta';
      meta.textContent = `${t.count} visible comment${t.count === 1 ? '' : 's'}${t.replies ? ` (${t.replies} repl${t.replies === 1 ? 'y' : 'ies'})` : ''}${t.dialog ? ' · open post' : ''}`;
      lab.append(r, snip, meta); box.appendChild(lab);
      lab.onmouseenter = () => send({ type: 'tf:highlight', id: t.id, on: true }).catch(() => {});
      r.onchange = () => { selected = t.id; box.querySelectorAll('.thread').forEach(x => x.classList.toggle('on', x === lab)); send({ type: 'tf:highlight', id: t.id, on: true }).catch(() => {}); };
    }
    box.onmouseleave = () => send({ type: 'tf:highlight', on: false }).catch(() => {});
    show('pick');
    if (res.threads.length > 1) send({ type: 'tf:highlight', id: selected, on: true }).catch(() => {});
  }

  async function fight(id) {
    err('');
    $('start').disabled = true; $('useRaw').disabled = true;
    try {
      const cap = await send({ type: 'tf:capture', id });
      if (!cap || !cap.ok) throw new Error((cap && cap.error) || 'Capture failed.');
      if (!cap.thread.comments.length && !cap.thread.raw) throw new Error('Nothing to send: no comments or text were found.');
      const resp = await chrome.runtime.sendMessage({ type: 'tf:start', thread: cap.thread });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'The extension did not respond.');
      window.close();
    } catch (e) { err(e.message || String(e)); $('start').disabled = false; $('useRaw').disabled = false; }
  }
  $('start').onclick = () => fight(selected);
  $('useRaw').onclick = () => fight(null);
  $('refresh').onclick = $('rescan2').onclick = scan;

  async function start() { if (await gate()) scan(); }
  start();
})();
