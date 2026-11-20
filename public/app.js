// Jira Tabs: a tabbed Jira client. Each issue gets exactly one tab; opening an
// issue that already has a tab switches to that tab instead of adding another.

const STORE_KEY = 'jira-tabs:v1';
const STALE_MS = 2 * 60 * 1000; // refresh an issue in the background when it is older than this
const KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;
const FILTERS = [
  { label: 'Assigned to me', jql: 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC' },
  { label: 'Reported by me', jql: 'reporter = currentUser() ORDER BY created DESC' },
  { label: 'Watching', jql: 'watcher = currentUser() AND resolution = Unresolved ORDER BY updated DESC' },
  { label: 'Recently viewed', jql: 'issuekey in issueHistory() ORDER BY lastViewed DESC' },
];

const $ = (sel) => document.querySelector(sel);
const els = {
  tabs: $('#tabs'), content: $('#content'), empty: $('#empty'), sidebar: $('#sidebar'),
  form: $('#search-form'), input: $('#search-input'), filters: $('#filters'),
  meta: $('#results-meta'), results: $('#results'), whoami: $('#whoami'), toast: $('#toast'),
};
const narrow = matchMedia('(max-width: 820px)');
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const state = {
  tabs: [],      // { key, summary, status, type, data, transitions, loadedAt, loading, error, offline, draft, panel }
  active: null,  // key of the visible tab
  closed: [],    // recently closed keys, for Alt+Shift+T
  results: [],
  jql: FILTERS[0].jql,
  searchedAt: 0,
  site: '',
};
const jiraWindows = new Map(); // key → browser window opened with "Open in Jira"
let dragKey = null;
let searchSeq = 0;
let toastTimer = 0;

/* ------------------------------------------------ templating (interpolations are escaped unless raw) */

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(String(s ?? ''));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : v == null || v === false ? '' : esc(v));
const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? fmt(vals[i]) : ''), ''));

