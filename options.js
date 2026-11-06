(async function () {
  const R = window.TFReferee;
  const $ = id => document.getElementById(id);
  let settings = await R.loadSettings();

  const provEl = $('providers');
  for (const [key, p] of Object.entries(R.PROVIDERS)) {
    const lab = document.createElement('label');
    lab.className = 'prov';
    lab.innerHTML = `<input type="radio" name="provider" value="${key}"><span class="pname"></span><span class="pdesc"></span>`;
    lab.querySelector('.pname').textContent = p.label;
    lab.querySelector('.pdesc').textContent = { anthropic: 'Claude API key', openai: 'OpenAI API key', openai_compat: 'Ollama, LM Studio, vLLM, MLX…', anthropic_compat: 'Any /v1/messages server' }[key];
    provEl.appendChild(lab);
  }

  function readForm() {
    const prof = settings.profiles[settings.provider];
    prof.apiKey = $('apiKey').value.trim();
    prof.baseUrl = $('baseUrl').value.trim() || R.PROVIDERS[settings.provider].baseUrl;
    prof.model = $('model').value.trim();
    settings.maxChars = Math.max(5000, parseInt($('maxChars').value, 10) || 60000);
  }
  function fill() {
    const p = R.PROVIDERS[settings.provider], prof = settings.profiles[settings.provider];
    provEl.querySelectorAll('input').forEach(i => { i.checked = i.value === settings.provider; i.closest('.prov').classList.toggle('on', i.checked); });
    $('apiKey').value = prof.apiKey || '';
    $('apiKey').placeholder = { anthropic: 'sk-ant-…', openai: 'sk-…' }[settings.provider] || 'optional for most local servers';
    $('keyHint').textContent = p.keyRequired ? '' : '(optional)';
    $('baseUrl').value = prof.baseUrl || p.baseUrl;
    $('urlHint').textContent = settings.provider === 'openai_compat'
      ? 'Include /v1 — e.g. http://localhost:11434/v1 (Ollama), http://localhost:1234/v1 (LM Studio), http://192.168.1.20:8000/v1'
      : settings.provider === 'anthropic_compat' ? 'The extension calls {base}/v1/messages.' : 'Leave as is unless you use a proxy or gateway.';
    $('model').value = prof.model || p.model;
    $('maxChars').value = settings.maxChars;
  }
  function status(msg, kind) { const s = $('status'); s.textContent = msg; s.className = 'status ' + (kind || ''); }

  provEl.addEventListener('change', e => {
    if (e.target.name !== 'provider') return;
    readForm(); settings.provider = e.target.value; fill(); status('');
  });
  $('toggleKey').onclick = () => { const k = $('apiKey'); k.type = k.type === 'password' ? 'text' : 'password'; $('toggleKey').textContent = k.type === 'password' ? 'Show' : 'Hide'; };

  async function ensurePermission() {
    const cfg = R.activeConfig(settings);
    let pattern; try { pattern = R.originPattern(cfg.baseUrl); } catch (e) { throw new Error('The base URL is not a valid URL.'); }
    if (await chrome.permissions.contains({ origins: [pattern] })) return true;
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) throw new Error(`Chrome didn't grant access to ${pattern}, so the extension can't call that server.`);
    return true;
  }
  $('save').onclick = async () => {
    readForm();
    try { await ensurePermission(); await R.saveSettings(settings); status('Saved.', 'ok'); }
    catch (e) { status(e.message, 'err'); }
  };
  $('test').onclick = async () => {
    readForm();
    try {
      await ensurePermission();
      await R.saveSettings(settings);
      status('Testing…');
      const reply = await R.complete(R.activeConfig(settings), 'You are a connection test.', 'Reply with the single word OK.', { maxTokens: 2000, noThink: true });
      const said = R.stripThinking(reply.text).trim();
      if (!said) status(`Connected, but ${R.activeConfig(settings).model} returned no answer${reply.finish ? ' (' + reply.finish + ')' : ''} — it may be a reasoning model that needs more tokens or thinking turned off.`, 'err');
      else status(`Connected — ${R.activeConfig(settings).model} replied “${said.slice(0, 40)}”.`, 'ok');
    } catch (e) { status(e.message, 'err'); }
  };
  $('fetchModels').onclick = async () => {
    readForm();
    try {
      await ensurePermission();
      status('Fetching models…');
      const ids = await R.listModels(R.activeConfig(settings));
      $('modelList').innerHTML = '';
      ids.forEach(id => { const o = document.createElement('option'); o.value = id; $('modelList').appendChild(o); });
      status(ids.length ? `${ids.length} models found — click the Model box to pick one.` : 'The server returned no models.', ids.length ? 'ok' : '');
    } catch (e) { status(e.message, 'err'); }
  };
  fill();
})();
