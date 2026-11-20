// The tab strip and toolbar. The main process owns the tabs; this draws them and sends actions.
const api = window.jiraTabs;
const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const address = $('address');
const findbar = $('findbar');
const findInput = $('find-input');

document.body.classList.add(api.platform === 'darwin' ? 'mac' : 'other');
if (api.platform !== 'darwin') {
  // Show Ctrl instead of ⌘ in tooltips.
  for (const el of document.querySelectorAll('[title]')) el.title = el.title.replace(/⇧⌘/g, 'Ctrl+Shift+').replace(/⌘/g, 'Ctrl+');
}

let state = { tabs: [], activeId: null, url: '', find: null, setup: false, site: '' };
const tabEls = new Map();

let profileShown = '';
api.onState((next) => {
  state = next;
  if (state.profile && profileShown !== state.profile.productName) {
    // Words that differ between Jira Tabs and GitLab Tabs.
    profileShown = state.profile.productName;
    document.title = state.profile.productName;
    address.placeholder = state.profile.addressPlaceholder;
    $('setup-title').textContent = state.profile.productName;
    $('site-label').textContent = state.profile.siteLabel;
    $('site-input').placeholder = state.profile.sitePlaceholder;
  }
  render();
});

api.onCommand((name, arg) => {
  if (name === 'focus-address') {
    address.focus();
    address.select();
  } else if (name === 'find') {
    openFind();
  } else if (name === 'flash') {
    flash(arg);
  } else if (name === 'setup-error') {
    $('setup-error').textContent = arg;
  } else if (name === 'fullscreen') {
    document.body.classList.toggle('fullscreen', !!arg);
  }
});

// ---------- drawing ----------

function render() {
  const seen = new Set();
  state.tabs.forEach((t, i) => {
    seen.add(t.id);
    let el = tabEls.get(t.id);
    if (!el) {
      el = makeTab(t.id);
      tabEls.set(t.id, el);
    }
    el.setAttribute('aria-selected', String(t.id === state.activeId));
    el.classList.toggle('pinned', !!t.pinned);
    el.classList.toggle('asleep', !!t.asleep);
    el.draggable = true;
    el.title = [t.title, t.url, t.pinned ? 'Pinned' : '', t.asleep ? 'Asleep: reloads when you open it' : ''].filter(Boolean).join('\n');
    const title = el.querySelector('.tab-title');
    if (title.textContent !== t.title) title.textContent = t.title;
    const icon = el.querySelector('.tab-icon');
    const iconKey = t.loading ? 'loading' : t.favicon || 'none';
    if (icon.dataset.key !== iconKey) {
      icon.dataset.key = iconKey;
      icon.replaceChildren();
      if (t.loading) icon.append(Object.assign(document.createElement('span'), { className: 'spinner' }));
      else if (t.favicon) {
        const img = Object.assign(document.createElement('img'), { src: t.favicon, alt: '' });
        img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'dot' }));
        icon.append(img);
      }
      else icon.append(Object.assign(document.createElement('span'), { className: 'dot' }));
    }
    if (tabsEl.children[i] !== el) tabsEl.insertBefore(el, tabsEl.children[i] || null);
  });
  for (const [id, el] of tabEls) {
    if (!seen.has(id)) {
      el.remove();
      tabEls.delete(id);
    }
  }

  document.body.classList.toggle('loading', !!state.loading);
  $('back').disabled = !state.canGoBack;
  $('forward').disabled = !state.canGoForward;
  $('reload').title = state.loading ? 'Stop' : $('reload').dataset.title || ($('reload').dataset.title = $('reload').title);
  if (document.activeElement !== address) address.value = pretty(state.url);
  const active = state.tabs.find((t) => t.id === state.activeId);
  $('pin').setAttribute('aria-pressed', String(!!active?.pinned));
  $('pin').disabled = !state.url;
  $('pin').title = `${active?.pinned ? 'Unpin' : 'Pin'} tab (${api.platform === 'darwin' ? '⇧⌘P' : 'Ctrl+Shift+P'})`;
  for (const id of ['back', 'forward', 'reload', 'pin', 'copy-link', 'open-browser']) $(id).hidden = state.setup;
  address.parentElement.hidden = state.setup;

  if (state.find) {
    findbar.hidden = false;
    const f = state.find;
    $('find-count').textContent = !f.text ? '' : f.matches ? `${f.ordinal}/${f.matches}` : 'No results';
  } else {
    findbar.hidden = true;
  }

  const setup = $('setup');
  if (state.setup && setup.hidden) {
    setup.hidden = false;
    $('site-input').value = state.site ? state.site.replace(/^https:\/\//, '') : '';
    $('setup-cancel').hidden = !state.site;
    $('setup-error').textContent = '';
    $('site-input').focus();
  } else if (!state.setup) {
    setup.hidden = true;
  }
}