const icon = (d, size = 16) => raw(`<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
const ICON = {
  close: icon('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>', 14),
  external: icon('<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v4h-9v-9h4"/>'),
  link: icon('<path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 014 4l-1 1M9 11.5l-1 1a2.8 2.8 0 01-4-4l1-1"/>'),
  refresh: icon('<path d="M13.5 2.5v3.5H10M2.5 13.5V10H6"/><path d="M13 6A5.5 5.5 0 003.2 4.8M3 10a5.5 5.5 0 009.8 1.2"/>'),
  clip: icon('<path d="M13 7.5l-5.3 5.3a3.2 3.2 0 01-4.5-4.5L8.8 2.7a2.1 2.1 0 013 3L6.3 11.2a1 1 0 01-1.5-1.5L9.8 4.8"/>'),
};
const TYPE_GLYPH = {
  story: '<path d="M5 3.5h6v9l-3-2.2-3 2.2z" fill="currentColor"/>',
  bug: '<circle cx="8" cy="8" r="3.5" fill="currentColor"/>',
  task: '<path d="M4.5 8.3l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  epic: '<path d="M9.5 2.5L4.5 9h3.2L6.5 13.5 11.5 7H8.3z" fill="currentColor"/>',
  subtask: '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1" fill="currentColor"/><rect x="7" y="7" width="5.5" height="5.5" rx="1" fill="currentColor" fill-opacity=".6"/>',
};

/* ------------------------------------------------ boot (called at the end of the file) */

function boot() {
  restore();
  bindEvents();
  renderFilters();
  renderTabs();
  loadConfig();
  search(state.jql);

  const launchTarget = new URLSearchParams(location.search).get('open');
  if (launchTarget) history.replaceState(null, '', location.pathname);
  if (!launchTarget || !openFromText(launchTarget)) {
    if (state.active) activate(state.active);
    else showEmpty();
  }

  // Installed app + launch_handler "focus-existing": a link into the app reuses this
  // window, and the issue it points at reuses its tab.
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer((params) => {
      const target = params.targetURL && new URL(params.targetURL).searchParams.get('open');
      if (target) openFromText(target);
    });
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (isMac) {
    document.querySelectorAll('kbd[data-alt]').forEach((k) => { k.textContent = '⌥'; });
    document.querySelectorAll('kbd[data-mod]').forEach((k) => { k.textContent = '⌘'; });
  }
}

/* ------------------------------------------------ tabs */

function openIssue(rawKey, { background = false } = {}) {
  const key = String(rawKey).toUpperCase();
  const existing = state.tabs.find((t) => t.key === key);
  if (existing) {
    // Already open: reuse the tab instead of opening a duplicate.
    if (!background) activate(key);
    flash(key);
    return existing;
  }
  const hint = state.results.find((r) => r.key === key);
  const tab = addTab({ key, summary: hint?.summary, status: hint?.status, type: hint?.type });
  loadIssue(tab);
  if (background) {
    renderTabs();
    persist();
  } else {
    activate(key);
  }
  flash(key);
  return tab;
}

function addTab(info) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.hidden = true;
  panel.id = `panel-${info.key}`;
  panel.setAttribute('role', 'tabpanel');
  els.content.append(panel);
  const tab = {
    key: info.key, summary: info.summary || '', status: info.status || null, type: info.type || null,
    data: null, transitions: [], loadedAt: 0, loading: false, error: null, offline: false, draft: '', panel,
  };
  panel.addEventListener('input', (e) => { if (e.target.name === 'comment') tab.draft = e.target.value; });
  state.tabs.push(tab);
  return tab;
}

function activate(key) {
  const tab = tabByKey(key);
  if (!tab) return;
  state.active = key;
  for (const t of state.tabs) t.panel.hidden = t !== tab;
  els.empty.hidden = true;
  if (!tab.loading && (!tab.data || Date.now() - tab.loadedAt > STALE_MS)) loadIssue(tab, { silent: Boolean(tab.data) });
  else if (!tab.panel.hasChildNodes()) renderPanel(tab);
  renderTabs();
  persist();
  setTitle(tab);
  els.tabs.querySelector(`[data-key="${key}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (narrow.matches) document.body.classList.remove('sidebar-open');
}

function closeTab(key) {
  const i = state.tabs.findIndex((t) => t.key === key);
  if (i < 0) return;
  const [tab] = state.tabs.splice(i, 1);
  tab.panel.remove();
  state.closed = state.closed.filter((k) => k !== key).concat(key).slice(-20);
  if (state.active === key) {
    const next = state.tabs[i] || state.tabs[i - 1];
    if (next) activate(next.key);
    else showEmpty();
  }
  renderTabs();
  persist();
}

function reopenClosed() {
  const key = state.closed.pop();
  if (key) openIssue(key);
}

function cycle(step) {
  if (!state.tabs.length) return;
  const i = state.tabs.findIndex((t) => t.key === state.active);
  activate(state.tabs[(i + step + state.tabs.length) % state.tabs.length].key);
}

function showEmpty() {
  state.active = null;
  for (const t of state.tabs) t.panel.hidden = true;
  els.empty.hidden = false;
  document.title = 'Jira Tabs';
  renderTabs();
  persist();
}

function flash(key) {
  const el = els.tabs.querySelector(`[data-key="${key}"]`);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('flash');
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderTabs() {
  if (dragKey) return; // don't rebuild under a drag; dragend re-renders
  const focusedKey = document.activeElement?.closest?.('#tabs .tab')?.dataset.key;
  els.tabs.innerHTML = state.tabs.map((t) => html`
    <div class="tab${t.loading ? ' is-loading' : ''}${t.error && !t.data ? ' has-error' : ''}" role="tab" id="tab-${t.key}"
      data-key="${t.key}" aria-selected="${String(t.key === state.active)}" aria-controls="panel-${t.key}"
      tabindex="${t.key === state.active ? 0 : -1}" draggable="true" title="${t.summary ? `${t.key}: ${t.summary}` : t.key}">
      <span class="tab-dot" data-cat="${t.status?.category || 'none'}"></span>
      <span class="tab-key">${t.key}</span>
      <span class="tab-title">${t.summary}</span>
      <button class="tab-close" type="button" tabindex="-1" aria-label="Close ${t.key}" title="Close (${isMac ? '⌥' : 'Alt+'}W)">${ICON.close}</button>
    </div>`).join('');
  for (const t of state.tabs) t.panel.setAttribute('aria-labelledby', `tab-${t.key}`);
  if (focusedKey) els.tabs.querySelector(`[data-key="${focusedKey}"]`)?.focus();
  markOpen();
}

/* ------------------------------------------------ issue loading and rendering */

async function loadIssue(tab, { silent = false } = {}) {
  if (tab.loading) return;
  tab.loading = true;
  if (!tab.data || !silent) renderPanel(tab);
  else tab.panel.querySelector('.loaded')?.replaceChildren('Refreshing…');
  renderTabs();
  try {
    const [issue, tr] = await Promise.all([
      api(`/api/issue/${tab.key}`),
      api(`/api/issue/${tab.key}/transitions`).catch(() => ({ transitions: [] })),
    ]);
    Object.assign(tab, {
      data: issue, transitions: tr.transitions || [], offline: Boolean(issue._offline), error: null,
      loadedAt: Date.now(), summary: issue.summary, status: issue.status, type: issue.type,
    });
    updateResult(issue.key, { summary: issue.summary, status: issue.status, assignee: issue.assignee });
  } catch (err) {
    tab.error = err.message;
  }
  tab.loading = false;
  if (!state.tabs.includes(tab)) return; // closed while loading
  if (tab.data && tab.data.key !== tab.key) return rekey(tab, tab.data.key);
  renderPanel(tab);
  renderTabs();
  persist();
  if (tab.key === state.active) setTitle(tab);
}

// Jira redirects moved issues to their new key. Follow it, without creating a duplicate tab.
function rekey(tab, newKey) {
  const wasActive = state.active === tab.key;
  if (tabByKey(newKey)) {
    closeTab(tab.key);
    if (wasActive) activate(newKey);
    return;
  }
  tab.key = newKey;
  tab.panel.id = `panel-${newKey}`;
  if (wasActive) state.active = newKey;
  renderPanel(tab);
  renderTabs();
  persist();
}

function renderPanel(tab) {
  const { panel, data } = tab;
  const top = panel.scrollTop;
  panel.innerHTML = data ? issueView(tab) : tab.error ? errorView(tab) : skeletonView(tab);
  if (data) {
    for (const el of panel.querySelectorAll('[data-rich]')) {
      const id = el.dataset.rich;
      el.append(sanitize(id === 'description' ? data.descriptionHtml : data.comments[id]?.html));
    }
    const box = panel.querySelector('textarea[name="comment"]');
    if (box) box.value = tab.draft;
  }
  panel.scrollTop = top;
  markOpen(panel);
}

function issueView(tab) {
  const d = tab.data;
  return html`
  <article class="issue">
    ${tab.offline ? html`<div class="notice">You are offline. This is the copy saved ${ago(tab.loadedAt)}.</div>` : ''}
    ${tab.error ? html`<div class="notice is-error">Could not refresh: ${tab.error}</div>` : ''}
    <header class="issue-head">
      <nav class="crumbs" aria-label="Breadcrumb">
        ${d.parent ? html`<a class="crumb" href="${d.parent.url}" data-key="${d.parent.key}" title="${d.parent.summary}">${typeIcon(d.parent.type)}${d.parent.key}</a><span class="sep">/</span>` : ''}
        <span class="crumb is-current">${typeIcon(d.type)}${d.key}</span>
      </nav>
      <h1>${d.summary}</h1>
      <div class="toolbar">
        <label class="status" data-cat="${d.status?.category || 'new'}">
          <span class="sr-only">Status</span>
          <select data-action="transition" ${tab.transitions.length ? '' : raw('disabled')} title="Change status">
            <option value="" selected>${d.status?.name || 'Unknown'}</option>
            ${tab.transitions.map((t) => html`<option value="${t.id}">${t.to && t.to.name !== t.name ? `${t.name} → ${t.to.name}` : t.name}</option>`)}
          </select>
        </label>
        <a class="btn" href="${d.url}" data-action="open-jira" title="Open in Jira in your browser. Clicking again goes back to that browser tab.">${ICON.external}<span>Open in Jira</span></a>
        <button class="btn" type="button" data-action="copy">${ICON.link}<span>Copy link</span></button>
        <button class="btn icon-only" type="button" data-action="refresh" title="Refresh (${isMac ? '⌥' : 'Alt+'}R)" aria-label="Refresh">${ICON.refresh}</button>
        <span class="loaded" title="Loaded ${fullDate(tab.loadedAt)}">${tab.loading ? 'Refreshing…' : `Updated ${ago(d.updated)}`}</span>
      </div>
    </header>
    <div class="issue-grid">
      <div class="issue-main">
        <section>
          <h2>Description</h2>
          ${d.descriptionHtml ? html`<div class="rich" data-rich="description"></div>` : html`<p class="muted">No description.</p>`}
        </section>
        ${d.subtasks.length ? html`
        <section>
          <h2>Subtasks <span class="count">${d.subtasks.length}</span></h2>
          <ul class="rows">${d.subtasks.map((s) => html`<li>${issueRow(s)}</li>`)}</ul>
        </section>` : ''}
        ${d.links.length ? html`
        <section>
          <h2>Linked issues <span class="count">${d.links.length}</span></h2>
          <ul class="rows">${d.links.map((l) => html`<li><span class="rel">${l.rel}</span>${issueRow(l.issue)}</li>`)}</ul>
        </section>` : ''}
        ${d.attachments.length ? html`
        <section>
          <h2>Attachments <span class="count">${d.attachments.length}</span></h2>
          <ul class="rows">${d.attachments.map((a) => html`<li><a class="row" href="${a.url}" target="_blank" rel="noopener">${ICON.clip}<span class="row-sum">${a.name}</span><span class="muted small">${fileSize(a.size)}</span></a></li>`)}</ul>
        </section>` : ''}
        <section class="comments">
          <h2>Comments <span class="count">${d.commentTotal}</span></h2>
          ${d.comments.map((c, n) => html`
          <div class="comment">
            ${avatar(c.author, 'lg')}
            <div class="comment-body">
              <div class="comment-meta"><strong>${c.author?.name || 'Unknown'}</strong><time title="${fullDate(c.created)}">${ago(c.created)}</time></div>
              <div class="rich" data-rich="${n}"></div>
            </div>
          </div>`)}
          <form class="comment-form" data-action="comment">
            <textarea name="comment" rows="3" placeholder="Add a comment…" aria-label="Add a comment" required></textarea>
            <div class="form-row">
              <span class="muted small">${isMac ? '⌘' : 'Ctrl'}+Enter to send</span>
              <button class="btn primary" type="submit">Comment</button>
            </div>
          </form>
        </section>
      </div>
      <aside class="issue-side">
        <dl class="fields">
          ${field('Assignee', personView(d.assignee, 'Unassigned'))}
          ${field('Reporter', personView(d.reporter, 'None'))}
          ${field('Priority', d.priority && html`${d.priority.icon ? html`<img class="picon" src="${d.priority.icon}" alt="">` : ''}${d.priority.name}`)}
          ${field('Type', d.type && html`${typeIcon(d.type)}${d.type.name}`)}
          ${field('Labels', d.labels.length && html`<span class="chips">${d.labels.map((l) => html`<span class="chip">${l}</span>`)}</span>`)}
          ${field('Components', d.components.join(', '))}
          ${field('Created', d.created && html`<time title="${fullDate(d.created)}">${ago(d.created)}</time>`)}
          ${field('Updated', d.updated && html`<time title="${fullDate(d.updated)}">${ago(d.updated)}</time>`)}
        </dl>
      </aside>
    </div>
  </article>`;
}

function skeletonView(tab) {
  return html`
  <div class="issue" aria-busy="true">
    <div class="crumbs">${typeIcon(tab.type)}<span>${tab.key}</span></div>
    ${tab.summary ? html`<h1>${tab.summary}</h1>` : html`<div class="sk sk-title"></div>`}
    <div class="sk sk-bar"></div>
    <div class="issue-grid">
      <div><div class="sk sk-line" style="width:25%"></div><div class="sk sk-line"></div><div class="sk sk-line"></div><div class="sk sk-line" style="width:70%"></div></div>
      <div class="sk sk-box"></div>
    </div>
  </div>`;
}

function errorView(tab) {
  return html`
  <div class="issue error-view">
    <div class="crumbs"><span>${tab.key}</span></div>
    <h1>Couldn’t load ${tab.key}</h1>
    <p class="muted">${tab.error}</p>
    <button class="btn primary" type="button" data-action="retry">Try again</button>
  </div>`;
}

function issueRow(i) {
  return html`<a class="row" href="${i.url}" data-key="${i.key}" title="${i.summary}">
    ${typeIcon(i.type)}<span class="row-key">${i.key}</span><span class="row-sum">${i.summary}</span>${lozenge(i.status)}${i.assignee ? avatar(i.assignee, 'sm') : ''}
  </a>`;
}

function field(label, value) {
  return html`<dt>${label}</dt><dd>${value || html`<span class="muted">None</span>`}</dd>`;
}

function personView(p, emptyText) {
  return p ? html`${avatar(p)}<span class="ellipsis">${p.name}</span>` : html`${avatar(null)}<span class="muted">${emptyText}</span>`;
}

function avatar(p, size = '') {
  if (!p) return html`<span class="avatar ${size} is-empty" aria-hidden="true"></span>`;
  if (p.avatar) return html`<img class="avatar ${size}" src="${p.avatar}" alt="" title="${p.name}" loading="lazy" referrerpolicy="no-referrer">`;
  const initials = p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return html`<span class="avatar ${size}" style="--h:${hue(p.name)}" title="${p.name}" aria-hidden="true">${initials}</span>`;
}

function typeIcon(t) {
  if (!t) return '';
  if (t.icon) return html`<img class="ticon" src="${t.icon}" alt="" title="${t.name}">`;
  const kind = t.name.toLowerCase().replace(/[^a-z]/g, '');
  return html`<svg class="ticon" data-type="${kind}" viewBox="0 0 16 16" aria-hidden="true"><title>${t.name}</title>${raw(TYPE_GLYPH[kind] || TYPE_GLYPH.task)}</svg>`;
}

function lozenge(s) {
  return s ? html`<span class="lozenge" data-cat="${s.category}">${s.name}</span>` : '';
}

function setTitle(tab) {
  document.title = tab.summary ? `${tab.key} ${tab.summary} · Jira Tabs` : `${tab.key} · Jira Tabs`;
}

// Jira already sanitises its rendered HTML; this is a second line of defence.
const DROP_TAGS = 'script,style,iframe,frame,frameset,object,embed,form,input,button,textarea,select,link,meta,base,svg,math,template';
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'poster', 'background', 'cite']);
function sanitize(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup || '';
  tpl.content.querySelectorAll(DROP_TAGS).forEach((el) => el.remove());
  for (const el of tpl.content.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      const n = name.toLowerCase();
      const v = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
      const unsafeUrl = URL_ATTRS.has(n) && /^[a-z][a-z0-9+.-]*:/i.test(v) && !/^(https?:|mailto:|data:image\/(png|gif|jpe?g|webp);)/i.test(v);
      if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || unsafeUrl) el.removeAttribute(name);
    }
    if (el.tagName === 'A') { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
  }
  return tpl.content;
}

