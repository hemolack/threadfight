/* Thread Fight — page reader for Facebook, LinkedIn and Reddit.
 * Injected on demand (activeTab + scripting) when the user clicks the toolbar button.
 * It never clicks, expands or changes anything on the page: it only reads the comments
 * that are currently showing, and answers three messages from the popup:
 *   tf:list       → the comment threads on the page, most visible first
 *   tf:capture    → one thread's visible comments (or the visible page text as a fallback)
 *   tf:highlight  → briefly outline a thread so the user can see which one is selected
 *
 * Facebook class names are obfuscated and change constantly, so the Facebook reader keys off ARIA
 * (comment articles are labelled "Comment by …" / "Reply by …"). LinkedIn's class names are used
 * directly, with fallbacks. Reddit has two front ends: the current one (<shreddit-comment> elements
 * carrying author / thingid / parentid attributes) and old.reddit.com (.thing.comment blocks); the
 * reader picks whichever is on the page, since www.reddit.com can serve either.
 */
(() => {
  if (window.__threadFightReader) return;
  window.__threadFightReader = true;

  const txt = el => (el ? (el.innerText || el.textContent || '') : '').replace(/ /g, ' ').trim();
  const shown = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const MAX_RAW = 200000;
  const SEE_MORE = /\s*(…|\.\.\.)?\s*(see )?more$/i;

  // ------------------------------------------------------------------ Facebook
  const FB_UI = /^(like|reply|share|edit|hide|see translation|author|top fan|follow|most relevant|all comments|newest|edited|just now|·|\d+[smhdwy]|\d+ ?(min|hr|hrs|h|d|w|y)s?|\d+|see more|send)$/i;
  const facebook = {
    name: 'facebook',
    articles(root) {
      return [...(root || document).querySelectorAll('[role="article"][aria-label]')]
        .filter(a => /^(comment|reply) by /i.test(a.getAttribute('aria-label') || '') && shown(a));
    },
    isReply: a => /^reply by /i.test(a.getAttribute('aria-label') || ''),
    container(el) {
      return el.closest('[role="dialog"]') || el.closest('[aria-posinset]')
        || el.closest('[role="article"]:not([aria-label^="Comment by"]):not([aria-label^="Reply by"])')
        || el.closest('[role="main"]') || document.body;
    },
    containers() {
      const set = new Set();
      for (const a of this.articles()) set.add(this.container(a));
      return [...set];
    },
    author(a) {
      const label = a.getAttribute('aria-label') || '';
      const m = label.match(/^(?:comment|reply) by (.+?)(?: to (.+?)['’]s (?:comment|reply))?(?: (?:\d+|an?|one) (?:second|minute|hour|day|week|month|year)s? ago| just now)?$/i);
      if (m) return { name: m[1].trim(), to: m[2] ? m[2].trim() : null };
      return { name: txt(a.querySelector('a[role="link"] span, a span')) || 'Unknown', to: null };
    },
    body(a, author) {
      const nested = [...a.querySelectorAll('[role="article"]')];
      const parts = [];
      for (const d of a.querySelectorAll('div[dir="auto"], span[dir="auto"][lang]')) {
        if (nested.some(n => n.contains(d))) continue;
        if (d.closest('a') || d.closest('[role="button"]')) continue;
        if (parts.some(p => p.el.contains(d))) continue;
        const t = txt(d);
        if (!t || t === author || FB_UI.test(t)) continue;
        parts.push({ el: d, t });
      }
      let body = parts.map(p => p.t).join('\n');
      if (!body) body = txt(a).split('\n').map(s => s.trim()).filter(s => s && s !== author && !FB_UI.test(s)).join(' ');
      return body.replace(SEE_MORE, '').trim();
    },
    structuralParent(a, idOf) {
      const li = a.closest('li');
      let p = li && li.parentElement ? li.parentElement.closest('li') : null;
      while (p) {
        const art = p.querySelector('[role="article"][aria-label]');
        if (art && art !== a && idOf.has(art)) return idOf.get(art);
        p = p.parentElement ? p.parentElement.closest('li') : null;
      }
      return null;
    },
    post(c) {
      const msg = c.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-ad-rendering-role="story_message"]');
      const who = c.querySelector('h2 a, h3 a, h2 strong, h3 strong, [data-ad-rendering-role="profile_name"]');
      return { author: txt(who).split('\n')[0] || 'Original poster', text: txt(msg).replace(SEE_MORE, '') };
    },
    scrape(c) {
      const idOf = new Map(), lastBy = {}, comments = [];
      let lastTop = null;
      this.articles(c).forEach((a, i) => {
        const id = 'c' + (i + 1);
        idOf.set(a, id);
        const { name, to } = this.author(a);
        let parent = 'p0';
        if (this.isReply(a)) parent = (to && lastBy[to]) || this.structuralParent(a, idOf) || lastTop || 'p0';
        else lastTop = id;
        lastBy[name] = id;
        const text = this.body(a, name);
        if (text) comments.push({ id, parent_id: parent, author: name, text });
      });
      return comments;
    },
    commentRegion(c) { const a = this.articles(c); return a.length ? a : [c]; },
  };

  // ------------------------------------------------------------------ LinkedIn
  const LI_ART = 'article.comments-comment-entity, article.comments-comment-item, article[data-id^="urn:li:comment"], article[data-id*="comment:"]';
  const linkedin = {
    name: 'linkedin',
    articles(root) { return [...(root || document).querySelectorAll(LI_ART)].filter(shown); },
    container(el) {
      return el.closest('.feed-shared-update-v2') || el.closest('[data-urn^="urn:li:activity"]') || el.closest('[data-id^="urn:li:activity"]')
        || el.closest('.scaffold-finite-scroll__content > div') || el.closest('main') || document.body;
    },
    containers() {
      const set = new Set();
      for (const a of this.articles()) set.add(this.container(a));
      return [...set];
    },
    author(a) {
      const el = a.querySelector('.comments-comment-meta__description-title, .comments-post-meta__name-text, .comment-meta__name, .comments-comment-meta__actor .hoverable-link-text, .comments-post-meta__name');
      let name = txt(el).split('\n')[0];
      if (!name) { const link = a.querySelector('a[href*="/in/"] span[aria-hidden="true"], a[href*="/in/"]'); name = txt(link).split('\n')[0]; }
      return (name || 'Unknown').replace(/\s*•.*$/, '').replace(/\s*(1st|2nd|3rd\+?|Author)$/i, '').trim();
    },
    body(a) {
      const own = el => el && el.closest(LI_ART) === a;
      const sel = '.comments-comment-item__main-content, .comments-comment-entity__content .update-components-text, .comments-comment-item-content-body, .update-components-text, .feed-shared-main-content--comment';
      const el = [...a.querySelectorAll(sel)].find(own);
      let t = txt(el);
      if (!t) {
        const spans = [...a.querySelectorAll('span[dir="ltr"]')].filter(own).map(txt).filter(s => s.length > 1);
        t = spans.sort((x, y) => y.length - x.length)[0] || '';
      }
      return t.replace(SEE_MORE, '').trim();
    },
    post(c) {
      const msg = c.querySelector('.feed-shared-update-v2__description, .feed-shared-inline-show-more-text, .update-components-update-v2__commentary, .feed-shared-text');
      const who = c.querySelector('.update-components-actor__title span[aria-hidden="true"], .update-components-actor__name span[aria-hidden="true"], .feed-shared-actor__name');
      return { author: txt(who).split('\n')[0] || 'Original poster', text: txt(msg).replace(SEE_MORE, '') };
    },
    scrape(c) {
      const idOf = new Map(), comments = [];
      this.articles(c).forEach((a, i) => {
        const id = 'c' + (i + 1);
        idOf.set(a, id);
        const parentArt = a.parentElement ? a.parentElement.closest(LI_ART) : null;
        const text = this.body(a);
        if (text) comments.push({ id, parent_id: (parentArt && idOf.get(parentArt)) || 'p0', author: this.author(a), text });
      });
      return comments;
    },
    commentRegion(c) { const a = this.articles(c); return a.length ? a : [c]; },
  };


  // ------------------------------------------------------------------ Reddit (current "shreddit" front end)
  const SKIP_AUTHORS = /^(automoderator|\[deleted\])$/i;
  const SKIP_BODIES = /^\[(deleted|removed)\]$/i;
  const reddit = {
    name: 'reddit',
    bodyEl(c) {
      return [...c.children].find(el => el.getAttribute('slot') === 'comment')
        || c.querySelector(':scope > [id$="-comment-rtjson-content"]');
    },
    articles(root) {
      return [...(root || document).querySelectorAll('shreddit-comment')]
        .filter(c => !c.hasAttribute('collapsed') && shown(this.bodyEl(c)));
    },
    container(el) { return el.closest('shreddit-comment-tree') || el.closest('main') || document.body; },
    containers() {
      const set = new Set();
      for (const a of this.articles()) set.add(this.container(a));
      return [...set];
    },
    author(c) { return (c.getAttribute('author') || txt(c.querySelector('[slot="commentMeta"] a[href*="/user/"]')) || 'Unknown').replace(/^u\//, '').trim(); },
    body(c) { return txt(this.bodyEl(c)); },
    post() {
      const p = document.querySelector('shreddit-post');
      if (!p) return { author: 'Original poster', text: '' };
      const title = p.getAttribute('post-title') || txt(p.querySelector('[slot="title"], h1'));
      const body = txt(p.querySelector('[slot="text-body"]'));
      return { author: p.getAttribute('author') || 'Original poster', text: [title, body].filter(Boolean).join('\n\n') };
    },
    scrape(c) {
      const idOf = new Map(), comments = [];   // reddit thing id → our id (skipped comments map to their parent)
      const ancestorThing = el => { const a = el.parentElement ? el.parentElement.closest('shreddit-comment') : null; return a ? a.getAttribute('thingid') : null; };
      let n = 0;
      for (const a of this.articles(c)) {
        const thing = a.getAttribute('thingid') || ('x' + n);
        const pthing = a.getAttribute('parentid') || ancestorThing(a);
        const parent = (pthing && idOf.get(pthing)) || 'p0';
        const author = this.author(a), text = this.body(a);
        if (!text || SKIP_AUTHORS.test(author) || SKIP_BODIES.test(text)) { idOf.set(thing, parent); continue; }
        const id = 'c' + (++n);
        idOf.set(thing, id);
        comments.push({ id, parent_id: parent, author, text });
      }
      return comments;
    },
    commentRegion(c) { const a = this.articles(c); return a.length ? a : [c]; },
  };

  // ------------------------------------------------------------------ Reddit (old.reddit.com front end)
  const oldReddit = {
    name: 'reddit',
    bodyEl(t) { return t.querySelector(':scope > .entry .usertext-body .md'); },
    articles(root) {
      return [...(root || document).querySelectorAll('.thing.comment')]
        .filter(t => !t.classList.contains('collapsed') && shown(this.bodyEl(t)));
    },
    container(el) { return el.closest('.commentarea') || document.body; },
    containers() {
      const set = new Set();
      for (const a of this.articles()) set.add(this.container(a));
      return [...set];
    },
    author(t) { return t.getAttribute('data-author') || txt(t.querySelector(':scope > .entry .author')) || 'Unknown'; },
    body(t) { return txt(this.bodyEl(t)); },
    post() {
      const p = document.querySelector('#siteTable .thing.link, .thing.link');
      if (!p) return { author: 'Original poster', text: '' };
      const title = txt(p.querySelector('a.title'));
      const body = txt(p.querySelector('.usertext-body .md'));
      return { author: p.getAttribute('data-author') || 'Original poster', text: [title, body].filter(Boolean).join('\n\n') };
    },
    scrape(c) {
      const idOf = new Map(), comments = [];
      let n = 0;
      for (const t of this.articles(c)) {
        const pt = t.parentElement ? t.parentElement.closest('.thing.comment') : null;
        const parent = (pt && idOf.get(pt)) || 'p0';
        const author = this.author(t), text = this.body(t);
        if (!text || SKIP_AUTHORS.test(author) || SKIP_BODIES.test(text)) { idOf.set(t, parent); continue; }
        const id = 'c' + (++n);
        idOf.set(t, id);
        comments.push({ id, parent_id: parent, author, text });
      }
      return comments;
    },
    commentRegion(c) { const a = this.articles(c); return a.length ? a : [c]; },
  };

  function pickAdapter() {
    const h = location.hostname;
    if (/(^|\.)linkedin\.com$/.test(h)) return linkedin;
    if (/(^|\.)reddit\.com$/.test(h)) {
      if (document.querySelector('shreddit-comment, shreddit-post, shreddit-app')) return reddit;
      if (document.querySelector('.thing.comment, .commentarea, .thing.link')) return oldReddit;
      return /^old\./.test(h) ? oldReddit : reddit;
    }
    return facebook;
  }

  // ------------------------------------------------------------------ thread registry
  const byId = new Map();
  let seq = 0;
  function idFor(c) {
    if (!c.dataset.tfThread) c.dataset.tfThread = 't' + (++seq);
    byId.set(c.dataset.tfThread, c);
    return c.dataset.tfThread;
  }
  function onScreen(els) { // pixels of the comment region inside the viewport
    const vh = innerHeight, vw = innerWidth;
    let px = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)), w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      px += h * w;
    }
    return px;
  }
  function list() {
    const adapter = pickAdapter();
    const threads = adapter.containers().map(c => {
      const post = adapter.post(c);
      const comments = adapter.scrape(c);
      const first = comments[0] ? comments[0].text : '';
      return {
        id: idFor(c),
        count: comments.length,
        replies: comments.filter(x => x.parent_id !== 'p0').length,
        snippet: (post.text || first || 'Comment thread').replace(/\s+/g, ' ').slice(0, 140),
        dialog: !!c.closest('[role="dialog"]'),
        score: onScreen(adapter.commentRegion(c)),
      };
    }).filter(t => t.count > 0);
    threads.sort((a, b) => (b.dialog - a.dialog) || (b.score - a.score));
    return { platform: adapter.name, url: location.href, threads };
  }
  function capture(id) {
    const adapter = pickAdapter();
    const base = { platform: adapter.name, url: location.href, capturedAt: new Date().toISOString(), visibleOnly: true };
    if (id && byId.has(id)) {
      const c = byId.get(id);
      return Object.assign(base, { post: adapter.post(c), comments: adapter.scrape(c), raw: '' });
    }
    // Fallback: the visible text of the main column (innerText skips hidden content).
    const main = document.querySelector('[role="dialog"]') || document.querySelector('[role="main"], main') || document.body;
    return Object.assign(base, { post: { author: 'Original poster', text: '' }, comments: [], raw: txt(main).slice(0, MAX_RAW) });
  }
  let lit = null;
  function highlight(id, on) {
    if (lit) { lit.style.outline = lit.dataset.tfOutline || ''; lit.style.outlineOffset = ''; lit = null; }
    const c = on && byId.get(id);
    if (!c) return;
    c.dataset.tfOutline = c.style.outline || '';
    c.style.outline = '3px solid #ffcf3a'; c.style.outlineOffset = '4px';
    lit = c;
    const r = c.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) c.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    try {
      if (msg.type === 'tf:list') send({ ok: true, ...list() });
      else if (msg.type === 'tf:capture') { highlight(null, false); send({ ok: true, thread: capture(msg.id) }); }
      else if (msg.type === 'tf:highlight') { highlight(msg.id, msg.on); send({ ok: true }); }
      else return false;
    } catch (e) { send({ ok: false, error: String(e && e.message || e) }); }
    return false;
  });
})();
