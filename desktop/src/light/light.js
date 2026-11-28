// The light issue view: one small page that shows whichever light tab is open, drawn from the
// site's data instead of loading the whole Jira or GitLab app for every issue (or merge request).
// Switching between light tabs only redraws this page. The app fetches the data (jira-api.js,
// gitlab-api.js, both in the same shape); this page never talks to the site itself.

const api = window.lightApi;
const view = document.getElementById('view');
const toastEl = document.getElementById('toast');
const previewEl = document.getElementById('preview');
const isMac = api.platform === 'darwin';
const STALE_MS = 30_000; // refresh an issue in the background when its data is older than this

// key → { data, transitions, at, loading, error, signedOut, draft, scroll }
const issues = new Map();
let current = { key: null, url: null };
let site = 'Jira'; // the site's name: Jira or GitLab
let toastTimer = 0;

const entry = (key) => {
  if (!issues.has(key)) issues.set(key, { data: null, transitions: [], at: 0, loading: false, error: null, signedOut: false, draft: '', scroll: 0 });
  return issues.get(key);
};

// ---------- templating (interpolations are escaped unless raw) ----------

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(String(s ?? ''));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : v == null || v === false ? '' : esc(v));
const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? fmt(vals[i]) : ''), ''));

const icon = (d, size = 16) => raw(`<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
const ICON = {
  external: icon('<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v4h-9v-9h4"/>'),
  link: icon('<path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 014 4l-1 1M9 11.5l-1 1a2.8 2.8 0 01-4-4l1-1"/>'),
  refresh: icon('<path d="M13.5 2.5v3.5H10M2.5 13.5V10H6"/><path d="M13 6A5.5 5.5 0 003.2 4.8M3 10a5.5 5.5 0 009.8 1.2"/>'),
  close: icon('<path d="M4 4l8 8M12 4l-8 8"/>'),
  prev: icon('<path d="M10 3L5 8l5 5"/>', 20),
  next: icon('<path d="M6 3l5 5-5 5"/>', 20),
  clip: icon('<path d="M13 7.5l-5.3 5.3a3.2 3.2 0 01-4.5-4.5L8.8 2.7a2.1 2.1 0 013 3L6.3 11.2a1 1 0 01-1.5-1.5L9.8 4.8"/>'),
};
const TYPE_GLYPH = {
  story: '<path d="M5 3.5h6v9l-3-2.2-3 2.2z" fill="currentColor"/>',
  bug: '<circle cx="8" cy="8" r="3.5" fill="currentColor"/>',
  task: '<path d="M4.5 8.3l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  epic: '<path d="M9.5 2.5L4.5 9h3.2L6.5 13.5 11.5 7H8.3z" fill="currentColor"/>',
  issue: '<circle cx="8" cy="8" r="4" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>',
  incident: '<path d="M8 3.5l4.5 8h-9z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/><path d="M8 7v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  mergerequest: '<circle cx="5" cy="4.5" r="1.4" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="5" cy="11.5" r="1.4" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="11" cy="11.5" r="1.4" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M5 6v4M11 10V7.5a2 2 0 00-2-2H7.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
  subtask: '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1" fill="currentColor"/><rect x="7" y="7" width="5.5" height="5.5" rx="1" fill="currentColor" fill-opacity=".6"/>',
};

// ---------- showing an issue ----------

api.onShow(({ key, url, app }) => {
  if (app) site = app;
  show(key, url);
});
api.onCommand((name) => {
  if (name === 'refresh' && current.key) load(current.key, { fresh: true });
});

function show(key, url) {
  closePreview();
  if (current.key && issues.has(current.key)) entry(current.key).scroll = document.scrollingElement.scrollTop;
  current = { key, url };
  const e = entry(key);
  render();
  document.scrollingElement.scrollTop = e.scroll || 0;
  if (!e.data || Date.now() - e.at > STALE_MS) load(key, { fresh: !!e.data });
}

async function load(key, { fresh = false } = {}) {
  const e = entry(key);
  if (e.loading) return;
  e.loading = true;
  if (key === current.key) render();
  const [res, tr] = await Promise.all([api.issue(key, fresh), api.transitions(key)]);
  e.loading = false;
  if (res.ok) {
    Object.assign(e, { data: res.data, at: res.at, error: null, signedOut: false });
  } else {
    Object.assign(e, { error: res.error, signedOut: !!res.signedOut });
  }
  // GitLab's come with the item's data.
  e.transitions = (Array.isArray(e.data?.transitions) ? e.data.transitions : tr.ok && tr.data) || [];
  if (key === current.key) render();
}

function render() {
  const e = entry(current.key);
  // Keep typing undisturbed when the issue refreshes underneath.
  const box = view.querySelector('textarea[name="comment"]');
  const typing = box && document.activeElement === box ? [box.selectionStart, box.selectionEnd] : null;
  const top = document.scrollingElement.scrollTop;
  view.innerHTML = e.data ? issueView(e) : e.error ? errorView(e) : skeletonView();
  if (e.data) {
    for (const el of view.querySelectorAll('[data-rich]')) {
      const id = el.dataset.rich;
      el.append(sanitize(id === 'description' ? e.data.descriptionHtml : e.data.comments[id]?.html));
    }
    const area = view.querySelector('textarea[name="comment"]');
    if (area) {
      area.value = e.draft;
      if (typing) {
        area.focus();
        area.setSelectionRange(...typing);
      }
    }
  }
  document.scrollingElement.scrollTop = top;
  document.title = e.data ? e.data.tabTitle || `[${e.data.key}] ${e.data.summary}` : current.key;
}

function issueView(e) {
  const d = e.data;
  return html`
  <article class="issue">
    ${e.error ? html`<div class="notice is-error">Couldn’t refresh: ${e.error}</div>` : ''}
    <header class="issue-head">
      <nav class="crumbs" aria-label="Breadcrumb">
        ${(d.crumbs || []).map((c) => html`<a class="crumb" href="${c.url}">${c.label}</a><span class="sep">/</span>`)}
        ${d.parent ? html`<a class="crumb" href="${d.parent.url}" title="${d.parent.summary}">${typeIcon(d.parent.type)}${d.parent.key}</a><span class="sep">/</span>` : ''}
        <span class="crumb is-current">${typeIcon(d.type)}${d.key}</span>
        <span class="light-badge" title="A quick view drawn from ${site}’s data. Open it in full ${site} to edit it, use the rich editor and everything else.">Light view</span>
      </nav>
      <h1>${d.summary}</h1>
      ${d.subtitle ? html`<p class="subtitle"><code class="branch" title="Source branch">${d.subtitle.from}</code><span class="arrow" aria-label="into">→</span><code class="branch" title="Target branch">${d.subtitle.to}</code></p>` : ''}
      <div class="toolbar">
        <label class="status" data-cat="${d.status?.category || 'new'}">
          <span class="sr-only">Status</span>
          <select data-action="transition" ${e.transitions.length ? '' : raw('disabled')} title="Change status">
            <option value="" selected>${d.status?.name || 'Unknown'}</option>
            ${e.transitions.map((t) => html`<option value="${t.id}">${t.to && t.to.name !== t.name ? `${t.name} → ${t.to.name}` : t.name}</option>`)}
          </select>
        </label>
        <button class="btn primary" type="button" data-action="full" title="Show this in full ${site}, in this tab (${isMac ? '⇧⌘J' : 'Ctrl+Shift+J'})">${ICON.external}<span>Open full ${site}</span></button>
        <button class="btn" type="button" data-action="copy">${ICON.link}<span>Copy link</span></button>
        <button class="btn icon-only" type="button" data-action="refresh" title="Refresh (${isMac ? '⌘R' : 'Ctrl+R'})" aria-label="Refresh">${ICON.refresh}</button>
        <span class="loaded" title="Loaded ${fullDate(e.at)}">${e.loading ? 'Refreshing…' : `Updated ${ago(d.updated)}`}</span>
      </div>
    </header>
    <div class="issue-grid">
      <div class="issue-main">
        <section>
          <h2>Description</h2>
          ${d.descriptionHtml ? html`<div class="rich" data-rich="description"></div>` : html`<p class="muted">No description.</p>`}
        </section>
        ${(d.sections || []).map((sec) => html`
        <section>
          <h2>${sec.title} <span class="count">${sec.rows.length}</span></h2>
          <ul class="rows">${sec.rows.map((r) => html`<li>${r.rel ? html`<span class="rel">${r.rel}</span>` : ''}${issueRow(r.item)}</li>`)}</ul>
        </section>`)}
        ${d.attachments.length ? html`
        <section>
          <h2>Attachments <span class="count">${d.attachments.length}</span></h2>
          <ul class="rows">${d.attachments.map((a) => html`<li><a class="row" href="${a.url}" title="${a.preview ? `Preview ${a.name}` : `Open ${a.name}`}" ${a.preview ? html`data-preview="${a.preview}" data-name="${a.name}"` : ''}>${ICON.clip}<span class="row-sum">${a.name}</span><span class="muted small">${fileSize(a.size)}</span></a></li>`)}</ul>
          ${d.attachments.some((a) => a.thumbnail) ? html`<div class="thumbs">${d.attachments.filter((a) => a.thumbnail).map((a) => html`<a href="${a.url}" title="${a.name}" data-preview="${a.preview || a.thumbnail}" data-name="${a.name}"><img src="${a.thumbnail}" alt="${a.name}" loading="lazy"></a>`)}</div>` : ''}
        </section>` : ''}
        <section class="comments">
          <h2>Comments <span class="count">${d.commentTotal}</span></h2>
          ${d.commentTotal > d.comments.length ? html`<p class="muted small">Showing the latest ${d.comments.length}. <a href="${d.url}" data-action="full">See all in full ${site}</a></p>` : ''}
          ${d.comments.map((c, n) => html`
          <div class="comment">
            ${avatar(c.author, 'lg')}
            <div class="comment-body">
              <div class="comment-meta"><strong>${c.author?.name || 'Unknown'}</strong><time title="${fullDate(c.created)}">${ago(c.created)}</time>${c.internal ? html`<span class="internal" title="Only project members can see this">Internal</span>` : ''}</div>
              <div class="rich" data-rich="${n}"></div>
            </div>
          </div>`)}
          <form class="comment-form" data-action="comment">
            <textarea name="comment" rows="3" placeholder="Add a comment…" aria-label="Add a comment" required></textarea>
            <div class="form-row">
              <span class="muted small">${isMac ? '⌘' : 'Ctrl'}+Enter to send · ${d.commentHint || 'plain text'}</span>
              <button class="btn primary" type="submit">Comment</button>
            </div>
          </form>
        </section>
      </div>
      <aside class="issue-side">
        <dl class="fields">
          ${(d.fields || []).map(fieldView)}
        </dl>
      </aside>
    </div>
  </article>`;
}

function skeletonView() {
  return html`
  <div class="issue" aria-busy="true">
    <div class="crumbs"><span>${current.key}</span></div>
    <div class="sk sk-title"></div>
    <div class="sk sk-bar"></div>
    <div class="issue-grid">
      <div><div class="sk sk-line" style="width:25%"></div><div class="sk sk-line"></div><div class="sk sk-line"></div><div class="sk sk-line" style="width:70%"></div></div>
      <div class="sk sk-box"></div>
    </div>
  </div>`;
}

function errorView(e) {
  return html`
  <div class="issue error-view">
    <div class="crumbs"><span>${current.key}</span></div>
    <h1>${e.signedOut ? `Sign in to ${site}` : `Couldn’t load ${current.key}`}</h1>
    <p class="muted">${e.signedOut ? `The light view uses your ${site} sign-in. Open it in full ${site} to sign in, then come back.` : e.error}</p>
    <button class="btn primary" type="button" data-action="full">${ICON.external}<span>Open full ${site}</span></button>
    ${e.signedOut ? '' : html`<button class="btn" type="button" data-action="refresh">Try again</button>`}
  </div>`;
}

function issueRow(i) {
  return html`<a class="row" href="${i.url}" title="${i.summary}">
    ${typeIcon(i.type)}<span class="row-key">${i.key}</span><span class="row-sum">${i.summary}</span>${lozenge(i.status)}${rowAssignee(i.assignee)}
  </a>`;
}

// The assignee at the end of a subtask or linked-issue row: avatar and name, "Unassigned", or
// nothing when Jira didn't say.
function rowAssignee(p) {
  if (p === undefined) return '';
  return html`<span class="row-person" title="${p ? `Assignee: ${p.name}` : 'Unassigned'}">${avatar(p, 'sm')}<span class="row-person-name">${p ? p.name : 'Unassigned'}</span></span>`;
}

const field = (label, value) => html`<dt>${label}</dt><dd>${value || html`<span class="muted">None</span>`}</dd>`;
const personView = (p, emptyText) =>
  (p ? html`${avatar(p)}<span class="ellipsis">${p.name}</span>` : html`${avatar(null)}<span class="muted">${emptyText}</span>`);
const COLOR = /^#[0-9a-f]{3,8}$/i;
const chip = (c) => (COLOR.test(c.color || '') && COLOR.test(c.textColor || '')
  ? html`<span class="chip" style="background:${c.color};color:${c.textColor}">${c.name}</span>`
  : html`<span class="chip">${c.name}</span>`);

// One line of the side panel: people, a status, labels, a date, or text (maybe a link).
function fieldView(f) {
  const text = f.text && (f.url ? html`<a href="${f.url}" class="ellipsis">${f.text}</a>` : html`<span class="ellipsis">${f.text}</span>`);
  let value = '';
  if (f.people) {
    value = f.people.length === 1 && !f.text ? personView(f.people[0])
      : f.people.length ? html`<span class="people">${f.people.map((p) => avatar(p))}</span>${text || (f.people.length < 3 ? html`<span class="ellipsis">${f.people.map((p) => p.name).join(', ')}</span>` : '')}`
        : f.empty ? personView(null, f.text || f.empty) : text;
  } else if (f.status) {
    value = f.url ? html`<a href="${f.url}" class="plain">${lozenge(f.status)}</a>` : lozenge(f.status);
  } else if (f.chips) {
    value = f.chips.length && html`<span class="chips">${f.chips.map(chip)}</span>`;
  } else if (f.date) {
    value = html`<time title="${fullDate(f.date)}">${ago(f.date)}</time>`;
  } else if (f.type) {
    value = html`${typeIcon(f.type)}${f.type.name}`;
  } else if (f.icon) {
    value = html`<img class="picon" src="${f.icon}" alt="">${f.text}`;
  } else {
    value = text;
  }
  return field(f.label, value);
}
const lozenge = (s) => (s ? html`<span class="lozenge" data-cat="${s.category}">${s.name}</span>` : '');

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

// Jira and GitLab already sanitise their rendered HTML; this is a second line of defence (and the page's
// Content-Security-Policy runs no scripts but its own).
const DROP_TAGS = 'script,style,iframe,frame,frameset,object,embed,form,input,button,textarea,select,link,meta,base,svg,math,template';
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'poster', 'background', 'cite']);
function sanitize(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup || '';
  tpl.content.querySelectorAll(DROP_TAGS).forEach((el) => el.remove());
  for (const el of tpl.content.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      const n = name.toLowerCase();
      const v = value.replace(/[\u0000- \u007f-\u009f]/g, '');
      const unsafeUrl = URL_ATTRS.has(n) && /^[a-z][a-z0-9+.-]*:/i.test(v) &&
        !/^(https?:|mailto:|site-media:|data:image\/(png|gif|jpe?g|webp);)/i.test(v);
      if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || unsafeUrl) el.removeAttribute(name);
    }
  }
  return tpl.content;
}

// ---------- actions ----------

view.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]');
  if (action && action.tagName !== 'FORM' && action.tagName !== 'SELECT') {
    e.preventDefault();
    const name = action.dataset.action;
    if (name === 'full') api.openFull();
    else if (name === 'copy') {
      api.copy(current.url);
      toast('Link copied');
    } else if (name === 'refresh') load(current.key, { fresh: true });
    return;
  }
  // A plain click on an image (or an image attachment) previews it; ⌘-click still opens its link.
  const shot = !(e.metaKey || e.ctrlKey || e.shiftKey) && previewItem(e.target.closest('[data-preview], .rich img'));
  if (shot) {
    e.preventDefault();
    openPreview(shot);
    return;
  }
  const a = e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  if (/^(https?|mailto):/i.test(a.href)) api.open(a.href, e.metaKey || e.ctrlKey || e.shiftKey);
});
// Resting the pointer on a link to an issue, or on "Open full Jira / GitLab", starts loading its
// full page, so it shows at once when clicked.
const HOVER_MS = 150;
let hovered = null;
let hoverTimer = null;
const hoverHint = (el) => api.hover(el.dataset.action === 'full' ? null : el.href);
view.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-action="full"], a[href^="https:"]');
  if (el === hovered) return;
  hovered = el;
  clearTimeout(hoverTimer);
  if (el) hoverTimer = setTimeout(() => hoverHint(el), HOVER_MS);
});
view.addEventListener('mousedown', (e) => {
  const el = e.button === 0 && e.target.closest('[data-action="full"], a[href^="https:"]');
  if (!el) return;
  clearTimeout(hoverTimer);
  hoverHint(el);
});
view.addEventListener('auxclick', (e) => {
  const a = e.button === 1 && e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  if (/^https?:/i.test(a.href)) api.open(a.href, true);
});

view.addEventListener('change', async (e) => {
  const select = e.target.closest('select[data-action="transition"]');
  if (!select || !select.value) return;
  const key = current.key;
  const name = select.selectedOptions[0].textContent;
  select.disabled = true;
  const res = await api.transition(key, select.value);
  if (res.ok) {
    toast(`${key}: ${name}`);
    load(key, { fresh: true });
  } else {
    toast(res.error, true);
    if (key === current.key) render();
  }
});

view.addEventListener('input', (e) => {
  if (e.target.name === 'comment') entry(current.key).draft = e.target.value;
});

view.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-action="comment"]');
  if (!form) return;
  e.preventDefault();
  const key = current.key;
  const text = form.comment.value.trim();
  if (!text) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const res = await api.comment(key, text);
  button.disabled = false;
  if (res.ok) {
    entry(key).draft = '';
    if (key === current.key) form.comment.value = '';
    toast('Comment added');
    load(key, { fresh: true });
  } else {
    toast(res.error, true);
  }
});

view.addEventListener('keydown', (e) => {
  if (e.target.name === 'comment' && e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
});

// ---------- image preview ----------

// An image shown over the issue, as large as fits (click it for its actual size), with the other
// images of the issue a ← → away. Images on the site load through site-media:// with your sign-in;
// a link around an image (an attachment or upload) is taken to be the full-size image, and the
// image itself is shown when that link isn't one.
let pv = null; // { list: [{ src, fallback, name, href }], i, zoomed }
const SAFE_SRC = /^(site-media:|https:|data:image\/)/i;
const ATTACHMENT = /^\/(?:secure\/attachment\/|rest\/api\/\d+\/attachment\/content\/)|\/uploads\//;
const siteOrigin = () => {
  try {
    return new URL(entry(current.key).data?.url).origin;
  } catch {
    return null;
  }
};
const fileName = (u) => {
  try {
    return decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
  } catch {
    return '';
  }
};
// site-media://site/x ⇄ https://<site>/x
const toMedia = (u) => {
  const origin = siteOrigin();
  return origin && u && u.startsWith(`${origin}/`) ? `site-media://site${u.slice(origin.length)}` : null;
};
const toSite = (u) => (u?.startsWith('site-media://site/') && siteOrigin() ? siteOrigin() + u.slice('site-media://site'.length) : u);