/* ------------------------------------------------ search */

async function search(jql, { silent = false } = {}) {
  state.jql = jql;
  persist();
  renderFilters();
  const seq = ++searchSeq;
  if (!silent) {
    els.meta.textContent = 'Searching…';
    els.results.setAttribute('aria-busy', 'true');
  }
  try {
    const data = await api(`/api/search?jql=${encodeURIComponent(jql)}`);
    if (seq !== searchSeq) return;
    state.results = data.issues || [];
    state.searchedAt = Date.now();
    const n = state.results.length;
    els.meta.textContent = `${n}${n === 50 ? '+' : ''} issue${n === 1 ? '' : 's'}${data._offline ? ' · offline copy' : ''}`;
    els.meta.title = jql;
    renderResults();
  } catch (err) {
    if (seq !== searchSeq) return;
    els.meta.textContent = '';
    els.results.innerHTML = html`<li class="results-note is-error">${err.message}</li>`;
  } finally {
    if (seq === searchSeq) els.results.removeAttribute('aria-busy');
  }
}

function renderResults() {
  els.results.innerHTML = state.results.length
    ? state.results.map((i) => html`<li>
        <a class="result" href="${i.url}" data-key="${i.key}">
          <span class="result-top">${typeIcon(i.type)}<span class="row-key">${i.key}</span><span class="open-mark" title="Open in a tab"></span><span class="spacer"></span>${lozenge(i.status)}</span>
          <span class="result-sum">${i.summary}</span>
          <span class="result-foot">${avatar(i.assignee, 'xs')}<span class="ellipsis">${i.assignee?.name || 'Unassigned'}</span><span>· ${ago(i.updated)}</span></span>
        </a></li>`).join('')
    : html`<li class="results-note">No issues match.</li>`;
  markOpen(els.results);
}

