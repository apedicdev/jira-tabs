// Demo backend: in-memory issues, so the app runs without Jira credentials.
// It answers the same calls as the real Jira backend in server.mjs.
const SITE = 'https://example.atlassian.net';
const HOUR = 3600e3;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const link = (key) => `<a href="${SITE}/browse/${key}">${key}</a>`;
const wait = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
const notFound = (key) => Object.assign(new Error(`Issue ${key} does not exist or you do not have permission to see it.`), { status: 404 });

const PEOPLE = {
  me: { name: 'Demo User', avatar: null },
  ana: { name: 'Ana Ribeiro', avatar: null },
  tom: { name: 'Tom Okafor', avatar: null },
  priya: { name: 'Priya Shah', avatar: null },
};

const STATUS = {
  todo: { name: 'To Do', category: 'new' },
  progress: { name: 'In Progress', category: 'indeterminate' },
  review: { name: 'In Review', category: 'indeterminate' },
  done: { name: 'Done', category: 'done' },
};

const SEED = [
  {
    key: 'DEMO-1', type: 'Epic', summary: 'Checkout redesign', status: 'progress', priority: 'High',
    assignee: 'ana', reporter: 'priya', hoursAgo: 30, labels: ['checkout', 'q4'], watching: true,
    description: `<p>Umbrella for the new checkout. Stories so far: ${link('DEMO-2')}, ${link('DEMO-5')} and ${link('DEMO-10')}.</p><p>Defects to fix along the way: ${link('DEMO-3')}.</p>`,
  },
  {
    key: 'DEMO-2', type: 'Story', summary: 'Show a delivery estimate on the basket page', status: 'progress', priority: 'Medium',
    assignee: 'me', reporter: 'priya', hoursAgo: 2, parent: 'DEMO-1', labels: ['checkout'],
    description: `<p>As a customer, I want to see when my order will arrive before I pay, so that I can pick the right delivery option.</p><h3>Acceptance criteria</h3><ol><li>The basket shows an estimated delivery date for each delivery option.</li><li>The estimate updates when the postcode changes.</li><li>When no estimate is available, the line reads <em>“Delivery date confirmed at checkout”</em>.</li></ol><p>API work: ${link('DEMO-6')}. UI work: ${link('DEMO-7')}.</p>`,
    comments: [
      ['ana', 26, `<p>The delivery-window endpoint is tracked in ${link('DEMO-6')}; it should be ready by Thursday.</p>`],
      ['tom', 4, '<p>Copy approved by marketing 👍</p>'],
    ],
  },
  {
    key: 'DEMO-3', type: 'Bug', summary: 'Promo code field rejects lowercase codes', status: 'todo', priority: 'Highest',
    assignee: 'me', reporter: 'tom', hoursAgo: 5, labels: ['bug-bash'],
    description: '<h3>Steps to reproduce</h3><ol><li>Add any product to the basket.</li><li>Enter <code>welcome10</code> in the promo code field.</li><li>Press <strong>Apply</strong>.</li></ol><p><strong>Expected:</strong> the 10% discount is applied.<br><strong>Actual:</strong> “This code is not valid”. <code>WELCOME10</code> works.</p>',
    comments: [['priya', 3, `<p>Same root cause as ${link('DEMO-8')}? Both go through the pricing service.</p>`]],
  },
  {
    key: 'DEMO-4', type: 'Task', summary: 'Upgrade the order service to Node 22', status: 'review', priority: 'Medium',
    assignee: 'tom', reporter: 'ana', hoursAgo: 20, labels: ['tech-debt'], watching: true,
    description: `<p>Node 18 is out of support. Upgrade the runtime and the base image.</p><pre><code>FROM node:22-alpine\nRUN npm ci --omit=dev</code></pre><p>Blocks ${link('DEMO-2')}: the estimate library needs Node 20 or later.</p>`,
  },
  {
    key: 'DEMO-5', type: 'Story', summary: 'Let customers save payment methods', status: 'todo', priority: 'Medium',
    assignee: 'me', reporter: 'priya', hoursAgo: 48, parent: 'DEMO-1', labels: ['checkout', 'payments'],
    description: '<p>As a returning customer, I want to reuse a saved card, so that checkout is quicker.</p>',
  },
  {
    key: 'DEMO-6', type: 'Sub-task', summary: 'API: expose delivery windows', status: 'progress', priority: 'Medium',
    assignee: 'me', reporter: 'ana', hoursAgo: 3, parent: 'DEMO-2',
    description: '<p>Add <code>GET /delivery-windows?postcode=…</code> returning the earliest and latest date per carrier.</p>',
  },
  {
    key: 'DEMO-7', type: 'Sub-task', summary: 'UI: estimate badge on basket lines', status: 'todo', priority: 'Low',
    assignee: 'ana', reporter: 'ana', hoursAgo: 6, parent: 'DEMO-2', watching: true,
    description: `<p>Uses the endpoint from ${link('DEMO-6')}.</p>`,
  },
  {
    key: 'DEMO-8', type: 'Bug', summary: 'Order confirmation email shows the wrong currency symbol', status: 'done', priority: 'High',
    assignee: 'priya', reporter: 'tom', hoursAgo: 72,
    description: '<p>Orders paid in EUR show “£” in the confirmation email.</p>',
    comments: [['priya', 70, '<p>Fixed: the template now uses the order currency instead of the store default.</p>']],
  },
  {
    key: 'DEMO-9', type: 'Task', summary: 'Write QA steps for the basket changes', status: 'todo', priority: 'Low',
    assignee: 'me', reporter: 'me', hoursAgo: 12,
    description: `<p>Cover ${link('DEMO-2')} and ${link('DEMO-3')}.</p><p>Try the links in this description: each opens in a tab, and an issue that already has a tab is reused instead of opened again.</p>`,
  },
  {
    key: 'DEMO-10', type: 'Story', summary: 'Gift message at checkout', status: 'todo', priority: 'Low',
    assignee: null, reporter: 'priya', hoursAgo: 100, parent: 'DEMO-1', description: '',
  },
];