function previewItem(el) {
  if (!el) return null;
  if (el.dataset.preview) {
    const src = el.dataset.preview;
    if (!SAFE_SRC.test(src)) return null;
    return { src, fallback: el.querySelector('img')?.src || null, name: el.dataset.name || '', href: el.href || toSite(src) };
  }
  if (el.tagName !== 'IMG' || el.classList.contains('emoticon') || !SAFE_SRC.test(el.src) || (el.width && el.width < 24 && el.height < 24)) return null;
  const link = el.closest('a[href]')?.href;
  let path = '';
  try {
    path = link && new URL(link).origin === siteOrigin() ? new URL(link).pathname : '';
  } catch { /* not an address */ }
  const full = path && ATTACHMENT.test(path) ? toMedia(link) : null;
  return { src: full || el.src, fallback: full ? el.src : null, name: el.alt || fileName(link || toSite(el.src)), href: link || toSite(el.src) };
}

function openPreview(item) {
  const list = [];
  for (const el of view.querySelectorAll('.rich img, .thumbs [data-preview], .rows [data-preview]')) {
    const it = previewItem(el);
    if (it && !list.some((x) => x.src === it.src)) list.push(it);
  }
  let i = list.findIndex((x) => x.src === item.src);
  if (i < 0) i = list.push(item) - 1;
  pv = { list, i, zoomed: false };
  renderPreview();
}