function updateResult(key, patch) {
  const r = state.results.find((x) => x.key === key);
  if (!r) return;
  Object.assign(r, patch);
  renderResults();
}

function renderFilters() {
  els.filters.innerHTML = FILTERS.map((f) => html`<button type="button" class="filter" data-jql="${f.jql}" aria-pressed="${String(f.jql === state.jql)}">${f.label}</button>`).join('');
}

// Marks every issue link whose issue is open in a tab (and which tab is showing).
function markOpen(root = document) {
  const open = new Set(state.tabs.map((t) => t.key));
  for (const a of root.querySelectorAll('a[data-key]')) {
    a.classList.toggle('is-open', open.has(a.dataset.key));
    a.classList.toggle('is-active', a.dataset.key === state.active);
  }
}

/* ------------------------------------------------ events */

function bindEvents() {
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = els.input.value.trim();
    if (!q) return search(FILTERS[0].jql);
    const key = toKey(q);
    if (key) {
      openIssue(key);
      els.input.select();
      return;
    }
    search(looksLikeJql(q) ? q : `text ~ "${q.replace(/["\\]/g, '\\$&')}" ORDER BY updated DESC`);
  });
  els.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') els.input.blur(); });
  els.filters.addEventListener('click', (e) => {
    const b = e.target.closest('[data-jql]');
    if (!b) return;
    els.input.value = '';
    search(b.dataset.jql);
  });
  $('#sidebar-toggle').addEventListener('click', toggleSidebar);
  $('#new-tab').addEventListener('click', focusSearch);

  document.addEventListener('click', onClick);
  document.addEventListener('auxclick', onClick);
  document.addEventListener('mousedown', (e) => {
    if (e.button === 1 && e.target.closest('#tabs .tab, a[data-key]')) e.preventDefault(); // no autoscroll
  });
  document.addEventListener('change', onTransition);
  document.addEventListener('submit', onComment);
  document.addEventListener('keydown', onKey);

  els.tabs.addEventListener('keydown', onTabKey);
  els.tabs.addEventListener('dragstart', onDragStart);
  els.tabs.addEventListener('dragover', onDragOver);
  els.tabs.addEventListener('drop', onDrop);
  els.tabs.addEventListener('dragend', onDragEnd);

  // Coming back to the app: refresh what is stale.
  window.addEventListener('focus', () => {
    if (Date.now() - state.searchedAt > STALE_MS) search(state.jql, { silent: true });
    const tab = currentTab();
    if (tab?.data && !tab.loading && Date.now() - tab.loadedAt > STALE_MS) loadIssue(tab, { silent: true });
  });
}

