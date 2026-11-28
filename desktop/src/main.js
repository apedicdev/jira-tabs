// Jira Tabs / GitLab Tabs: Jira or GitLab in its own window, with one tab per issue (and per
// merge request in GitLab). The same code builds both apps; rules.js holds what differs.
//
// The window has a tab strip and toolbar (ui/) and, below it, one view per tab showing the real
// site, signed in with your normal login (kept between launches).
//
// Link rules ("item" = a Jira issue, or a GitLab issue, merge request or epic):
//   - An item that's already open in a tab is never opened twice: you're switched to its tab.
//   - An item never replaces the page you're on: clicking a link to another item opens it in a
//     new tab next to the current one.
//   - Pinned tabs (e.g. Jira's "For you") always show their own page: going to that page from
//     anywhere switches to the pinned tab, and links clicked in it open in new tabs.
//   - Other pages of the site (boards, pipelines, files) open in the current tab as usual.
//   - Links to other websites open in your web browser, or in the other app of the pair
//     (GitLab links from Jira Tabs, Jira links from GitLab Tabs) when it's installed.
//   - <app>-tabs:// links (and site links handed over by other apps) open here, following the
//     same rules.
//   - Tabs you haven't looked at for a while (10 minutes unless changed) close by themselves;
//     never the tab you're on, pinned tabs, or a page with unsaved changes.
//   - Pointing at a link to an item starts loading it out of sight, so its tab shows at once
//     when you click (Jira issues, but not Confluence pages; GitLab issues, merge requests and epics).
//   - Sign-in forms can be filled from 1Password (password-manager.js).
//   - Version 2: Jira issues, and GitLab issues and merge requests, open as light tabs. Instead of
//     a whole page each, they share one small page of the app's own (light/), drawn from the
//     site's data (jira-api.js, gitlab-api.js), which takes a fraction of the memory. "Open full
//     Jira" / "Open full GitLab" (⇧⌘J) turns a light tab into the real page.

const { app, BrowserWindow, WebContentsView, Menu, ipcMain, shell, session, clipboard, nativeTheme, dialog, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { PROFILES, createRules, normalizeSite } = require('./rules');
const passwords = require('./password-manager');
const { createJiraApi } = require('./jira-api');
const { createGitlabApi } = require('./gitlab-api');

// The light view's own page, and images from the Jira or GitLab site shown in it.
protocol.registerSchemesAsPrivileged([
  { scheme: 'jira-tabs-light', privileges: { standard: true, secure: true } },
  { scheme: 'site-media', privileges: { standard: true, secure: true } },
]);

// Which app this is: set at build time (package.json "appProfile"), or APP_PROFILE when run
// from source.
const profile = PROFILES[process.env.APP_PROFILE || require('../package.json').appProfile || 'jira'] || PROFILES.jira;
const partnerProfile = profile.id === 'jira' ? PROFILES.gitlab : PROFILES.jira;
app.setName(profile.productName);
app.setPath('userData', process.env.TABS_USER_DATA || path.join(app.getPath('appData'), profile.productName));

const PROTOCOL = profile.protocol;
const PARTITION = `persist:${profile.id}`;
const LIGHT_PARTITION = 'light'; // the light view: no cookies of its own, nothing kept
const TOP = 78; // height of the tab strip and toolbar
const IS_MAC = process.platform === 'darwin';
const TEST = process.env.TABS_TEST === '1';
const BLANK = 'about:blank';

// ---------- settings ----------

const file = (name) => path.join(app.getPath('userData'), name);
const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (p, data) => {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Could not save', p, err.message);
  }
};

// Defaults for one of the apps: config.json, with config.local.json laid over it. The local file
// isn't in the repository; it holds your own site and pins for the apps you build.
function loadConfig(id) {
  const dir = path.join(__dirname, '..');
  const local = TEST && process.env.TABS_NO_LOCAL_CONFIG === '1' ? {} : readJson(path.join(dir, 'config.local.json'), {});
  return { ...(readJson(path.join(dir, 'config.json'), {})[id] || {}), ...(local[id] || {}) };
}

const defaults = loadConfig(profile.id);
const settings = readJson(file('settings.json'), {});
let rules = createRules(profile.id, settings.site || defaults.site);
let site = rules.site;
// Pinned pages in the config may be paths ("/jira/for-you"), meaning that page of your site.
const resolvePins = (list) => (Array.isArray(list) ? list : [])
  .map((p) => (typeof p === 'string' && p.startsWith('/') ? (site ? site + p : null) : p))
  .filter((u) => typeof u === 'string' && rules.isInApp(u));
// Pages kept in pinned tabs, e.g. Jira's "For you".
let pinnedUrls = Array.isArray(settings.pinned) ? settings.pinned.filter((u) => rules.isInApp(u)) : resolvePins(defaults.pinned);
// Minutes after which a tab you haven't looked at closes; 0 = never.
const validMinutes = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
let closeAfterMinutes =
  validMinutes(settings.closeUnusedTabsAfterMinutes) ?? validMinutes(defaults.closeUnusedTabsAfterMinutes) ?? 10;
// Minutes after which a tab you haven't looked at goes to sleep (its page is closed until you
// open the tab again); 0 = never.
let sleepAfterMinutes =
  validMinutes(settings.sleepUnusedTabsAfterMinutes) ?? validMinutes(defaults.sleepUnusedTabsAfterMinutes) ?? 5;
// Load an issue or merge request as soon as you point at a link to it.
let preloadLinks = settings.preloadLinks ?? defaults.preloadLinks ?? true;
// Open issues (and GitLab merge requests) as light tabs.
let lightIssues = rules.canLight && (settings.lightIssues ?? defaults.lightIssues ?? true);

const saveSettings = () => writeJson(file('settings.json'), {
  site, pinned: pinnedUrls, closeUnusedTabsAfterMinutes: closeAfterMinutes,
  sleepUnusedTabsAfterMinutes: sleepAfterMinutes, preloadLinks, lightIssues,
});

// The other app of the pair, to hand its links to when it's installed.
function partnerRules() {
  const saved = readJson(path.join(app.getPath('appData'), partnerProfile.productName, 'settings.json'), {});
  const partnerDefaults = loadConfig(partnerProfile.id);
  return createRules(partnerProfile.id, saved.site || partnerDefaults.site);
}
const partnerInstalled = () =>
  (TEST ? process.env.TABS_TEST_PARTNER === '1' : !!app.getApplicationNameForProtocol(`${partnerProfile.protocol}://`));

// ---------- what counts as "the same page" ----------

const pagePath = (url) => {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
};
const PIN = 'pin:';

// The identity used to find an open tab for a page: a pinned page, or an item, or null.
function keyOf(url) {
  const p = pagePath(url);
  if (p && pinnedUrls.some((u) => pagePath(u) === p)) return PIN + p;
  return rules.itemOf(url);
}

// ---------- window and tabs ----------

let win = null;
// Each tab: { id, view, url, title, favicon, loading, openerId, loadedOnce, navIndex,
//             ignoreNavUntil, untouched, pinned, pinUrl, lastSeen, closing, light }
// A light tab has no view of its own (view: null): the shared light view shows it.
let tabs = [];
let activeId = null;
let nextId = 1;
let showingSetup = false;
let uiReady = false; // the tab strip has loaded and can take state updates
let findState = null; // { text, matches, ordinal }
const closedUrls = [];
const pendingLinks = []; // links handed over before the window was ready

const tabById = (id) => tabs.find((t) => t.id === id);
const activeTab = () => tabById(activeId);
const tabOf = (wc) => tabs.find((t) => t.view?.webContents === wc);
const pinnedCount = () => tabs.filter((t) => t.pinned).length;
// What a tab shows: its own page, or the light view for a light tab.
const pageWc = (t) => (t?.light ? (lightView && !lightView.webContents.isDestroyed() ? lightView.webContents : null) : t?.view?.webContents) || null;

