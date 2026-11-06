// Thread Fight — service worker: opens settings on install and hands captured threads to the fight page.

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  try { await chrome.runtime.openOptionsPage(); }
  catch (e) { chrome.tabs.create({ url: chrome.runtime.getURL('options.html') }); }
});

// Reachable from the service worker console (and tests).
self.tfOpenOptions = () => chrome.runtime.openOptionsPage();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'tf:start') {
    const id = crypto.randomUUID();
    chrome.storage.session.set({ ['job:' + id]: { thread: msg.thread, created: Date.now() } })
      .then(() => chrome.tabs.create({
        url: chrome.runtime.getURL('fight.html?job=' + id),
        index: sender.tab ? sender.tab.index + 1 : undefined,
        openerTabId: sender.tab ? sender.tab.id : undefined,
      }))
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true; // async response
  }
  if (msg && msg.type === 'tf:openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
  return false;
});