function onClick(e) {
  const middle = e.type === 'auxclick';
  if (middle ? e.button !== 1 : e.button !== 0) return;

  if (!middle && narrow.matches && document.body.classList.contains('sidebar-open')
    && !e.target.closest('#sidebar, #sidebar-toggle, #new-tab')) {
    document.body.classList.remove('sidebar-open');
  }

  const tabEl = e.target.closest('#tabs .tab');
  if (tabEl) {
    e.preventDefault();
    if (middle || e.target.closest('.tab-close')) closeTab(tabEl.dataset.key);
    else activate(tabEl.dataset.key);
    return;
  }

  const action = e.target.closest('[data-action]');
  if (action && !middle) {
    const tab = tabOf(action);
    switch (action.dataset.action) {
      case 'refresh': e.preventDefault(); if (tab) loadIssue(tab, { silent: true }); return;
      case 'retry': e.preventDefault(); if (tab) loadIssue(tab); return;
      case 'copy': e.preventDefault(); if (tab?.data) copyLink(tab.data.url); return;
      case 'open-jira': e.preventDefault(); if (tab) openInJira(tab); return;
      default: break;
    }
  }

  const a = e.target.closest('a[href]');
  if (!a || a.dataset.action === 'open-jira') return;
  const key = a.dataset.key || keyFromUrl(a.href);
  if (key) {
    e.preventDefault();
    openIssue(key, { background: middle || e.ctrlKey || e.metaKey });
    return;
  }
  if (!a.target) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } // never navigate the app away
}

