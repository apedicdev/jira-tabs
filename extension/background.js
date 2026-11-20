// Jira Tab Reuse: one tab per Jira issue.
//
// When a tab arrives at https://<site>.atlassian.net/browse/KEY-123 and another tab already shows
// that issue, the other tab is brought to the front and this one is undone:
//   - a tab that was opened for it (new tab, new window, a link from Slack or email) is closed;
//   - a tab that moved to it from another page goes back to that page.
// Only full issue pages (/browse/KEY) count. Boards and lists showing an issue in a side panel don't.
// content.js makes plain clicks on issue links inside Jira open a new tab instead of replacing the page.

const FRESH_MS = 30_000;
const ISSUE_PATH = /^\/browse\/([a-z][a-z0-9_]*-\d+)\/?$/i;

function jiraUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.atlassian.net') ? u : null;
  } catch {
    return null;
  }
}

// "site/KEY-123" for an issue page, otherwise null. Keys are case-insensitive in Jira URLs.
function issueOf(url) {
  const u = url && jiraUrl(url);
  const m = u && ISSUE_PATH.exec(u.pathname);
  return m ? `${u.hostname}/${m[1].toUpperCase()}` : null;
}

// Tabs opened straight onto a Jira page, until their first page has loaded. Mirrored to
// storage.session because Chrome stops this service worker when it is idle.
const fresh = new Map();
const closing = new Set();
let enabled = true;

const ready = Promise.all([
  chrome.storage.session.get('fresh').then(({ fresh: saved = {} }) => {
    for (const [id, t] of Object.entries(saved)) fresh.set(Number(id), t);
  }),
  chrome.storage.local.get('enabled').then(({ enabled: on }) => {
    enabled = on !== false;
  }),
]);

const isFresh = (id) => fresh.has(id) && Date.now() - fresh.get(id) < FRESH_MS;

function setFresh(id, on) {
  if (on) fresh.set(id, Date.now());
  else if (!fresh.delete(id)) return;
  for (const [k, t] of fresh) if (Date.now() - t >= FRESH_MS) fresh.delete(k);
  chrome.storage.session.set({ fresh: Object.fromEntries(fresh) });
}

// The tab, other than `self`, that already shows the issue: one in the same window if there is one,
// otherwise the one used most recently.
function findOpen(tabs, key, self) {
  const others = tabs.filter((t) =>
    t.id !== self.id &&
    !closing.has(t.id) &&
    issueOf(t.pendingUrl || t.url) === key &&
    // Two new tabs for the same issue at once: keep the older one.
    !(isFresh(t.id) && t.id > self.id));
  const sameWin = (t) => (t.windowId === self.windowId ? 1 : 0);
  others.sort((a, b) => sameWin(b) - sameWin(a) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return others[0];
}

async function bringToFront(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function reuse(tabId, url) {
  const key = issueOf(url);
  if (!enabled || !key || closing.has(tabId)) return;
  try {
    const tabs = await chrome.tabs.query({});
    const self = tabs.find((t) => t.id === tabId);
    const target = self && findOpen(tabs, key, self);
    if (!target) return;

    const close = isFresh(tabId);
    if (close) closing.add(tabId);
    await bringToFront(target);
    if (close) {
      await chrome.tabs.remove(tabId);
      return;
    }
    try {
      await chrome.tabs.goBack(tabId);
    } catch {
      // Nothing to go back to: the tab was opened for this issue, so close it.
      closing.add(tabId);
      await chrome.tabs.remove(tabId);
    }
  } catch {
    // A tab closed while we were working on it.
  }
}

// From content.js: an issue link was clicked. Switch to the issue's tab if it has one; otherwise
// content.js opens it in a new tab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'open-issue' || !sender.tab) return;
  (async () => {
    await ready;
    const key = issueOf(msg.url);
    if (!enabled || !key) return false;
    const target = findOpen(await chrome.tabs.query({}), key, sender.tab);
    if (!target) return false;
    await bringToFront(target);
    return true;
  })().then((switched) => sendResponse({ switched }), () => sendResponse({ switched: false }));
  return true;
});

chrome.tabs.onCreated.addListener(async (tab) => {
  await ready;
  const url = tab.pendingUrl || tab.url;
  if (!jiraUrl(url)) return;
  setFresh(tab.id, true);
  await reuse(tab.id, url);
});

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  await ready;
  if (change.url) await reuse(tabId, change.url);
  if (change.status === 'complete') setFresh(tabId, false);
});

// Chrome swaps in a preloaded tab when you open a page from the address bar.
chrome.tabs.onReplaced.addListener(async (addedId, removedId) => {
  await ready;
  setFresh(removedId, false);
  const tab = await chrome.tabs.get(addedId).catch(() => null);
  if (tab) await reuse(addedId, tab.pendingUrl || tab.url);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  closing.delete(tabId);
  setFresh(tabId, false);
});

// The toolbar button turns reuse on and off, e.g. to open a second copy of an issue on purpose.
function showState() {
  chrome.action.setBadgeText({ text: enabled ? '' : 'off' });
  chrome.action.setBadgeBackgroundColor({ color: '#6b778c' });
  chrome.action.setTitle({
    title: enabled ? 'Jira tab reuse is on. Click to turn it off.' : 'Jira tab reuse is off. Click to turn it on.',
  });
}

chrome.action.onClicked.addListener(async () => {
  await ready;
  await chrome.storage.local.set({ enabled: !enabled });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.enabled) return;
  enabled = changes.enabled.newValue !== false;
  showState();
});

ready.then(showState);