function createWindow() {
  const saved = readJson(file('session.json'), {});
  const bounds = saved.bounds || {};
  const dark = nativeTheme.shouldUseDarkColors;
  uiReady = false;
  win = new BrowserWindow({
    width: bounds.width || 1280,
    height: bounds.height || 860,
    x: bounds.x,
    y: bounds.y,
    minWidth: 640,
    minHeight: 420,
    title: profile.productName,
    show: false,
    backgroundColor: dark ? '#1f1f21' : '#dfe1e6',
    titleBarStyle: 'hidden',
    ...(IS_MAC
      ? { trafficLightPosition: { x: 14, y: 12 } }
      : { titleBarOverlay: { color: dark ? '#1f1f21' : '#dfe1e6', symbolColor: dark ? '#e6e6e6' : '#172b4d', height: 38 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload-ui.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (saved.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => (TEST ? win.showInactive() : win.show()));
  win.on('resize', layout);
  win.on('enter-full-screen', () => sendCommand('fullscreen', true));
  win.on('leave-full-screen', () => sendCommand('fullscreen', false));
  win.on('close', saveSession);
  win.on('closed', () => {
    for (const key of [...preloaded.keys()]) dropPreloaded(key);
    for (const t of tabs) t.view?.webContents.close();
    if (lightView && !lightView.webContents.isDestroyed()) lightView.webContents.close();
    lightView = null;
    lightReady = null;
    win = null;
    tabs = [];
    activeId = null;
  });
  win.webContents.on('did-finish-load', () => {
    // The page still counts as loading here, so "loaded" is our own flag: links waiting to open
    // would otherwise go straight back into the queue, and this loop would never end.
    uiReady = true;
    if (!site) return showSetup(true);
    if (!tabs.length) restoreTabs(saved);
    while (pendingLinks.length) openFromOutside(pendingLinks.shift());
    sendState();
  });
}

// Pinned tabs first (always on their own page), then the tabs open last time. With sleeping tabs
// on, those start asleep (with their saved titles) and load when you open them.
function restoreTabs(saved) {
  for (const url of pinnedUrls) addTab(url, { pinned: true, activate: false });
  const urls = (saved.tabs || []).filter((u) => rules.isInApp(u) && !keyOf(u)?.startsWith(PIN));
  const titles = saved.titles && typeof saved.titles === 'object' ? saved.titles : {};
  for (const url of urls) {
    addTab(url, { activate: false, asleep: sleepAfterMinutes > 0, title: typeof titles[url] === 'string' ? titles[url] : '' });
  }
  if (!tabs.length) addTab(rules.home, { activate: false });
  const wanted = saved.activeUrl
    ? tabs.find((t) => t.url === saved.activeUrl) || tabs.find((t) => keyOf(t.url) && keyOf(t.url) === keyOf(saved.activeUrl))
    : tabs[pinnedCount() + (saved.active || 0)]; // sessions saved by version 1.0
  activateTab((wanted || tabs[pinnedCount()] || tabs[0]).id);
}

// A page view, hidden until it's the active tab. One being loaded ahead isn't slowed down while
// it's out of sight.
function createPageView({ preloading = false } = {}) {
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload-page.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: !TEST && !preloading,
    },
  });
  view.setBackgroundColor('#ffffff');
  view.setVisible(false);
  win.contentView.addChildView(view);
  return view;
}

// Take a page view out of the window, unless the window is already gone (while it closes).
function detachView(view) {
  if (view && win && !win.isDestroyed()) win.contentView.removeChildView(view);
}

const pickFavicon = (favicons) => favicons.find((f) => /^(https:|data:image\/)/.test(f)) || null;

// An issue opens as a light tab (version 2), unless `full`. Light tabs have no page of their own,
// so they never sleep.
function addTab(url, { index = tabs.length, activate = true, openerId = null, untouched = false, pinned = false, asleep = false, title = '', full = false } = {}) {
  if (lightIssues && !pinned && !full && rules.lightKeyOf(url)) return addLightTab(url, { index, activate, openerId, title });
  const first = pinned ? 0 : pinnedCount();
  const last = pinned ? pinnedCount() : tabs.length;
  if (asleep && !pinned) {
    // Just its place in the strip; the page loads when the tab is opened.
    const tab = {
      id: nextId++, view: null, asleep: true, url, title, favicon: null, loading: false, openerId,
      loadedOnce: false, navIndex: 0, ignoreNavUntil: 0, untouched, pinned: false, pinUrl: null,
      lastSeen: Date.now(), closing: false,
    };
    tabs.splice(Math.max(first, Math.min(index, last)), 0, tab);
    if (activate || !activeId) activateTab(tab.id);
    else sendState();
    return tab;
  }
  // An item loaded ahead (you pointed at its link) becomes the tab as it is.
  const ready = takePreloaded(url);
  const view = ready?.view || createPageView();
  const wc = view.webContents;
  const tab = {
    id: nextId++, view, url: ready?.url || url, title: ready?.title || '', favicon: ready?.favicon || null,
    loading: ready ? wc.isLoading() : url !== BLANK, openerId,
    loadedOnce: !!ready && !wc.isLoading(), navIndex: ready ? wc.navigationHistory.getActiveIndex() : 0,
    ignoreNavUntil: 0, untouched, pinned, pinUrl: pinned ? url : null, lastSeen: Date.now(), closing: false,
    asleep: false,
  };
  tabs.splice(Math.max(first, Math.min(index, last)), 0, tab);
  wireTab(tab);
  if (ready) {
    wc.setBackgroundThrottling(!TEST);
    wc.setAudioMuted(false);
  } else {
    wc.loadURL(url).catch(() => {});
  }
  if (activate || !activeId) activateTab(tab.id);
  else sendState();
  return tab;
}

// Whether going to this address takes a pinned tab off its page (it then opens in a new tab
// instead). The site's sign-in pages don't: signed out, the pinned page sends you through them
// and back, and that has to happen in the pinned tab itself.
const leavesPin = (tab, url) =>
  tab.pinned && rules.isSitePage(url) && !rules.isSignInPage(url) && pagePath(url) !== pagePath(tab.pinUrl);
// Whether this is another item than the one the tab shows (so it belongs in its own tab). A
// pinned tab's own page isn't, even while the tab is away from it, e.g. on the sign-in page.
const otherItem = (tab, url, current = tab.url) => {
  const key = keyOf(url);
  return !!key && key !== keyOf(current) && !(tab.pinned && pagePath(url) === pagePath(tab.pinUrl));
};

function wireTab(tab) {
  const wc = tab.view.webContents;
  const navIndex = () => wc.navigationHistory.getActiveIndex();

  wc.setWindowOpenHandler((details) => onWindowOpen(tab, details));

  wc.on('will-navigate', (event, legacyUrl) => {
    const url = event.url || legacyUrl;
    if (!/^https?:/i.test(url)) return event.preventDefault();
    if (tab.untouched || !rules.isSitePage(tab.url)) return;
    // An item doesn't replace a page of the site: it gets its own tab, or its open tab comes
    // forward. A pinned tab doesn't leave its page.
    if (otherItem(tab, url) || (tab.loadedOnce && leavesPin(tab, url))) {
      event.preventDefault();
      openUrl(url, { from: tab, newTab: true });
    }
  });

  wc.on('did-navigate', (_e, url) => {
    tab.url = url;
    tab.navIndex = navIndex();
    if (dropDuplicate(tab)) return;
    sendState();
  });

  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (!isMainFrame) return;
    const before = tab.url;
    const beforeIndex = tab.navIndex;
    const pushed = navIndex() > beforeIndex;
    // The site moved this tab to another item (or a pinned tab off its page) without a link we
    // caught: put this tab back where it was and open the page in its own tab.
    if (pushed && Date.now() > tab.ignoreNavUntil && rules.isSitePage(before) && !tab.untouched &&
        (otherItem(tab, url, before) || leavesPin(tab, url))) {
      tab.ignoreNavUntil = Date.now() + 1500;
      // goToIndex rather than goBack: goBack skips entries a page added without a click.
      wc.navigationHistory.goToIndex(beforeIndex);
      openUrl(url, { from: tab, newTab: true });
      return;
    }
    tab.url = url;
    tab.navIndex = navIndex();
    if (dropDuplicate(tab)) return;
    sendState();
  });

  wc.on('did-start-loading', () => {
    tab.loading = true;
    sendState();
  });
  wc.on('did-stop-loading', () => {
    tab.loading = false;
    tab.loadedOnce = tab.url !== BLANK;
    sendState();
  });
  wc.on('page-title-updated', (_e, title) => {
    tab.title = title;
    sendState();
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = pickFavicon(favicons);
    sendState();
  });
  wc.on('found-in-page', (_e, result) => {
    if (!findState || tab.id !== activeId) return;
    findState.matches = result.matches;
    findState.ordinal = result.activeMatchOrdinal;
    sendState();
  });
  wc.on('context-menu', (_e, params) => showContextMenu(tab, params));
  wc.on('render-process-gone', () => {
    tab.loading = false;
    sendState();
  });
}