// [from, outward name, inward name, to]
const LINKS = [
  ['DEMO-4', 'blocks', 'is blocked by', 'DEMO-2'],
  ['DEMO-3', 'relates to', 'relates to', 'DEMO-8'],
];

export function createDemoBackend() {
  const now = Date.now();
  let seq = 100;
  const issues = new Map(SEED.map((s) => [s.key, {
    ...s,
    updated: now - s.hoursAgo * HOUR,
    created: now - (s.hoursAgo + 240) * HOUR,
    comments: (s.comments || []).map(([author, h, html]) => ({ id: String(++seq), author, created: now - h * HOUR, html })),
  }]));
  const viewed = [];

  const get = (key) => {
    const i = issues.get(key);
    if (!i) throw notFound(key);
    return i;
  };
  const iso = (t) => new Date(t).toISOString();
  const text = (html) => html.replace(/<[^>]+>/g, ' ');
  const brief = (i) => ({
    key: i.key,
    url: `${SITE}/browse/${i.key}`,
    summary: i.summary,
    status: STATUS[i.status],
    type: { name: i.type, icon: null },
    priority: { name: i.priority, icon: null },
    assignee: PEOPLE[i.assignee] || null,
    updated: iso(i.updated),
  });

  return {
    info: () => ({ demo: true, site: SITE, flavour: 'demo' }),
    myself: async () => PEOPLE.me,

    // Understands just enough JQL for the built-in filters and text search.
    async search(jql) {
      await wait();
      const q = jql.toLowerCase();
      const history = /issuehistory\(\)/.test(q);
      let list = history ? viewed.map((k) => issues.get(k)) : [...issues.values()];
      const needle = /text\s*~\s*"((?:[^"\\]|\\.)*)"/i.exec(jql)?.[1]?.replace(/\\(.)/g, '$1').toLowerCase();
      if (needle) list = list.filter((i) => `${i.key} ${i.summary} ${text(i.description)}`.toLowerCase().includes(needle));
      if (/assignee\s*=\s*currentuser\(\)/.test(q)) list = list.filter((i) => i.assignee === 'me');
      if (/reporter\s*=\s*currentuser\(\)/.test(q)) list = list.filter((i) => i.reporter === 'me');
      if (/watcher\s*=\s*currentuser\(\)/.test(q)) list = list.filter((i) => i.watching);
      if (/resolution\s*=\s*unresolved|statuscategory\s*!=\s*done/.test(q)) list = list.filter((i) => i.status !== 'done');
      const since = /updated\s*>=\s*-(\d+)([hdw])/.exec(q);
      if (since) list = list.filter((i) => i.updated >= Date.now() - since[1] * { h: 1, d: 24, w: 168 }[since[2]] * HOUR);
      const project = /project\s*(?:=|in)\s*\(?\s*"?([a-z0-9_]+)/.exec(q)?.[1];
      if (project && project !== 'demo') list = [];
      if (!history) list.sort((a, b) => (/order by created/.test(q) ? b.created - a.created : b.updated - a.updated));
      return { issues: list.map(brief) };
    },

    async issue(key) {
      await wait();
      const i = get(key);
      viewed.splice(0, viewed.length, key, ...viewed.filter((k) => k !== key));
      return {
        ...brief(i),
        reporter: PEOPLE[i.reporter] || null,
        created: iso(i.created),
        labels: i.labels || [],
        components: [],
        parent: i.parent ? brief(get(i.parent)) : null,
        subtasks: [...issues.values()].filter((s) => s.parent === key && s.type === 'Sub-task').map(brief),
        links: LINKS.flatMap(([from, outward, inward, to]) =>
          from === key ? [{ rel: outward, issue: brief(get(to)) }] : to === key ? [{ rel: inward, issue: brief(get(from)) }] : []),
        attachments: [],
        descriptionHtml: i.description,
        comments: i.comments.map((c) => ({ id: c.id, author: PEOPLE[c.author], created: iso(c.created), html: c.html })),
        commentTotal: i.comments.length,
      };
    },

    async transitions(key) {
      const i = get(key);
      return {
        transitions: Object.entries(STATUS).filter(([id]) => id !== i.status).map(([id, s]) => ({ id, name: s.name, to: s })),
      };
    },

    async transition(key, id) {
      await wait();
      const i = get(key);
      if (!STATUS[id]) throw Object.assign(new Error('Unknown transition'), { status: 400 });
      i.status = id;
      i.updated = Date.now();
      return { ok: true };
    },

    async comment(key, body) {
      await wait();
      const i = get(key);
      const html = body.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
      i.comments.push({ id: String(++seq), author: 'me', created: Date.now(), html });
      i.updated = Date.now();
      return { ok: true };
    },

    raw: async () => new Response('Not available in demo mode', { status: 404, headers: { 'Content-Type': 'text/plain' } }),
  };
}
