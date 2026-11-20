// Runs in every Jira / GitLab tab, isolated from the site's own scripts, and gives the page
// nothing. On a plain click on a link it asks the app (synchronously, before the site's own
// scripts act on the click) whether the app handles it: a link to another issue or merge request
// gets its own tab, and a link to another website opens in the web browser. Everything else
// behaves as usual. Ctrl/Cmd/Shift/middle clicks and links that open a new tab are handled by
// the app separately.
//
// Resting the pointer on a link, or pressing the mouse button on it, also tells the app, which
// may start loading that issue so it shows at once when the link is clicked.
const { ipcRenderer } = require('electron');

const HOVER_MS = 150;
const anchorOf = (e) => e.composedPath().find((el) => el instanceof HTMLAnchorElement && el.href) || null;
const hint = (a) => /^https:/i.test(a.href) && ipcRenderer.send('link-hover', a.href);

let hovered = null;
let hoverTimer = null;
addEventListener('mouseover', (e) => {
  const a = window.opener ? null : anchorOf(e);
  if (a === hovered) return;
  hovered = a;
  clearTimeout(hoverTimer);
  if (a) hoverTimer = setTimeout(() => hint(a), HOVER_MS);
}, true);
addEventListener('mousedown', (e) => {
  const a = window.opener || e.button !== 0 ? null : anchorOf(e);
  if (!a) return;
  clearTimeout(hoverTimer);
  hint(a);
}, true);

addEventListener('click', (e) => {
  if (window.opener || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = anchorOf(e);
  if (!a || a.hasAttribute('download')) return;
  if (a.target && !['_self', '_top', '_parent'].includes(a.target)) return;
  if (ipcRenderer.sendSync('link-click', a.href) === 'handled') {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);
