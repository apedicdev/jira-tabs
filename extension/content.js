// Jira Tab Reuse, on Jira pages: a plain click on a link to another issue opens that issue in a
// new tab, or switches to the tab that already shows it, instead of replacing the page you're on.
// Ctrl/Cmd/Shift/middle clicks and links that already open a new tab are left to Chrome; the
// background script still switches to an existing tab for those.

const ISSUE_PATH = /^\/browse\/([a-z][a-z0-9_]*-\d+)\/?$/i;
const keyOf = (u) => ISSUE_PATH.exec(u.pathname)?.[1].toUpperCase() ?? null;

let enabled = true;
chrome.storage.local.get('enabled').then(({ enabled: on }) => { enabled = on !== false; }, () => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) enabled = changes.enabled.newValue !== false;
});

addEventListener('click', (e) => {
  if (!enabled || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.composedPath().find((el) => el instanceof HTMLAnchorElement && el.href);
  if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
  let url;
  try {
    url = new URL(a.href, location.href);
  } catch {
    return;
  }
  const key = url.origin === location.origin ? keyOf(url) : null;
  // Links to the issue you're on (e.g. to one of its comments) behave as usual.
  if (!key || key === keyOf(location)) return;
  // Runs before Jira's own handlers (capture phase on window), so Jira doesn't navigate this tab.
  e.preventDefault();
  e.stopImmediatePropagation();
  openIssue(url.href);
}, true);

// Jira has no web app manifest, so "Install page as app" only covers the folder of the page you
// installed from (e.g. /jira/), and issue pages (/browse/...) then open in Chrome instead of the app.
// Describe Jira as an app that covers the whole site and opens with tabs.
function addAppManifest() {
  if (document.querySelector('link[rel~="manifest"]')) return;
  const site = location.origin;
  const manifest = {
    id: '/jira-tab-reuse-app',
    name: 'Jira',
    short_name: 'Jira',
    start_url: `${site}/`,
    scope: `${site}/`,
    display: 'standalone',
    display_override: ['tabbed'],
    icons: [
      { src: APP_ICONS[192], sizes: '192x192', type: 'image/png' },
      { src: APP_ICONS[512], sizes: '512x512', type: 'image/png' },
    ],
  };
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}`;
  document.head.append(link);
}
if (document.head) addAppManifest();
else document.addEventListener('DOMContentLoaded', addAppManifest, { once: true });

async function openIssue(href) {
  let switched = false;
  try {
    switched = (await chrome.runtime.sendMessage({ type: 'open-issue', url: href }))?.switched;
  } catch {
    // The extension was reloaded or removed: just open the tab.
  }
  if (!switched) window.open(href, '_blank', 'noopener');
}