// A tab that has ended up on a page another tab already shows: a tab opened for an item whose
// address redirected to an open one (a moved issue), or a tab that landed on a pinned page
// (e.g. via a redirect from the site's home page). Switch to the other tab and undo this one.
function dropDuplicate(tab) {
  const key = keyOf(tab.url);
  if (!key || tab.pinned) return false;
  const other = findOpen(key, tab);
  if (!other || (tab.loadedOnce && !key.startsWith(PIN))) return false;
  activateTab(other.id);
  const h = tab.view.webContents.navigationHistory;
  if (tab.loadedOnce && h.canGoBack()) {
    tab.ignoreNavUntil = Date.now() + 1500;
    h.goBack();
  } else {
    closeTab(tab.id, { remember: false });
  }
  return true;
}

// window.open, target=_blank links, and Ctrl/Cmd/middle clicks.
function onWindowOpen(tab, { url, disposition, features }) {
  // Sign-in pop-ups (e.g. "Sign in with Google" inside a Jira app) stay in a small window here,
  // so they can hand the result back to the page.
  if (disposition === 'new-window' && features) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: win || undefined,
        width: 520,
        height: 680,
        autoHideMenuBar: true,
        webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, preload: undefined },
      },
    };
  }
  if (rules.isInApp(url)) openUrl(url, { from: tab, background: disposition === 'background-tab', newTab: true });
  else openExternal(url);
  return { action: 'deny' };
}

// From preload-page.js, on a plain click on a link: does the app handle it? Answered at once
// (the page waits); the work happens right after.
function onLinkClick(tab, url) {
  if (/^mailto:/i.test(url)) return () => openExternal(url);
  if (!/^https?:/i.test(url)) return null;
  if (!rules.isInApp(url)) return () => openExternal(url);
  if (otherItem(tab, url)) return () => openUrl(url, { from: tab });
  if (leavesPin(tab, url)) {
    return () => openUrl(url, { from: tab, newTab: true });
  }
  return null;
}

ipcMain.on('link-click', (event, url) => {
  const tab = tabOf(event.sender);
  const work = tab && typeof url === 'string' ? onLinkClick(tab, url) : null;
  event.returnValue = work ? 'handled' : 'default';
  if (work) setImmediate(work);
});

// The tab, other than `self`, already showing this page.
function findOpen(key, self) {
  return tabs.find((t) => t !== self && keyOf(t.url) === key) ||
    (key.startsWith(PIN) ? tabs.find((t) => t !== self && t.pinned && PIN + pagePath(t.pinUrl) === key) : undefined);
}

// ---------- light issue tabs (version 2) ----------

// One page of the app's own shows whichever light tab is open; light tabs are just their address
// and title. Their data comes from the site's API with your sign-in, kept here for a minute.
let lightView = null;
let lightReady = null; // resolves once the light page has loaded
let jiraApi = null; // jira-api.js or gitlab-api.js, for the site
const issueCache = new Map(); // issue key → { data, at }
const issueFetches = new Map(); // issue key → fetch in progress
const issueTitle = (d) => d.tabTitle || `[${d.key}] ${d.summary}`;

const createItemApi = profile.id === 'gitlab' ? createGitlabApi : createJiraApi;
const getItemApi = () =>
  (jiraApi && jiraApi.site === site ? jiraApi : (jiraApi = createItemApi({ session: session.fromPartition(PARTITION), site })));

function addLightTab(url, { index = tabs.length, activate = true, openerId = null, title = '' } = {}) {
  const key = rules.lightKeyOf(url);
  const cached = issueCache.get(key)?.data;
  const tab = {
    id: nextId++, view: null, light: true, url, title: cached ? issueTitle(cached) : title || key, favicon: null,
    loading: false, openerId, loadedOnce: true, navIndex: 0, ignoreNavUntil: 0, untouched: false,
    pinned: false, pinUrl: null, lastSeen: Date.now(), closing: false,
  };
  tabs.splice(Math.max(pinnedCount(), Math.min(index, tabs.length)), 0, tab);
  if (activate || !activeId) activateTab(tab.id);
  else sendState();
  if (!cached) warmIssue(key);
  return tab;
}

