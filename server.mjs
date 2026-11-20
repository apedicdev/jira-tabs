#!/usr/bin/env node
// Jira Tabs server: serves the PWA from ./public and forwards API calls to Jira
// with the credentials from .env. No dependencies; Node 18 or newer.
//
// Why a server at all: Jira Cloud refuses to be shown inside an iframe and does not
// let a web page on another site call its REST API, so the app talks to this
// localhost proxy, which holds your token and calls Jira for it.
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoBackend } from './demo.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
loadEnv(path.join(ROOT, '.env'));

const env = process.env;
const PORT = Number(env.PORT) || 4300;
const HOST = env.HOST || '127.0.0.1';
const SITE = (env.JIRA_BASE_URL || '').trim().replace(/\/+$/, '');
const EMAIL = (env.JIRA_EMAIL || '').trim();
const TOKEN = (env.JIRA_API_TOKEN || '').trim();
const PAT = (env.JIRA_PAT || '').trim();
const DEMO = env.DEMO === '1' || !SITE || !(PAT || (EMAIL && TOKEN));
const ALLOWED_HOSTS = new Set([
  `localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`,
  ...(env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean),
]);

const backend = DEMO ? createDemoBackend() : createJiraBackend();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const server = http.createServer(async (req, res) => {
  try {
    // Only answer requests addressed to this machine (blocks DNS-rebinding tricks).
    if (!ALLOWED_HOSTS.has(req.headers.host || '')) throw httpError(421, 'Unexpected Host header');
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/jira/')) return await handleRaw(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    if (!err.status) console.error(err);
    if (res.headersSent) return res.end();
    sendJson(res, err.status || 500, { error: err.message || 'Server error' });
  }
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Set PORT in .env to use another.` : err);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Jira Tabs → http://localhost:${PORT}`);
  console.log(DEMO
    ? '  Demo data. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN in .env to use your Jira.'
    : `  Connected to ${SITE} (${PAT && !(EMAIL && TOKEN) ? 'Data Center, personal access token' : 'Cloud, API token'})`);
});

/* ---------------------------------------------------------------- routes */

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (req.method !== 'GET') {
    // Writes need a custom header, which a page on another site cannot send without
    // a CORS preflight that this server never approves.
    if (req.headers['x-jira-tabs'] !== '1') throw httpError(403, 'Missing X-Jira-Tabs header');
    if (req.headers.origin && !ALLOWED_HOSTS.has(hostOf(req.headers.origin))) throw httpError(403, 'Cross-site request refused');
  }

  if (req.method === 'GET' && p === '/api/config') {
    const me = await backend.myself().catch((err) => ({ error: err.message }));
    return sendJson(res, 200, { ...backend.info(), me });
  }
  if (req.method === 'GET' && p === '/api/search') {
    const jql = url.searchParams.get('jql') || 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
    return sendJson(res, 200, await backend.search(jql));
  }

  const m = p.match(/^\/api\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:\/(transitions|comment))?$/);
  if (m) {
    const key = m[1].toUpperCase();
    const sub = m[2];
    if (req.method === 'GET' && !sub) return sendJson(res, 200, await backend.issue(key));
    if (req.method === 'GET' && sub === 'transitions') return sendJson(res, 200, await backend.transitions(key));
    if (req.method === 'POST' && sub === 'transitions') {
      const { id } = await readJson(req);
      if (!id) throw httpError(400, 'Transition id is required');
      return sendJson(res, 200, await backend.transition(key, String(id)));
    }
    if (req.method === 'POST' && sub === 'comment') {
      const { text } = await readJson(req);
      if (!String(text || '').trim()) throw httpError(400, 'Comment text is required');
      return sendJson(res, 201, await backend.comment(key, String(text)));
    }
  }
  throw httpError(404, 'Not found');
}

// Read-only pass-through for things Jira only serves to signed-in users:
// attachments, inline images, issue-type and priority icons.
async function handleRaw(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Read-only');
  const upstream = await backend.raw(url.pathname.slice('/jira'.length) + url.search);
  const headers = {
    'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    // Whatever Jira returns runs in a sandbox, never as part of this app.
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
  };
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) headers['Content-Disposition'] = disposition;
  res.writeHead(upstream.status, headers);
  res.end(req.method === 'HEAD' ? undefined : Buffer.from(await upstream.arrayBuffer()));
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Method not allowed');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { throw httpError(400, 'Bad path'); }
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) throw httpError(403, 'Forbidden');
  let body;
  try { body = await readFile(file); } catch { throw httpError(404, 'Not found'); }
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(type.startsWith('text/html') && { 'Content-Security-Policy': CSP }),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/* ---------------------------------------------------------------- Jira backend */

