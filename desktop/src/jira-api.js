// Jira's data for the light issue view. The app asks Jira's REST API itself, signed in with the
// same sign-in as the Jira pages (their cookies), so no API token is needed.
//
// Images and icons on the Jira site need that sign-in too: they're given site-media:// addresses,
// which the app fetches the same way (see main.js).
//
// The light view draws Jira issues and GitLab items (gitlab-api.js) from the same shape: the
// side panel's fields and the lists of related items (sections) come ready to show.

const API = '/rest/api/3';
const ISSUE_FIELDS = 'summary,status,issuetype,priority,assignee,reporter,created,updated,labels,components,parent,subtasks,issuelinks,description,comment,attachment';
const MEDIA = 'site-media://site';

function createJiraApi({ session, site }) {
  async function call(p, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await session.fetch(site + p, {
        method,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          // Jira refuses changes made with a sign-in cookie (403, "XSRF check failed") unless the
          // request comes from its own site, the way its own pages' requests do: without these
          // the app's requests have no origin at all.
          Origin: site,
          Referer: `${site}/`,
          'X-Atlassian-Token': 'no-check',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error(`Couldn’t reach ${new URL(site).host}. Check your connection.`), { status: 0 });
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (e.g. a sign-in page)
    }
    if (!res.ok || (text && data === null)) {
      // A short plain-text answer (e.g. "XSRF check failed") says more than the number alone.
      const plain = data === null && !res.ok && text.length < 200 && !/</.test(text) ? text.trim() : '';
      const message = data?.errorMessages?.filter(Boolean).join(' ') ||
        (data?.errors && Object.values(data.errors).join(' ')) ||
        data?.message || (plain ? `Jira answered ${res.status}: ${plain}` : `Jira answered ${res.status}.`);
      throw Object.assign(new Error(message), { status: res.ok ? 401 : res.status });
    }
    return data;
  }

  // Jira answers "doesn't exist or you don't have permission" when you're signed out, too.
  async function signedOut(err) {
    if (err.status === 401) return true;
    if (err.status !== 404 && err.status !== 403) return false;
    try {
      await call(`${API}/myself`);
      return false;
    } catch (e) {
      return e.status === 401 || e.status === 403;
    }
  }

  const media = (u) => {
    if (!u) return null;
    if (u.startsWith(`${site}/`)) return MEDIA + u.slice(site.length);
    if (u.startsWith('/') && !u.startsWith('//')) return MEDIA + u;
    return u;
  };
  const siteRe = new RegExp(`(\\s(?:src|data-image-src)=["'])${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'g');
  const fixHtml = (html) => (html || '')
    .replace(siteRe, `$1${MEDIA}/`)
    .replace(/(\s(?:src|data-image-src)=["'])\/(?!\/)/g, `$1${MEDIA}/`)
    .replace(/(\shref=["'])\/(?!\/)/g, `$1${site}/`);

  const person = (u) => (u ? { name: u.displayName || u.name || 'Someone', avatar: u.avatarUrls?.['48x48'] || u.avatarUrls?.['32x32'] || null } : null);
  const status = (s) => (s ? { name: s.name, category: s.statusCategory?.key || 'new' } : null);
  const brief = (i) => {
    const f = i.fields || {};
    return {
      key: i.key,
      url: `${site}/browse/${i.key}`,
      summary: f.summary || '',
      status: status(f.status),
      type: f.issuetype ? { name: f.issuetype.name, icon: media(f.issuetype.iconUrl) } : null,
      priority: f.priority ? { name: f.priority.name, icon: media(f.priority.iconUrl) } : null,
      assignee: person(f.assignee),
      updated: f.updated || null,
    };
  };

  // Jira lists an issue's subtasks and linked issues without their assignees: look those up in
  // one search each (subtasks by their parent, linked issues by key). A failed lookup only
  // leaves the assignees out.
  const KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
  async function assignees(jql, max) {
    const data = await call(`${API}/search/jql?jql=${encodeURIComponent(jql)}&fields=assignee&maxResults=${Math.min(max, 100)}`);
    return new Map((data?.issues || []).map((x) => [x.key, person(x.fields?.assignee)]));
  }
  async function addAssignees(key, subtasks, linked) {
    const keys = [...new Set(linked.map((i) => i.key).filter((k) => KEY.test(k)))];
    const [ofSubtasks, ofLinked] = await Promise.all([
      subtasks.length && KEY.test(key) ? assignees(`parent = ${key}`, subtasks.length).catch(() => null) : null,
      keys.length ? assignees(`key in (${keys.join(',')})`, keys.length).catch(() => null) : null,
    ]);
    for (const [list, found] of [[subtasks, ofSubtasks], [linked, ofLinked]]) {
      if (!found) continue;
      for (const i of list) i.assignee = found.has(i.key) ? found.get(i.key) : i.assignee;
    }
  }

  return {
    site,

    async issue(key) {
      let i;
      try {
        i = await call(`${API}/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}&expand=renderedFields`);
      } catch (err) {
        if (await signedOut(err)) throw Object.assign(new Error('You’re signed out of Jira.'), { status: 401, signedOut: true });
        throw err;
      }
      const f = i.fields || {};
      const r = i.renderedFields || {};
      const rendered = r.comment?.comments || [];
      const comments = f.comment?.comments || [];
      // Until the lookup says otherwise, these rows' assignees are unknown (not "Unassigned").
      const unknown = (b) => ({ ...brief(b), assignee: undefined });
      const subtasks = (f.subtasks || []).map(unknown);
      const links = (f.issuelinks || []).filter((l) => l.outwardIssue || l.inwardIssue).map((l) => ({
        rel: l.outwardIssue ? l.type?.outward : l.type?.inward,
        issue: unknown(l.outwardIssue || l.inwardIssue),
      }));
      await addAssignees(i.key, subtasks, links.map((l) => l.issue));
      const b = brief(i);
      return {
        ...b,
        id: i.key,
        tabTitle: `[${i.key}] ${b.summary}`,
        reporter: person(f.reporter),
        created: f.created || null,
        labels: f.labels || [],
        components: (f.components || []).map((c) => c.name),
        parent: f.parent ? brief(f.parent) : null,
        subtasks,
        links,
        attachments: (f.attachment || []).map((a) => ({
          name: a.filename, size: a.size, url: a.content, thumbnail: media(a.thumbnail), mimeType: a.mimeType,
          // The full image, for the image preview.
          preview: /^image\//i.test(a.mimeType || '') ? media(a.content) : null,
        })),
        descriptionHtml: fixHtml(r.description) || plainHtml(f.description),
        comments: comments.map((c, n) => ({
          id: c.id,
          author: person(c.author),
          created: c.created,
          html: fixHtml((rendered.find((x) => x.id === c.id) || rendered[n])?.body) || plainHtml(c.body),
        })),
        commentTotal: f.comment?.total ?? comments.length,
        crumbs: [],
        sections: [
          { title: 'Subtasks', rows: subtasks.map((item) => ({ item })) },
          { title: 'Linked issues', rows: links.map((l) => ({ rel: l.rel, item: l.issue })) },
        ].filter((x) => x.rows.length),
        fields: [
          { label: 'Assignee', people: [b.assignee].filter(Boolean), empty: 'Unassigned' },
          { label: 'Reporter', people: [person(f.reporter)].filter(Boolean) },
          b.priority && { label: 'Priority', text: b.priority.name, icon: b.priority.icon },
          b.type && { label: 'Type', type: b.type },
          { label: 'Labels', chips: (f.labels || []).map((name) => ({ name })) },
          { label: 'Components', text: (f.components || []).map((c) => c.name).join(', ') },
          f.created && { label: 'Created', date: f.created },
          f.updated && { label: 'Updated', date: f.updated },
        ].filter(Boolean),
        commentHint: 'plain text',
      };
    },

    async transitions(key) {
      const data = await call(`${API}/issue/${encodeURIComponent(key)}/transitions`);
      return (data?.transitions || []).map((t) => ({ id: t.id, name: t.name, to: status(t.to) }));
    },

    async transition(key, id) {
      await call(`${API}/issue/${encodeURIComponent(key)}/transitions`, { method: 'POST', body: { transition: { id: String(id) } } });
    },

    async comment(key, text) {
      await call(`${API}/issue/${encodeURIComponent(key)}/comment`, { method: 'POST', body: { body: toAdf(text) } });
    },

    // An image or icon from the Jira site, for a jira-media:// address.
    media(pathAndQuery) {
      return session.fetch(site + pathAndQuery, { credentials: 'include' });
    },
  };
}

// Plain text → Atlassian Document Format (Jira Cloud's comment format).
function toAdf(text) {
  return {
    type: 'doc',
    version: 1,
    content: text.trim().split(/\n{2,}/).map((para) => ({
      type: 'paragraph',
      content: para.split('\n').flatMap((line, i) => [
        ...(i ? [{ type: 'hardBreak' }] : []),
        ...(line ? [{ type: 'text', text: line }] : []),
      ]),
    })),
  };
}

// When Jira gives no rendered HTML: Atlassian Document Format → escaped paragraphs.
function plainHtml(value) {
  const text = typeof value === 'string' ? value : adfText(value);
  return text.trim()
    ? text.trim().split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
    : '';
}
function adfText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return node.attrs?.text || '@someone';
  const inner = (node.content || []).map(adfText).join('');
  return /^(paragraph|heading|listItem|codeBlock|blockquote|tableRow)$/.test(node.type) ? `${inner}\n\n` : inner;
}
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

module.exports = { createJiraApi, MEDIA };