function getLightView() {
  if (lightView && !lightView.webContents.isDestroyed()) return lightView;
  lightView = new WebContentsView({
    webPreferences: {
      partition: LIGHT_PARTITION,
      preload: path.join(__dirname, 'preload-light.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  lightView.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#22272b' : '#ffffff');
  lightView.setVisible(false);
  win.contentView.addChildView(lightView);
  const wc = lightView.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event) => event.preventDefault());
  wc.on('context-menu', (_e, params) => {
    const tab = activeTab();
    if (tab?.light) showContextMenu(tab, params, wc);
  });
  wc.on('found-in-page', (_e, result) => {
    if (!findState || !activeTab()?.light) return;
    findState.matches = result.matches;
    findState.ordinal = result.activeMatchOrdinal;
    sendState();
  });
  lightReady = wc.loadURL('jira-tabs-light://app/index.html').catch(() => {});
  return lightView;
}

function showLight(tab) {
  const view = getLightView();
  const ready = lightReady;
  ready.then(() => {
    if (lightView === view && activeId === tab.id && tab.light) {
      view.webContents.send('show', { key: rules.lightKeyOf(tab.url), url: tab.url, app: profile.name });
    }
  });
}

// The issue's data, from the cache when it's less than a minute old (unless `fresh`).
async function fetchIssue(key, { fresh = false } = {}) {
  const hit = issueCache.get(key);
  if (hit && !fresh && Date.now() - hit.at < 60_000) return hit;
  if (issueFetches.has(key)) return issueFetches.get(key);
  const fetching = getItemApi().issue(key).then((data) => {
    const entry = { data, at: Date.now() };
    issueCache.set(key, entry);
    while (issueCache.size > 100) issueCache.delete(issueCache.keys().next().value);
    // Name the tabs showing it (and follow an issue that moved to another key).
    for (const t of tabs) {
      if (!t.light || rules.lightKeyOf(t.url) !== key) continue;
      t.title = issueTitle(data);
      if (String(data.id ?? data.key).toLowerCase() !== key.toLowerCase()) t.url = data.url;
    }
    sendState();
    return entry;
  }).finally(() => issueFetches.delete(key));
  issueFetches.set(key, fetching);
  return fetching;
}
const warmIssue = (key) => fetchIssue(key).catch(() => {});

// A light tab becomes the real Jira or GitLab page, and back.
// Its page may already be loaded (you pointed at a link to it, or at "Open full Jira").
function makeFull(tab) {
  if (!tab?.light) return;
  const ready = takePreloaded(tab.url);
  const view = ready?.view || createPageView();
  const wc = view.webContents;
  Object.assign(tab, {
    light: false, view, loading: ready ? wc.isLoading() : true, loadedOnce: !!ready && !wc.isLoading(),
    navIndex: ready ? wc.navigationHistory.getActiveIndex() : 0, ignoreNavUntil: 0,
  });
  if (ready) Object.assign(tab, { url: ready.url, title: ready.title || tab.title, favicon: ready.favicon });
  wireTab(tab);
  if (ready) {
    wc.setBackgroundThrottling(!TEST);
    wc.setAudioMuted(false);
  } else {
    wc.loadURL(tab.url).catch(() => {});
  }
  if (tab.id === activeId) {
    layout();
    view.webContents.focus();
  }
  sendState();
}

function makeLight(tab) {
  if (!tab || tab.light || tab.pinned || tab.closing || !lightIssues || !rules.lightKeyOf(tab.url)) return;
  if (tab.asleep) {
    Object.assign(tab, { light: true, asleep: false, favicon: null });
    if (tab.id === activeId) showLight(tab);
    return sendState();
  }
  const wc = tab.view.webContents;
  tab.closing = true;
  // The page may ask to keep unsaved changes; then it stays as it is.
  const kept = () => {
    tab.closing = false;
    wc.off('destroyed', gone);
  };
  const gone = () => {
    wc.off('will-prevent-unload', kept);
    detachView(tab.view);
    Object.assign(tab, { light: true, view: null, loading: false, loadedOnce: true, closing: false, favicon: null });
    if (tab.id === activeId) {
      showLight(tab);
      layout();
      pageWc(tab)?.focus();
    }
    sendState();
  };
  wc.once('will-prevent-unload', kept);
  wc.once('destroyed', gone);
  wc.close({ waitForBeforeUnload: true });
}

function reloadTab(tab, { force = false } = {}) {
  if (!tab) return;
  if (tab.asleep) return activateTab(tab.id);
  if (tab.light) {
    issueCache.delete(rules.lightKeyOf(tab.url));
    if (tab.id === activeId) pageWc(tab)?.send('command', 'refresh');
  } else if (force) {
    tab.view.webContents.reloadIgnoringCache();
  } else {
    tab.view.webContents.reload();
  }
}

function setLightIssues(on) {
  lightIssues = rules.canLight && on;
  saveSettings();
  buildMenu();
}

// The light view's files, and images from the Jira or GitLab site for it (fetched with your sign-in;
// only images are passed on). The light view has no permissions and keeps nothing.
const LIGHT_FILES = { '/index.html': 'text/html', '/light.css': 'text/css', '/light.js': 'text/javascript' };
function serveLightView() {
  const ses = session.fromPartition(LIGHT_PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.protocol.handle('jira-tabs-light', (request) => {
    const { pathname } = new URL(request.url);
    const type = LIGHT_FILES[pathname];
    if (!type) return new Response('Not found', { status: 404 });
    return new Response(fs.readFileSync(path.join(__dirname, 'light', pathname.slice(1))), {
      headers: { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' },
    });
  });
  ses.protocol.handle('site-media', async (request) => {
    const u = new URL(request.url);
    if (u.host !== 'site' || !site || request.method !== 'GET') return new Response(null, { status: 404 });
    try {
      const res = await getItemApi().media(u.pathname + u.search);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !/^image\//i.test(type)) return new Response(null, { status: res.ok ? 415 : res.status });
      return new Response(res.body, {
        headers: {
          'Content-Type': type,
          'Cache-Control': 'private, max-age=3600',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response(null, { status: 502 });
    }
  });
}

const fromLight = (event) => !!lightView && !lightView.webContents.isDestroyed() && event.sender === lightView.webContents;

ipcMain.handle('light', async (event, name, arg) => {
  if (!fromLight(event)) return { ok: false, error: 'Not allowed.' };
  const key = String(arg?.key || '');
  if (!rules.isLightKey(key) || !site) return { ok: false, error: 'That isn’t an issue key.' };
  try {
    switch (name) {
      case 'issue': {
        const { data, at } = await fetchIssue(key, { fresh: !!arg.fresh });
        return { ok: true, data, at };
      }
      // GitLab's come with the item's data (null here).
      case 'transitions': {
        const api = getItemApi();
        return { ok: true, data: api.transitions ? await api.transitions(key) : null };
      }
      case 'transition':
        await getItemApi().transition(key, String(arg.id));
        issueCache.delete(key);
        return { ok: true };
      case 'comment': {
        const text = String(arg.text || '').slice(0, 32_000);
        if (!text.trim()) return { ok: false, error: 'The comment is empty.' };
        await getItemApi().comment(key, text);
        issueCache.delete(key);
        return { ok: true };
      }
      default:
        return { ok: false, error: 'Unknown request.' };
    }
  } catch (err) {
    return { ok: false, error: err.message, signedOut: !!err.signedOut };
  }
});

// Links clicked in the light view follow the same rules as links in pages, except that nothing
// replaces the light view itself: other pages of the site open in new tabs.
ipcMain.on('light-open', (event, url, background) => {
  if (!fromLight(event)) return;
  const tab = activeTab();
  if (/^mailto:/i.test(url)) return openExternal(url);
  if (!/^https?:/i.test(url)) return;
  if (!rules.isInApp(url)) return openExternal(url);
  openUrl(url, { from: tab?.light ? tab : null, background: !!background, newTab: true });
});
ipcMain.on('light-full', (event) => {
  if (fromLight(event) && activeTab()?.light) makeFull(activeTab());
});
ipcMain.on('light-hover', (event, url) => {
  const tab = activeTab();
  if (!fromLight(event) || !tab?.light) return;
  if (url === null) preload(tab.url, tab, { self: true });
  else if (typeof url === 'string') preload(url, tab);
});
ipcMain.on('light-copy', (event, text) => {
  if (fromLight(event)) clipboard.writeText(String(text));
});

// ---------- loading issues before they're clicked ----------

// Pointing at a link to an item that would open in a new tab starts loading it in a hidden page.
// Clicking the link then turns that page into the tab, already loaded. At most PRELOAD_MAX at a
// time; each is thrown away PRELOAD_KEEP_MS after you last pointed at its link.
//
// The light tab you're on also has its full page loaded, out of sight, so "Open full Jira" /
// "Open full GitLab" shows it at once. That page is kept while you stay on the tab (it doesn't
// count towards PRELOAD_MAX) and thrown away PRELOAD_KEEP_MS after you leave.
const PRELOAD_MAX = 2;
const PRELOAD_KEEP_MS = TEST ? 4000 : 60_000;
const HOLD_DELAY_MS = TEST ? 300 : 1000; // the light view's own data comes first
const preloaded = new Map(); // key -> { view, url, title, favicon, timer, unwire }
let heldKey = null; // the full page kept for the light tab you're on
let holdTimer = null;

// An item that opens as a light tab gets its data fetched as well, and its full page is loaded
// too, so "Open full Jira" / "Open full GitLab" shows it at once. `self`: the light tab's own item
// (pointing at its "Open full …" button).
function preload(url, from, { self = false } = {}) {
  if (!win || !preloadLinks || !rules.isPreloadable(url)) return;
  const key = keyOf(url);
  if (!key || key.startsWith(PIN)) return;
  if (self ? !from.light || key !== keyOf(from.url) || findOpen(key, from) : key === keyOf(from.url) || findOpen(key, null)) return;
  const issueKey = lightIssues && rules.lightKeyOf(url);
  if (issueKey && !self) warmIssue(issueKey);
  const known = preloaded.get(key);
  if (known) return keepPreloaded(key, known);
  const others = [...preloaded.keys()].filter((k) => k !== heldKey);
  if (others.length >= PRELOAD_MAX) dropPreloaded(others[0]);

  const view = createPageView({ preloading: true });
  const { width, height } = win.getContentBounds();
  view.setBounds({ x: 0, y: TOP, width, height: Math.max(0, height - TOP) });
  const wc = view.webContents;
  const entry = { view, url, title: '', favicon: null, timer: null };
  const listeners = {
    'did-navigate': (_e, u) => (entry.url = u),
    'did-navigate-in-page': (_e, u, isMainFrame) => isMainFrame && (entry.url = u),
    'page-title-updated': (_e, title) => (entry.title = title),
    'page-favicon-updated': (_e, favicons) => (entry.favicon = pickFavicon(favicons)),
    'render-process-gone': () => dropPreloaded(key),
  };
  for (const [name, fn] of Object.entries(listeners)) wc.on(name, fn);
  entry.unwire = () => {
    for (const [name, fn] of Object.entries(listeners)) wc.off(name, fn);
  };
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.setAudioMuted(true);
  // Once loaded, it's slowed down like any page out of sight.
  if (!TEST) wc.once('did-stop-loading', () => !wc.isDestroyed() && wc.setBackgroundThrottling(true));
  preloaded.set(key, entry);
  keepPreloaded(key, entry);
  wc.loadURL(url).catch(() => {});
}

function keepPreloaded(key, entry) {
  clearTimeout(entry.timer);
  if (key !== heldKey) entry.timer = setTimeout(() => dropPreloaded(key), PRELOAD_KEEP_MS);
}

// Called whenever the tab you're on changes or shows another item: a light tab gets its full
// page loaded (shortly, after its own data); the page held for the light tab you left is kept
// for PRELOAD_KEEP_MS like any page loaded ahead.
function holdFullPage(tab) {
  const key = tab?.light ? keyOf(tab.url) : null;
  clearTimeout(holdTimer);
  if (heldKey && heldKey !== key) {
    const left = heldKey;
    heldKey = null;
    const entry = preloaded.get(left);
    if (entry) keepPreloaded(left, entry);
  }
  if (!key) return;
  heldKey = key;
  const known = preloaded.get(key);
  if (known) return keepPreloaded(key, known);
  holdTimer = setTimeout(() => {
    if (activeTab() === tab && tab.light && keyOf(tab.url) === key) preload(tab.url, tab, { self: true });
  }, HOLD_DELAY_MS);
}

// The page loaded ahead for this address, handed over to become a tab.
function takePreloaded(url) {
  const key = keyOf(url);
  const entry = key && preloaded.get(key);
  if (!entry) return null;
  // It ended up somewhere else (a moved issue, the sign-in page): load the link afresh instead.
  if (entry.view.webContents.isDestroyed() || keyOf(entry.url) !== key) {
    dropPreloaded(key);
    return null;
  }
  preloaded.delete(key);
  clearTimeout(entry.timer);
  entry.unwire();
  return entry;
}

function dropPreloaded(key) {
  const entry = preloaded.get(key);
  if (!entry) return;
  preloaded.delete(key);
  clearTimeout(entry.timer);
  entry.unwire();
  detachView(entry.view);
  if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
}

function setPreloadLinks(on) {
  preloadLinks = on;
  if (!on) for (const key of [...preloaded.keys()]) dropPreloaded(key);
  saveSettings();
  buildMenu();
}

ipcMain.on('link-hover', (event, url) => {
  const tab = tabOf(event.sender);
  if (tab && typeof url === 'string') preload(url, tab);
});

// Open an address of the site following the link rules. Returns the tab it ends up in.
function openUrl(url, { from = activeTab(), background = false, newTab = false } = {}) {
  const key = keyOf(url);
  const existing = key && findOpen(key, null);
  if (existing) {
    if (background) sendCommand('flash', existing.id);
    else activateTab(existing.id, { flash: existing.id !== activeId });
    return existing;
  }
  if (!key && !newTab && from && !from.pinned && from.view) {
    from.view.webContents.loadURL(url).catch(() => {});
    return from;
  }
  // New tabs go after the tab they were opened from (and after earlier ones opened from it).
  let index = tabs.length;
  if (from) {
    index = Math.max(tabs.indexOf(from) + 1, pinnedCount());
    while (index < tabs.length && tabs[index].openerId === from.id) index++;
  }
  return addTab(url, { index, activate: !background, openerId: from ? from.id : null });
}

// Outside links go to the web browser, or to the other app of the pair when it's installed.
const testOpenedExternally = [];
function openExternal(url, { handOff = true } = {}) {
  if (!/^(https?|mailto):/i.test(url)) return;
  let target = url;
  if (handOff && partnerRules().isSitePage(url) && partnerInstalled()) {
    target = `${partnerProfile.protocol}://open?url=${encodeURIComponent(url)}`;
  }
  if (TEST) {
    testOpenedExternally.push(target);
    return sendState();
  }
  shell.openExternal(target);
}

function activateTab(id, { flash = false } = {}) {
  const tab = tabById(id);
  if (!tab || !win) return;
  if (findState) stopFind();
  const previous = activeTab();
  if (previous) previous.lastSeen = Date.now();
  tab.lastSeen = Date.now();
  activeId = id;
  if (tab.asleep) wakeTab(tab);
  if (tab.light) showLight(tab);
  holdFullPage(tab);
  layout();
  if (!showingSetup) pageWc(tab)?.focus();
  if (flash) sendCommand('flash', id);
  sendState();
}

function closeTab(id, { remember = true } = {}) {
  const tab = tabById(id);
  if (!tab || tab.pinned) return;
  removeTab(tab, { remember });
  tab.view?.webContents.close();
}

// Takes a tab off the strip (its page is closed by the caller) and picks the next active tab.
function removeTab(tab, { remember = true } = {}) {
  const i = tabs.indexOf(tab);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (remember && tab.url && tab.url !== BLANK) closedUrls.push(tab.url);
  if (closedUrls.length > 25) closedUrls.shift();
  for (const t of tabs) if (t.openerId === tab.id) t.openerId = null;
  detachView(tab.view);
  if (!tabs.length) {
    win?.close();
    return;
  }
  if (activeId === tab.id) {
    // Like a browser: go back to the tab that opened this one, else the neighbour.
    const next = (tab.openerId && tabById(tab.openerId)) || tabs[Math.min(i, tabs.length - 1)];
    activateTab(next.id);
  } else {
    sendState();
  }
}

// ---------- sleeping and closing unused tabs ----------

// Tabs you haven't looked at for `sleepAfterMinutes` go to sleep: the page is closed, freeing its
// memory, and the tab stays in the strip with its title until you open it again, which reloads
// it. After `closeAfterMinutes` they close (⇧⌘T brings them back).
// Never the tab you're on, pinned tabs, a tab playing sound or with developer tools open, or a
// page that asks to keep unsaved changes (it's asked again after another while).
function tidyTabs() {
  if (!win) return;
  const now = Date.now();
  const due = (minutes, tab) => minutes > 0 && now - tab.lastSeen > minutes * 60_000;
  for (const tab of [...tabs]) {
    if (tab.id === activeId || tab.pinned || tab.closing) continue;
    // Light tabs have no page to put to sleep: they just close.
    if (due(closeAfterMinutes, tab)) {
      if (tab.asleep || tab.light) removeTab(tab);
      else unloadPage(tab, () => removeTab(tab));
    } else if (!tab.asleep && !tab.light && due(sleepAfterMinutes, tab)) {
      unloadPage(tab, () => sleptTab(tab));
    }
  }
}

// Close a tab's page, then call `done`; unless the page refuses (unsaved changes) or is busy.
function unloadPage(tab, done) {
  const wc = tab.view.webContents;
  if (wc.isDestroyed() || wc.isCurrentlyAudible() || wc.isDevToolsOpened()) return;
  tab.closing = true;
  const kept = () => {
    tab.closing = false;
    tab.lastSeen = Date.now();
    wc.off('destroyed', gone);
  };
  const gone = () => {
    wc.off('will-prevent-unload', kept);
    tab.closing = false;
    done();
  };
  wc.once('will-prevent-unload', kept);
  wc.once('destroyed', gone);
  wc.close({ waitForBeforeUnload: true });
}

function sleptTab(tab) {
  if (!tabs.includes(tab)) return;
  detachView(tab.view);
  Object.assign(tab, { view: null, asleep: true, loading: false, loadedOnce: false, navIndex: 0 });
  // You opened it while it was falling asleep.
  if (tab.id === activeId) {
    wakeTab(tab);
    layout();
  }
  sendState();
}

function wakeTab(tab) {
  const view = createPageView();
  Object.assign(tab, { view, asleep: false, loading: true, loadedOnce: false, navIndex: 0, ignoreNavUntil: 0 });
  wireTab(tab);
  view.webContents.loadURL(tab.url).catch(() => {});
}

const CLOSE_AFTER_CHOICES = [[0, 'Never'], [5, '5 Minutes'], [10, '10 Minutes'], [15, '15 Minutes'],
  [30, '30 Minutes'], [60, '1 Hour'], [240, '4 Hours']];
const SLEEP_AFTER_CHOICES = [[0, 'Never'], [1, '1 Minute'], [2, '2 Minutes'], [5, '5 Minutes'], [10, '10 Minutes'],
  [15, '15 Minutes'], [30, '30 Minutes'], [60, '1 Hour']];

function setCloseAfter(minutes) {
  const value = validMinutes(minutes);
  if (value === null) return;
  closeAfterMinutes = value;
  saveSettings();
  buildMenu();
  tidyTabs();
}

function setSleepAfter(minutes) {
  const value = validMinutes(minutes);
  if (value === null) return;
  sleepAfterMinutes = value;
  saveSettings();
  buildMenu();
  tidyTabs();
}

function moveTab(id, toIndex) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [tab] = tabs.splice(i, 1);
  // Pinned tabs stay in front of the others.
  const first = tab.pinned ? 0 : pinnedCount();
  const last = tab.pinned ? pinnedCount() : tabs.length;
  tabs.splice(Math.max(first, Math.min(toIndex, last)), 0, tab);
  tab.openerId = null;
  sendState();
}

function setPinned(id, on) {
  const tab = tabById(id);
  if (!tab || tab.pinned === on || !rules.isInApp(tab.url)) return;
  // Pinned tabs show the real page.
  if (on && tab.light) makeFull(tab);
  tabs.splice(tabs.indexOf(tab), 1);
  if (on) {
    tab.pinUrl = tab.url.replace(/#.*$/, '');
    pinnedUrls = [...pinnedUrls.filter((u) => pagePath(u) !== pagePath(tab.pinUrl)), tab.pinUrl];
  } else {
    pinnedUrls = pinnedUrls.filter((u) => pagePath(u) !== pagePath(tab.pinUrl));
    tab.pinUrl = null;
  }
  tab.pinned = on;
  tab.openerId = null;
  tabs.splice(pinnedCount(), 0, tab);
  // Pinned tabs stay awake.
  if (on && tab.asleep) wakeTab(tab);
  saveSettings();
  sendState();
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  const bounds = { x: 0, y: TOP, width, height: Math.max(0, height - TOP) };
  for (const t of tabs) {
    if (!t.view) continue;
    const visible = t.id === activeId && !showingSetup;
    t.view.setVisible(visible);
    if (visible) t.view.setBounds(bounds);
  }
  if (lightView && !lightView.webContents.isDestroyed()) {
    const visible = !!activeTab()?.light && !showingSetup;
    lightView.setVisible(visible);
    if (visible) lightView.setBounds(bounds);
  }
}

function showSetup(on) {
  showingSetup = on;
  layout();
  sendState();
  if (on) win?.webContents.focus();
}

// ---------- filling sign-ins from 1Password ----------

const testNotices = [];
let filling = false;

// The page to fill: a sign-in pop-up window if that's in front, otherwise the active tab.
function signInTarget() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && focused !== win && focused.getParentWindow() === win) return focused.webContents;
  const tab = activeTab();
  return tab && !showingSetup ? tab.view?.webContents || null : null;
}

function chooseSignIn(items) {
  return new Promise((resolve) => {
    Menu.buildFromTemplate([
      { label: 'Fill With', enabled: false },
      ...items.map((it) => ({
        label: it.additional_information ? `${it.title} — ${it.additional_information}` : it.title,
        click: () => resolve(it),
      })),
    ]).popup({ window: BrowserWindow.getFocusedWindow() || win, callback: () => setTimeout(() => resolve(null), 200) });
  });
}

async function fillSignIn(wc, testOp) {
  if (!wc || wc.isDestroyed() || filling) return;
  filling = true;
  let result;
  try {
    const opPath = TEST ? (testOp === 'none' ? null : testOp || process.env.TABS_TEST_OP || null) : passwords.findOp();
    result = await passwords.fill(wc, { opPath, choose: chooseSignIn });
  } catch (err) {
    result = { message: 'Couldn’t fill the sign-in.', detail: err.message };
  } finally {
    filling = false;
  }
  if (result.ok || result.cancelled) {
    if (TEST) testNotices.push(result.ok ? 'filled' : 'cancelled');
    return sendState();
  }
  if (TEST) {
    testNotices.push(result.message);
    return sendState();
  }
  const owner = BrowserWindow.fromWebContents(wc) || win;
  const { response } = await dialog.showMessageBox(owner, {
    type: 'info',
    message: result.message,
    detail: result.detail,
    buttons: result.needsSetup ? ['OK', 'How to Set It Up'] : ['OK'],
    defaultId: 0,
  });
  if (response === 1) shell.openExternal(passwords.SETUP_URL);
}

// ---------- address box, find, history ----------

function go(text) {
  const tab = activeTab();
  const url = rules.resolveInput(text, tab?.url);
  if (!url) return;
  if (!rules.isInApp(url)) return openExternal(url);
  const key = keyOf(url);
  const existing = key && findOpen(key, tab);
  if (existing) {
    activateTab(existing.id, { flash: true });
    // A new tab you'd just opened to type this into isn't needed any more.
    if (tab?.untouched) closeTab(tab.id, { remember: false });
    return;
  }
  // An issue opens as a light tab: in the light tab you're on, in place of a new empty tab, or
  // next to the page you're on.
  if (lightIssues && rules.lightKeyOf(url)) {
    if (tab?.light) {
      tab.url = url;
      const cached = issueCache.get(rules.lightKeyOf(url))?.data;
      tab.title = cached ? issueTitle(cached) : rules.lightKeyOf(url);
      showLight(tab);
      holdFullPage(tab);
      if (!cached) warmIssue(rules.lightKeyOf(url));
      pageWc(tab)?.focus();
      return sendState();
    }
    if (tab?.untouched) {
      addTab(url, { index: tabs.indexOf(tab) + 1 });
      return closeTab(tab.id, { remember: false });
    }
    return openUrl(url, { from: tab, newTab: true });
  }
  // Other pages can't show in the light view.
  if (!tab || tab.pinned || tab.light) return openUrl(url, { from: tab, newTab: true });
  tab.untouched = false;
  tab.view.webContents.loadURL(url).catch(() => {});
  tab.view.webContents.focus();
}

function goHome() {
  const pinned = tabs.find((t) => t.pinned);
  if (pinned) activateTab(pinned.id);
  else if (site) go(rules.home);
}

function history(dir) {
  const tab = activeTab();
  if (!tab?.view) return;
  const h = tab.view.webContents.navigationHistory;
  tab.ignoreNavUntil = Date.now() + 1500;
  if (dir < 0 && h.canGoBack()) h.goBack();
  if (dir > 0 && h.canGoForward()) h.goForward();
}

function find(text, { forward = true, findNext = false } = {}) {
  const wc = pageWc(activeTab());
  if (!wc) return;
  if (!text) return stopFind(false);
  findState = { text, matches: findState?.matches ?? 0, ordinal: findState?.ordinal ?? 0 };
  wc.findInPage(text, { forward, findNext });
  sendState();
}

function stopFind(close = true) {
  pageWc(activeTab())?.stopFindInPage('keepSelection');
  findState = close ? null : { text: '', matches: 0, ordinal: 0 };
  sendState();
}

function zoom(delta) {
  const wc = pageWc(activeTab());
  if (!wc) return;
  wc.setZoomLevel(delta === 0 ? 0 : Math.max(-5, Math.min(5, wc.getZoomLevel() + delta)));
}

function reopenClosed() {
  if (closedUrls.length && win) openUrl(closedUrls.pop(), { newTab: true });
}

// A new tab starts empty with the address box ready: type an issue, an address or a search.
function newTab() {
  const current = activeTab();
  const tab = addTab(BLANK, { untouched: true, index: current ? tabs.indexOf(current) + 1 : tabs.length });
  win.webContents.focus();
  sendCommand('focus-address');
  return tab;
}

function setSite(input) {
  const next = normalizeSite(input);
  if (!next) return sendCommand('setup-error', `Enter your ${profile.name} address, e.g. ${profile.sitePlaceholder}`);
  const changed = next !== site;
  rules = createRules(profile.id, next);
  site = rules.site;
  // On first use, the pages the config pins (e.g. "/jira/for-you") on the site you entered.
  if (changed) pinnedUrls = pinnedUrls.length ? pinnedUrls.filter((u) => rules.isInApp(u)) : resolvePins(defaults.pinned);
  saveSettings();
  showSetup(false);
  for (const url of pinnedUrls) {
    if (!tabs.some((t) => t.pinned && pagePath(t.pinUrl) === pagePath(url))) addTab(url, { pinned: true, activate: false });
  }
  if (changed || !tabs.length) addTab(rules.home);
}

// ---------- talking to the tab strip ----------

function sendState() {
  if (!win || !uiReady) return;
  const tab = activeTab();
  const h = tab?.view?.webContents.navigationHistory;
  win.webContents.send('state', {
    site,
    profile: {
      name: profile.name,
      productName: profile.productName,
      addressPlaceholder: profile.addressPlaceholder,
      siteLabel: profile.siteLabel,
      sitePlaceholder: profile.sitePlaceholder,
    },
    setup: showingSetup,
    activeId,
    url: tab && tab.url !== BLANK ? tab.url : '',
    canGoBack: !!h?.canGoBack(),
    canGoForward: !!h?.canGoForward(),
    loading: !!tab?.loading,
    find: findState,
    ...(TEST ? { testOpenedExternally, testNotices } : {}),
    tabs: tabs.map((t) => ({
      id: t.id,
      title: t.title || (t.url === BLANK ? 'New Tab' : t.url.replace(/^https:\/\//, '')),
      url: t.url === BLANK ? '' : t.url,
      favicon: t.favicon,
      loading: t.loading,
      pinned: t.pinned,
      asleep: !!t.asleep,
      light: !!t.light,
      item: rules.labelOf(t.url),
    })),
  });
  saveSessionSoon();
}

function sendCommand(name, arg) {
  win?.webContents.send('command', name, arg);
}

ipcMain.on('ui', (event, name, arg) => {
  if (!win || event.sender !== win.webContents) return;
  const tab = activeTab();
  switch (name) {
    case 'activate': return activateTab(Number(arg));
    case 'close': return closeTab(Number(arg));
    case 'move': return moveTab(Number(arg?.id), Number(arg?.index));
    case 'pin': return setPinned(Number(arg?.id), !!arg?.on);
    case 'tab-menu': return showTabMenu(Number(arg));
    case 'new-tab': return newTab();
    case 'reopen': return reopenClosed();
    case 'back': return history(-1);
    case 'forward': return history(1);
    case 'reload': return reloadTab(tab);
    case 'stop': return tab?.view?.webContents.stop();
    case 'go': return go(String(arg || ''));
    case 'home': return goHome();
    case 'open-in-browser': return tab?.url !== BLANK && tab && openExternal(tab.url, { handOff: false });
    case 'copy-link': return tab?.url !== BLANK && tab && clipboard.writeText(tab.url);
    case 'find': return find(String(arg?.text || ''), { forward: arg?.forward !== false, findNext: !!arg?.next });
    case 'stop-find': return stopFind();
    case 'focus-page': return pageWc(tab)?.focus();
    case 'set-site': return setSite(String(arg || ''));
    case 'cancel-setup': return site && showSetup(false);
    case 'test-close-after': return TEST && setCloseAfter(Number(arg));
    case 'test-sleep-after': return TEST && setSleepAfter(Number(arg));
    case 'test-preload': return TEST && setPreloadLinks(!!arg);
    case 'test-fill': return TEST && fillSignIn(tab?.view?.webContents, arg?.op);
    case 'test-light': return TEST && setLightIssues(!!arg);
    case 'test-toggle-light': return TEST && tab && (tab.light ? makeFull(tab) : makeLight(tab));
    default:
  }
});

// ---------- menus ----------

function showTabMenu(id) {
  const tab = tabById(id);
  if (!tab || !win) return;
  const others = tabs.filter((t) => t !== tab && !t.pinned);
  const right = tabs.slice(tabs.indexOf(tab) + 1).filter((t) => !t.pinned);
  Menu.buildFromTemplate([
    { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', enabled: rules.isInApp(tab.url), click: () => setPinned(id, !tab.pinned) },
    ...(tab.light ? [{ label: `Open in Full ${profile.name}`, click: () => makeFull(tab) }]
      : lightIssues && !tab.pinned && rules.lightKeyOf(tab.url) ? [{ label: 'Show Light View', click: () => makeLight(tab) }] : []),
    { label: 'Reload', click: () => reloadTab(tab) },
    { label: 'Copy Link', enabled: tab.url !== BLANK, click: () => clipboard.writeText(tab.url) },
    { label: 'Open in Browser', enabled: tab.url !== BLANK, click: () => openExternal(tab.url, { handOff: false }) },
    { type: 'separator' },
    { label: 'Close Tab', enabled: !tab.pinned, click: () => closeTab(id) },
    { label: 'Close Other Tabs', enabled: others.length > 0, click: () => others.forEach((t) => closeTab(t.id)) },
    { label: 'Close Tabs to the Right', enabled: right.length > 0, click: () => right.forEach((t) => closeTab(t.id)) },
  ]).popup({ window: win });
}

function showContextMenu(tab, p, wc = tab.view.webContents) {
  const items = [];
  if (p.linkURL && /^https?:/i.test(p.linkURL)) {
    if (rules.isInApp(p.linkURL)) {
      items.push({ label: 'Open Link in New Tab', click: () => openUrl(p.linkURL, { from: tab, newTab: true, background: true }) });
    }
    items.push({ label: 'Open Link in Browser', click: () => openExternal(p.linkURL, { handOff: false }) });
    items.push({ label: 'Copy Link Address', click: () => clipboard.writeText(p.linkURL) });
    items.push({ type: 'separator' });
  }
  if (p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    items.push({ label: 'Add to Dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    items.push({ type: 'separator' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push({ label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) });
    items.push({ type: 'separator' });
  }
  if (p.isEditable) {
    if (!p.formControlType || p.formControlType.startsWith('input-')) {
      items.push({ label: 'Fill From 1Password', click: () => fillSignIn(wc) }, { type: 'separator' });
    }
    items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
  } else if (p.selectionText) {
    items.push({ role: 'copy' });
  } else if (!p.linkURL) {
    items.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => history(-1) },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => history(1) },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Copy Page Link', click: () => clipboard.writeText(tab.url) },
      { label: 'Open Page in Browser', click: () => openExternal(tab.url, { handOff: false }) },
    );
  }
  while (items.length && items[items.length - 1].type === 'separator') items.pop();
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

function buildMenu() {
  const onTab = (fn) => () => {
    const t = activeTab();
    if (t && t.url !== BLANK) fn(t);
  };
  const hidden = (accelerator, click) => ({ label: accelerator, accelerator, click, visible: false, acceleratorWorksWhenHidden: true });
  const tabShortcuts = [];
  for (let n = 1; n <= 9; n++) {
    tabShortcuts.push(hidden(`CmdOrCtrl+${n}`, () => {
      const t = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
      if (t) activateTab(t.id);
    }));
  }
  const cycle = (dir) => () => {
    if (tabs.length < 2) return;
    const i = tabs.findIndex((t) => t.id === activeId);
    activateTab(tabs[(i + dir + tabs.length) % tabs.length].id);
  };
  const changeSite = { label: `Change ${profile.name} Site…`, click: () => showSetup(true) };
  // A submenu of choices, plus the current value if it was set to something else in a file.
  const minutesMenu = (label, choices, current, set) => ({
    label,
    submenu: (choices.some(([m]) => m === current) ? choices : [...choices, [current, `${current} Minutes`]].sort((a, b) => a[0] - b[0]))
      .map(([minutes, text]) => ({ label: text, type: 'radio', checked: minutes === current, click: () => set(minutes) })),
  });
  const tabTimers = [
    minutesMenu('Put Unused Tabs to Sleep After', SLEEP_AFTER_CHOICES, sleepAfterMinutes, setSleepAfter),
    minutesMenu('Close Unused Tabs After', CLOSE_AFTER_CHOICES, closeAfterMinutes, setCloseAfter),
  ];
  const preloadItem = rules.canPreload
    ? [{ label: profile.preloadLabel, type: 'checkbox', checked: preloadLinks, click: (item) => setPreloadLinks(item.checked) }]
    : [];
  if (rules.canLight) {
    preloadItem.push({ label: profile.lightLabel, type: 'checkbox', checked: lightIssues, click: (item) => setLightIssues(item.checked) });
  }
  const lightToggle = rules.canLight
    ? [{ label: `Switch Between Light View and Full ${profile.name}`, accelerator: 'CmdOrCtrl+Shift+J', click: onTab((t) => (t.light ? makeFull(t) : makeLight(t))) },
      { type: 'separator' }]
    : [];
  const template = [
    ...(IS_MAC ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        changeSite,
        ...tabTimers,
        ...preloadItem,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => (win ? newTab() : createWindow()) },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: reopenClosed },
        { label: 'Open Address or Search…', accelerator: 'CmdOrCtrl+L', click: () => { win?.webContents.focus(); sendCommand('focus-address'); } },
        { type: 'separator' },
        { label: 'Copy Page Link', accelerator: 'CmdOrCtrl+Shift+C', click: onTab((t) => clipboard.writeText(t.url)) },
        { label: 'Open Page in Browser', accelerator: 'CmdOrCtrl+Shift+O', click: onTab((t) => openExternal(t.url, { handOff: false })) },
        { label: 'Pin or Unpin Tab', accelerator: 'CmdOrCtrl+Shift+P', click: onTab((t) => setPinned(t.id, !t.pinned)) },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => (activeId ? closeTab(activeId) : win?.close()) },
        ...(IS_MAC ? [] : [changeSite, ...tabTimers, ...preloadItem, { type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Fill Sign-in From 1Password', accelerator: 'CmdOrCtrl+Shift+F', click: () => fillSignIn(signInTarget()) },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => { win?.webContents.focus(); sendCommand('find'); } },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => findState?.text && find(findState.text, { findNext: true }) },
        { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', click: () => findState?.text && find(findState.text, { forward: false, findNext: true }) },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...lightToggle,
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: onTab((t) => reloadTab(t)) },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: onTab((t) => reloadTab(t, { force: true })) },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) },
        hidden('CmdOrCtrl+Plus', () => zoom(0.5)),
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Developer Tools for This Page', accelerator: IS_MAC ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: onTab((t) => pageWc(t)?.toggleDevTools()) },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => history(-1) },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => history(1) },
        hidden(IS_MAC ? 'Cmd+Left' : 'Alt+Left', () => history(-1)),
        hidden(IS_MAC ? 'Cmd+Right' : 'Alt+Right', () => history(1)),
        { label: `${profile.name} Home`, accelerator: 'CmdOrCtrl+Shift+H', click: goHome },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: cycle(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: cycle(-1) },
        hidden('CmdOrCtrl+Alt+Right', cycle(1)),
        hidden('CmdOrCtrl+Alt+Left', cycle(-1)),
        hidden('CmdOrCtrl+Shift+]', cycle(1)),
        hidden('CmdOrCtrl+Shift+[', cycle(-1)),
        ...tabShortcuts,
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- links from other apps ----------

function openFromOutside(link) {
  if (!app.isReady() || !win || !uiReady || !site) {
    pendingLinks.push(link);
    if (app.isReady() && !win) createWindow();
    return;
  }
  const url = rules.fromOutside(link);
  if (!url) return;
  openUrl(url, { newTab: true, from: null });
  if (win.isMinimized()) win.restore();
  if (!TEST) {
    win.show();
    if (IS_MAC) app.focus({ steal: true });
  }
}

const linkArg = (argv) => argv.find((a) => a.startsWith(`${PROTOCOL}://`) || (/^https:\/\//i.test(a) && rules.isInApp(a)));

// ---------- saving tabs ----------

let saveTimer = null;
function saveSessionSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, 1000);
}
function saveSession() {
  if (!win) return;
  const active = activeTab();
  const saved = tabs.filter((t) => !t.pinned && rules.isInApp(t.url));
  writeJson(file('session.json'), {
    tabs: saved.map((t) => t.url),
    // So tabs that start asleep next time still show their titles.
    titles: Object.fromEntries(saved.filter((t) => t.title).map((t) => [t.url, t.title])),
    activeUrl: active?.url,
    bounds: win.isMaximized() || win.isFullScreen() ? readJson(file('session.json'), {}).bounds : win.getBounds(),
    maximized: win.isMaximized(),
  });
}

// ---------- start ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = linkArg(argv);
    if (link) return openFromOutside(link);
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    openFromOutside(url);
  });

  // Only the installed app claims its links, not a copy run from the source folder.
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);

  // Some sign-in pages refuse apps that announce themselves as Electron; present the same
  // user agent as Chrome.
  const platformPart = IS_MAC ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  app.userAgentFallback = `Mozilla/5.0 (${platformPart}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;

  app.whenReady().then(() => {
    const ses = session.fromPartition(PARTITION);
    const allowed = new Set(['clipboard-sanitized-write', 'notifications', 'fullscreen']);
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
    serveLightView();
    buildMenu();
    createWindow();
    setInterval(tidyTabs, TEST ? 500 : 30_000);
    const link = linkArg(process.argv);
    if (link) openFromOutside(link);
    app.on('activate', () => {
      if (!win) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!IS_MAC) app.quit();
  });
}