function createJiraBackend() {
  const cloud = Boolean(EMAIL && TOKEN);
  const API = cloud ? '/rest/api/3' : '/rest/api/2';
  const auth = cloud ? `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}` : `Bearer ${PAT}`;
  const ISSUE_FIELDS = 'summary,status,issuetype,priority,assignee,reporter,created,updated,labels,components,parent,subtasks,issuelinks,description,comment,attachment';
  const LIST_FIELDS = 'summary,status,issuetype,priority,assignee,updated';

  async function call(p, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(SITE + p, {
        method,
        headers: { Authorization: auth, Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
        body: body && JSON.stringify(body),
      });
    } catch (err) {
      throw httpError(502, `Cannot reach ${SITE}: ${err.cause?.code || err.message}`);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const msg = data?.errorMessages?.filter(Boolean).join('; ')
        || (data?.errors && Object.values(data.errors).join('; '))
        || data?.message
        || `Jira answered ${res.status} ${res.statusText}`;
      throw httpError(res.status === 401 || res.status === 403 || res.status === 404 || res.status === 400 ? res.status : 502, msg);
    }
    return data;
  }

  // Jira-hosted images need our credentials, so route them through /jira/.
  const proxied = (u) => (u && u.startsWith(SITE + '/') ? '/jira' + u.slice(SITE.length) : u || null);
  const siteRe = new RegExp(`(\\s(?:src|data-image-src)=["'])${SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'g');
  const fixHtml = (html) => (html || '')
    .replace(siteRe, '$1/jira/')
    .replace(/(\s(?:src|data-image-src)=["'])\/(?!\/|jira\/)/g, '$1/jira/')
    .replace(/(\shref=["'])\/(?!\/)/g, `$1${SITE}/`);

  const person = (u) => (u ? { name: u.displayName || u.name, avatar: u.avatarUrls?.['48x48'] || u.avatarUrls?.['32x32'] || null } : null);
  const status = (s) => (s ? { name: s.name, category: s.statusCategory?.key || 'new' } : null);
  const brief = (i) => {
    const f = i.fields || {};
    return {
      key: i.key,
      url: `${SITE}/browse/${i.key}`,
      summary: f.summary || '',
      status: status(f.status),
      type: f.issuetype ? { name: f.issuetype.name, icon: proxied(f.issuetype.iconUrl) } : null,
      priority: f.priority ? { name: f.priority.name, icon: proxied(f.priority.iconUrl) } : null,
      assignee: person(f.assignee),
      updated: f.updated || null,
    };
  };

  return {
    info: () => ({ demo: false, site: SITE, flavour: cloud ? 'cloud' : 'data-center' }),
    myself: async () => person(await call(`${API}/myself`)),

    async search(jql) {
      const q = new URLSearchParams({ jql, fields: LIST_FIELDS, maxResults: '50' });
      const data = await call(`${API}/${cloud ? 'search/jql' : 'search'}?${q}`);
      return { issues: (data.issues || []).map(brief) };
    },

    async issue(key) {
      const i = await call(`${API}/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}&expand=renderedFields`);
      const f = i.fields || {};
      const r = i.renderedFields || {};
      const rendered = r.comment?.comments || [];
      const comments = f.comment?.comments || [];
      return {
        ...brief(i),
        reporter: person(f.reporter),
        created: f.created || null,
        labels: f.labels || [],
        components: (f.components || []).map((c) => c.name),
        parent: f.parent ? brief(f.parent) : null,
        subtasks: (f.subtasks || []).map(brief),
        links: (f.issuelinks || []).map((l) => ({
          rel: l.outwardIssue ? l.type?.outward : l.type?.inward,
          issue: brief(l.outwardIssue || l.inwardIssue),
        })),
        attachments: (f.attachment || []).map((a) => ({ name: a.filename, size: a.size, url: proxied(a.content) })),
        descriptionHtml: fixHtml(r.description) || plainHtml(f.description),
        comments: comments.map((c, n) => ({
          id: c.id,
          author: person(c.author),
          created: c.created,
          html: fixHtml((rendered.find((x) => x.id === c.id) || rendered[n])?.body) || plainHtml(c.body),
        })),
        commentTotal: f.comment?.total ?? comments.length,
      };
    },

    async transitions(key) {
      const data = await call(`${API}/issue/${encodeURIComponent(key)}/transitions`);
      return { transitions: (data.transitions || []).map((t) => ({ id: t.id, name: t.name, to: status(t.to) })) };
    },

    async transition(key, id) {
      await call(`${API}/issue/${encodeURIComponent(key)}/transitions`, { method: 'POST', body: { transition: { id } } });
      return { ok: true };
    },

    async comment(key, text) {
      await call(`${API}/issue/${encodeURIComponent(key)}/comment`, { method: 'POST', body: { body: cloud ? toAdf(text) : text } });
      return { ok: true };
    },

    raw: (pathAndQuery) => fetch(SITE + pathAndQuery, { headers: { Authorization: auth } }),
  };
}

// Plain text → Atlassian Document Format (Jira Cloud's comment body format).
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

// Fallback when Jira gives no rendered HTML: wiki text (v2) or ADF (v3) → escaped paragraphs.
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

/* ---------------------------------------------------------------- helpers */

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw httpError(413, 'Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw httpError(400, 'Invalid JSON'); }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function hostOf(origin) {
  try { return new URL(origin).host; } catch { return ''; }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