function makeTab(id) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.setAttribute('role', 'tab');
  el.draggable = true;
  el.dataset.id = id;
  el.innerHTML = '<span class="tab-icon"></span><span class="tab-title"></span>' +
    '<button class="tab-close" tabindex="-1" aria-label="Close tab" title="Close tab">' +
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>';
  return el;
}

const pretty = (url) => (url || '').replace(/^https:\/\//, '');

function flash(id) {
  const el = tabEls.get(id);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// ---------- tabs: activate, close, reorder ----------

tabsEl.addEventListener('mousedown', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab || e.button !== 0 || e.target.closest('.tab-close')) return;
  api.action('activate', Number(tab.dataset.id));
});
tabsEl.addEventListener('click', (e) => {
  const close = e.target.closest('.tab-close');
  if (close) api.action('close', Number(close.closest('.tab').dataset.id));
});
tabsEl.addEventListener('contextmenu', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  e.preventDefault();
  api.action('tab-menu', Number(tab.dataset.id));
});
tabsEl.addEventListener('auxclick', (e) => {
  const tab = e.target.closest('.tab');
  if (tab && e.button === 1) api.action('close', Number(tab.dataset.id));
});

let dragId = null;
const clearDrop = () => tabsEl.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
tabsEl.addEventListener('dragstart', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  dragId = Number(tab.dataset.id);
  tab.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragId));
});
tabsEl.addEventListener('dragover', (e) => {
  const tab = e.target.closest('.tab');
  if (dragId == null || !tab) return;
  e.preventDefault();
  clearDrop();
  const r = tab.getBoundingClientRect();
  tab.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
});
tabsEl.addEventListener('drop', (e) => {
  const tab = e.target.closest('.tab');
  if (dragId == null || !tab) return;
  e.preventDefault();
  const ids = state.tabs.map((t) => t.id).filter((id) => id !== dragId);
  let index = ids.indexOf(Number(tab.dataset.id));
  if (tab.classList.contains('drop-after')) index++;
  if (Number(tab.dataset.id) === dragId) index = state.tabs.findIndex((t) => t.id === dragId);
  api.action('move', { id: dragId, index });
});
tabsEl.addEventListener('dragend', () => {
  tabsEl.querySelector('.dragging')?.classList.remove('dragging');
  clearDrop();
  dragId = null;
});

// ---------- toolbar ----------

$('new-tab').addEventListener('click', () => api.action('new-tab'));
$('back').addEventListener('click', () => api.action('back'));
$('forward').addEventListener('click', () => api.action('forward'));
$('reload').addEventListener('click', () => api.action(state.loading ? 'stop' : 'reload'));
$('open-browser').addEventListener('click', () => api.action('open-in-browser'));
$('pin').addEventListener('click', () => {
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (active) api.action('pin', { id: active.id, on: !active.pinned });
});
$('copy-link').addEventListener('click', () => {
  api.action('copy-link');
  const b = $('copy-link');
  b.classList.add('done');
  setTimeout(() => b.classList.remove('done'), 1200);
});

$('address-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = address.value.trim();
  if (!text) return;
  address.blur();
  api.action('go', text);
});
address.addEventListener('focus', () => {
  address.value = state.url || '';
  requestAnimationFrame(() => address.select());
});
address.addEventListener('blur', () => {
  address.value = pretty(state.url);
});
// Clicking into the page moves focus out of this strip without blurring the box itself.
addEventListener('blur', () => {
  if (document.activeElement === address) address.blur();
});
address.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    address.value = state.url || '';
    api.action('focus-page');
  }
});

// ---------- find in page ----------

function openFind() {
  findbar.hidden = false;
  findInput.focus();
  findInput.select();
  if (!state.find) api.action('find', { text: findInput.value });
}
findInput.addEventListener('input', () => api.action('find', { text: findInput.value }));
findbar.addEventListener('submit', (e) => {
  e.preventDefault();
  api.action('find', { text: findInput.value, next: true });
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    api.action('find', { text: findInput.value, next: true, forward: false });
  } else if (e.key === 'Escape') {
    api.action('stop-find');
    api.action('focus-page');
  }
});
$('find-next').addEventListener('click', () => api.action('find', { text: findInput.value, next: true }));
$('find-prev').addEventListener('click', () => api.action('find', { text: findInput.value, next: true, forward: false }));
$('find-close').addEventListener('click', () => {
  api.action('stop-find');
  api.action('focus-page');
});

// ---------- first run ----------

$('setup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  api.action('set-site', $('site-input').value);
});
$('setup-cancel').addEventListener('click', () => api.action('cancel-setup'));