async function onTransition(e) {
  const select = e.target.closest('select[data-action="transition"]');
  if (!select || !select.value) return;
  const tab = tabOf(select);
  if (!tab) return;
  const chosen = tab.transitions.find((t) => t.id === select.value);
  select.disabled = true;
  try {
    await api(`/api/issue/${tab.key}/transitions`, { method: 'POST', body: { id: select.value } });
    toast(`${tab.key} moved to ${chosen?.to?.name || chosen?.name}`);
    if (chosen?.to) updateResult(tab.key, { status: chosen.to });
    await loadIssue(tab, { silent: true });
  } catch (err) {
    toast(err.message, true);
    renderPanel(tab);
  }
}

async function onComment(e) {
  const form = e.target.closest('form[data-action="comment"]');
  if (!form) return;
  e.preventDefault();
  const tab = tabOf(form);
  const text = form.comment.value.trim();
  if (!tab || !text) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api(`/api/issue/${tab.key}/comment`, { method: 'POST', body: { text } });
    tab.draft = '';
    toast(`Comment added to ${tab.key}`);
    await loadIssue(tab, { silent: true });
    tab.panel.querySelector('.comment:last-of-type')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (err) {
    toast(err.message, true);
    button.disabled = false;
  }
}

function onKey(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.name === 'comment') {
    e.preventDefault();
    e.target.form.requestSubmit();
    return;
  }
  const typing = e.target.closest('input, textarea, select, [contenteditable="true"]');
  if ((e.key === '/' && !typing && !e.altKey && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k')) {
    e.preventDefault();
    focusSearch();
    return;
  }
  // Alt shortcuts are skipped while typing: on some layouts Alt+digit types characters such as #.
  if (typing || !e.altKey || e.ctrlKey || e.metaKey) return;
  const digit = /^Digit([1-9])$/.exec(e.code);
  let handled = true;
  if (digit) {
    const tab = digit[1] === '9' ? state.tabs.at(-1) : state.tabs[Number(digit[1]) - 1];
    if (tab) activate(tab.key);
  } else if (e.code === 'KeyW') {
    if (state.active) closeTab(state.active);
  } else if (e.code === 'KeyT' && e.shiftKey) {
    reopenClosed();
  } else if (e.code === 'KeyR') {
    const tab = currentTab();
    if (tab) loadIssue(tab, { silent: true });
  } else if (e.code === 'BracketRight' || e.code === 'PageDown') {
    cycle(1);
  } else if (e.code === 'BracketLeft' || e.code === 'PageUp') {
    cycle(-1);
  } else if (e.code === 'KeyB') {
    toggleSidebar();
  } else {
    handled = false;
  }
  if (handled) e.preventDefault();
}