function closePreview() {
  if (!pv) return;
  pv = null;
  previewEl.hidden = true;
  previewEl.replaceChildren();
  document.body.classList.remove('previewing');
  view.focus({ preventScroll: true });
}

function renderPreview() {
  const it = pv.list[pv.i];
  const many = pv.list.length > 1;
  previewEl.innerHTML = html`
    <div class="preview-bar">
      <span class="preview-name">${it.name || 'Image'}</span>
      ${many ? html`<span class="preview-count">${pv.i + 1} / ${pv.list.length}</span>` : ''}
      <span class="preview-gap"></span>
      ${it.href && /^https:/i.test(it.href) ? html`<button class="btn" type="button" data-pv="open" title="Open the original">${ICON.external}<span>Open original</span></button>` : ''}
      <button class="btn icon-only" type="button" data-pv="close" title="Close (Esc)" aria-label="Close">${ICON.close}</button>
    </div>
    <div class="preview-stage is-loading" data-pv="stage">
      <img class="preview-img" alt="${it.name}">
      <span class="preview-msg">Loading…</span>
    </div>
    ${many ? html`<button class="preview-nav prev" type="button" data-pv="prev" aria-label="Previous image">${ICON.prev}</button>
    <button class="preview-nav next" type="button" data-pv="next" aria-label="Next image">${ICON.next}</button>` : ''}`;
  previewEl.classList.toggle('is-zoomed', pv.zoomed);
  const stage = previewEl.querySelector('.preview-stage');
  const img = previewEl.querySelector('.preview-img');
  img.addEventListener('load', () => stage.classList.remove('is-loading', 'is-broken'));
  img.addEventListener('error', () => {
    if (it.fallback && img.getAttribute('src') !== it.fallback) img.src = it.fallback;
    else {
      stage.classList.remove('is-loading');
      stage.classList.add('is-broken');
      previewEl.querySelector('.preview-msg').textContent = 'Couldn’t load this image.';
    }
  });
  img.src = it.src;
  previewEl.hidden = false;
  document.body.classList.add('previewing');
  previewEl.focus({ preventScroll: true });
}

function stepPreview(by) {
  if (!pv || pv.list.length < 2) return;
  pv.i = (pv.i + by + pv.list.length) % pv.list.length;
  pv.zoomed = false;
  renderPreview();
}

previewEl.addEventListener('click', (e) => {
  if (!pv) return;
  if (e.target.classList.contains('preview-img')) {
    pv.zoomed = !pv.zoomed;
    previewEl.classList.toggle('is-zoomed', pv.zoomed);
    return;
  }
  const action = e.target.closest('[data-pv]')?.dataset.pv;
  if (action === 'close' || (action === 'stage' && e.target.dataset.pv === 'stage')) closePreview();
  else if (action === 'prev') stepPreview(-1);
  else if (action === 'next') stepPreview(1);
  else if (action === 'open') {
    api.open(pv.list[pv.i].href, false);
    closePreview();
  }
});
document.addEventListener('keydown', (e) => {
  if (!pv) return;
  if (e.key === 'Escape') closePreview();
  else if (e.key === 'ArrowLeft') stepPreview(-1);
  else if (e.key === 'ArrowRight') stepPreview(1);
  else return;
  e.preventDefault();
  e.stopPropagation();
}, true);

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('is-error', isError);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), isError ? 5000 : 2200);
}

// ---------- small helpers ----------

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