function onTabKey(e) {
  const el = e.target.closest('.tab');
  if (!el || e.altKey || e.ctrlKey || e.metaKey) return;
  const n = state.tabs.length;
  const i = state.tabs.findIndex((t) => t.key === el.dataset.key);
  let j = null;
  if (e.key === 'ArrowRight') j = (i + 1) % n;
  else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = n - 1;
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    closeTab(el.dataset.key);
    els.tabs.querySelector('[aria-selected="true"]')?.focus();
    return;
  }
  if (j === null) return;
  e.preventDefault();
  activate(state.tabs[j].key);
  els.tabs.querySelector(`[data-key="${state.tabs[j].key}"]`)?.focus();
}

// Drag tabs to reorder them; drop an issue link on the tab strip to open it.
function onDragStart(e) {
  const el = e.target.closest('.tab');
  if (!el) return;
  dragKey = el.dataset.key;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  const url = tabByKey(dragKey)?.data?.url;
  if (url) e.dataTransfer.setData('text/uri-list', url);
  e.dataTransfer.setData('text/plain', url || dragKey);
}

function onDragOver(e) {
  if (!dragKey) {
    if ([...e.dataTransfer.types].includes('text/uri-list')) e.preventDefault();
    return;
  }
  e.preventDefault();
  const dragged = els.tabs.querySelector('.dragging');
  const over = e.target.closest('.tab');
  if (!dragged || !over || over === dragged) return;
  const box = over.getBoundingClientRect();
  els.tabs.insertBefore(dragged, e.clientX > box.left + box.width / 2 ? over.nextSibling : over);
}

function onDrop(e) {
  e.preventDefault();
  if (dragKey) return;
  const key = keyFromUrl(e.dataTransfer.getData('text/uri-list').split('\n')[0]);
  if (key) openIssue(key);
}

function onDragEnd() {
  if (!dragKey) return;
  const order = [...els.tabs.children].map((el) => el.dataset.key);
  state.tabs.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  dragKey = null;
  renderTabs();
  persist();
}

/* ------------------------------------------------ sidebar, config, misc */

function toggleSidebar() {
  if (narrow.matches) {
    document.body.classList.toggle('sidebar-open');
  } else {
    document.body.classList.toggle('sidebar-collapsed');
    persist();
  }
}

function focusSearch() {
  if (narrow.matches) document.body.classList.add('sidebar-open');
  else if (document.body.classList.contains('sidebar-collapsed')) {
    document.body.classList.remove('sidebar-collapsed');
    persist();
  }
  els.input.focus();
  els.input.select();
}

async function loadConfig() {
  try {
    const c = await api('/api/config');
    state.site = c.site || '';
    const me = c.me && !c.me.error ? c.me : null;
    els.whoami.innerHTML = html`
      ${avatar(me)}
      <span class="ellipsis">${me ? me.name : 'Not signed in'}</span>
      ${c.demo
        ? html`<span class="badge" title="No Jira credentials are set, so the app shows sample issues. See README.md.">Demo data</span>`
        : html`<a class="site" href="${c.site}" target="_blank" rel="noopener">${hostOf(c.site)}</a>`}`;
    if (c.me?.error) toast(`Jira refused the credentials: ${c.me.error}`, true);
  } catch {
    els.whoami.textContent = 'Offline';
  }
}

// "PROJ-1", "proj-1", "web+jira:PROJ-1" or any Jira URL that points at an issue.
function toKey(text) {
  let s = String(text).trim();
  try { s = decodeURIComponent(s); } catch { /* keep as is */ }
  s = s.replace(/^web\+jira:(\/\/)?/i, '');
  if (KEY_RE.test(s.toUpperCase())) return s.toUpperCase();
  return /^https?:/i.test(s) ? keyFromUrl(s) : null;
}

function openFromText(text) {
  const key = toKey(text);
  if (!key) {
    toast(`“${text}” is not an issue key or issue link`, true);
    return false;
  }
  openIssue(key);
  return true;
}

function keyFromUrl(href) {
  let u;
  try { u = new URL(href, location.href); } catch { return null; }
  const siteHost = hostOf(state.site);
  if (u.host !== location.host && siteHost && u.host !== siteHost) return null;
  const key = (u.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9_]+-\d+)\/?$/)?.[1] || u.searchParams.get('selectedIssue') || '').toUpperCase();
  return KEY_RE.test(key) ? key : null;
}

function looksLikeJql(q) {
  return /[=~<>]|\(\)|\border\s+by\b|\s(?:not\s+)?in\s*\(|\bis\s+(?:not\s+)?empty\b/i.test(q);
}

// "Open in Jira" reuses the browser tab it opened before for that issue.
function openInJira(tab) {
  const existing = jiraWindows.get(tab.key);
  if (existing && !existing.closed) {
    existing.focus();
    return;
  }
  const win = window.open(tab.data?.url || `${state.site}/browse/${tab.key}`, `jira-${tab.key}`);
  if (win) jiraWindows.set(tab.key, win);
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    toast('Could not copy the link', true);
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { Accept: 'application/json', ...(method !== 'GET' && { 'Content-Type': 'application/json', 'X-Jira-Tabs': '1' }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  if (res.headers.get('X-Offline-Copy')) data._offline = true;
  return data;
}

function restore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { /* storage unavailable */ }
  if (!saved) return;
  state.jql = saved.jql || state.jql;
  state.closed = Array.isArray(saved.closed) ? saved.closed : [];
  for (const t of saved.tabs || []) if (KEY_RE.test(t.key) && !tabByKey(t.key)) addTab(t);
  state.active = tabByKey(saved.active) ? saved.active : null;
  if (saved.sidebarCollapsed) document.body.classList.add('sidebar-collapsed');
  if (!FILTERS.some((f) => f.jql === state.jql)) {
    els.input.value = state.jql.match(/^text ~ "(.*)" ORDER BY updated DESC$/)?.[1]?.replace(/\\(.)/g, '$1') ?? state.jql;
  }
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      tabs: state.tabs.map(({ key, summary, status, type }) => ({ key, summary, status, type })),
      active: state.active,
      closed: state.closed,
      jql: state.jql,
      sidebarCollapsed: document.body.classList.contains('sidebar-collapsed'),
    }));
  } catch { /* storage unavailable */ }
}

function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('is-error', isError);
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), isError ? 5000 : 2200);
}

const tabByKey = (key) => state.tabs.find((t) => t.key === key);
const currentTab = () => tabByKey(state.active);
const tabOf = (el) => state.tabs.find((t) => t.panel === el.closest('.panel'));
const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const toDate = (d) => new Date(typeof d === 'string' ? d.replace(/([+-]\d\d)(\d\d)$/, '$1:$2') : d);
const fullDate = (d) => (d ? toDate(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const fileSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
function ago(d) {
  if (!d) return '';
  const s = (toDate(d) - Date.now()) / 1000;
  const a = Math.abs(s);
  const [v, unit] = a < 45 ? [0, 'second'] : a < 3600 ? [s / 60, 'minute'] : a < 86400 ? [s / 3600, 'hour']
    : a < 2592000 ? [s / 86400, 'day'] : a < 31536000 ? [s / 2592000, 'month'] : [s / 31536000, 'year'];
  return rtf.format(Math.round(v), unit);
}

boot();
