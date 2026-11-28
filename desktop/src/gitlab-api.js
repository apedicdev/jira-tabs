// GitLab's data for the light view of issues and merge requests. Like jira-api.js, the app asks
// GitLab itself, signed in with the same sign-in as the GitLab pages (their cookies), so no
// access token is needed.
//
// Reading uses GitLab's GraphQL API with GET requests, which a sign-in cookie may make. Changes
// (closing, approving, commenting) use its REST API, which accepts a sign-in cookie only with the
// page's CSRF token: the app reads it from the item's own page the first time it changes
// something.
//
// Item keys are "group/project#12" (an issue or other work item) and "group/project!34" (a merge
// request).

const { MEDIA } = require('./jira-api');

const KEY = /^(\w[\w.-]*(?:\/\w[\w.-]*)+)([#!])(\d+)$/;
const PERSON = 'name username avatarUrl webUrl';
const ROW = 'iid title state reference(full: true) webUrl';
const NOTES = `notes(last: 40) { nodes { id bodyHtml system internal createdAt author { ${PERSON} } } }`;
const COMMON = `iid title descriptionHtml state webUrl createdAt updatedAt reference(full: true) userNotesCount
  author { ${PERSON} } assignees { nodes { ${PERSON} } } labels { nodes { title color textColor } }
  milestone { title webPath } ${NOTES}`;
const ROW_ASSIGNEES = 'widgets { ... on WorkItemWidgetAssignees { assignees { nodes { name avatarUrl } } } }';

// Everything the light view shows. Newer GitLab only (work item status, links, approvals); an
// older GitLab that doesn't know a field gets the basic query instead.
const QUERY = {
  '#': {
    full: `query($path: ID!, $iid: String!) { currentUser { username } project(fullPath: $path) { fullPath
      issue(iid: $iid) { ${COMMON} closedAt dueDate type userPermissions { updateIssue }
        status { name category }
        relatedMergeRequests(first: 20) { nodes { ${ROW} draft assignees { nodes { name avatarUrl } } } } }
      workItems(iid: $iid, first: 1) { nodes { widgets {
        ... on WorkItemWidgetLinkedItems { linkedItems(first: 50) { nodes { linkType workItem { ${ROW} workItemType { name } ${ROW_ASSIGNEES} } } } }
        ... on WorkItemWidgetHierarchy { parent { ${ROW} workItemType { name } }
          children(first: 50) { nodes { ${ROW} workItemType { name } ${ROW_ASSIGNEES} } } } } } } } }`,
    basic: `query($path: ID!, $iid: String!) { currentUser { username } project(fullPath: $path) { fullPath
      issue(iid: $iid) { ${COMMON} closedAt dueDate type userPermissions { updateIssue } } } }`,
  },
  '!': {
    full: `query($path: ID!, $iid: String!) { currentUser { username } project(fullPath: $path) { fullPath
      mergeRequest(iid: $iid) { ${COMMON} draft mergedAt sourceBranch targetBranch reviewers { nodes { ${PERSON} } }
        headPipeline { status path } conflicts diffStatsSummary { additions deletions fileCount } commitCount
        approved approvalsRequired approvalsLeft approvedBy { nodes { ${PERSON} } } detailedMergeStatus
        userPermissions { updateMergeRequest canApprove } } } }`,
    basic: `query($path: ID!, $iid: String!) { currentUser { username } project(fullPath: $path) { fullPath
      mergeRequest(iid: $iid) { ${COMMON} draft mergedAt sourceBranch targetBranch reviewers { nodes { ${PERSON} } }
        headPipeline { status path } conflicts commitCount userPermissions { updateMergeRequest } } } }`,
  },
};

// GitLab's states and statuses → the light view's colours (named after Jira's: new = grey,
// indeterminate = blue, done = green; plus danger = red and merged = purple).
const ISSUE_STATE = { opened: ['Open', 'done'], closed: ['Closed', 'indeterminate'], OPEN: ['Open', 'done'], CLOSED: ['Closed', 'indeterminate'] };
const MR_STATE = { opened: ['Open', 'done'], merged: ['Merged', 'merged'], closed: ['Closed', 'danger'], locked: ['Locked', 'new'] };
const WORK_STATUS = { triage: 'new', to_do: 'new', in_progress: 'indeterminate', done: 'done', canceled: 'danger' };
const PIPELINE = { SUCCESS: 'done', FAILED: 'danger', RUNNING: 'indeterminate', PENDING: 'indeterminate', CREATED: 'indeterminate', PREPARING: 'indeterminate', WAITING_FOR_RESOURCE: 'indeterminate', SCHEDULED: 'indeterminate' };
const MERGE_STATUS = {
  MERGEABLE: 'Ready to merge', CI_MUST_PASS: 'Pipeline must succeed', CI_STILL_RUNNING: 'Pipeline still running',
  NOT_APPROVED: 'Needs approval', DISCUSSIONS_NOT_RESOLVED: 'Unresolved threads', DRAFT_STATUS: 'Draft',
  CONFLICT: 'Has conflicts', NEED_REBASE: 'Needs a rebase', BLOCKED_STATUS: 'Blocked by another merge request',
  CHECKING: 'Checking…', UNCHECKED: 'Not checked yet', NOT_OPEN: 'Not open', JIRA_ASSOCIATION_MISSING: 'Needs a Jira issue key',
  REQUESTED_CHANGES: 'Changes requested', MERGE_TIME: 'Can’t merge before its set time', SECURITY_POLICY_VIOLATIONS: 'Security policy',
};
const LINK_TYPE = { relates_to: 'relates to', blocks: 'blocks', is_blocked_by: 'is blocked by', RELATED: 'relates to', BLOCKS: 'blocks', BLOCKED_BY: 'is blocked by' };
const words = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const pipelineStatus = (p) => p && { name: words(p.status), category: PIPELINE[p.status] || 'new' };
const mrStatus = (state, draft) => (state === 'opened' && draft ? { name: 'Draft', category: 'new' } : (([name, category]) => ({ name, category }))(MR_STATE[state] || [words(state), 'new']));
const issueStatus = (state) => (([name, category]) => ({ name, category }))(ISSUE_STATE[state] || [words(state), 'new']);

function createGitlabApi({ session, site }) {
  const siteHost = new URL(site).host;
  let csrf = null;

  async function call(p, { method = 'GET', body, token } = {}) {
    let res;
    try {
      res = await session.fetch(site + p, {
        method,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          // Requests from GitLab's own site, as its pages' requests are.
          Origin: site,
          Referer: `${site}/`,
          ...(token ? { 'X-CSRF-Token': token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error(`Couldn’t reach ${siteHost}. Check your connection.`), { status: 0 });
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (e.g. a sign-in page)
    }
    if (!res.ok || (text && data === null)) {
      const raw = data?.message ?? data?.error ?? data?.errors;
      const message = (typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([k, v]) => `${k} ${[].concat(v).join(', ')}`).join('; ') : '') ||
        `GitLab answered ${res.status}.`;
      throw Object.assign(new Error(message), { status: res.ok ? 401 : res.status });
    }
    return data;
  }

  async function graphql(query, variables) {
    const data = await call(`/api/graphql?query=${encodeURIComponent(query)}&variables=${encodeURIComponent(JSON.stringify(variables))}`);
    return data || {};
  }

  // The CSRF token GitLab puts in every page, which lets the sign-in cookie make changes.
  async function csrfToken(itemUrl, fresh) {
    if (csrf && !fresh) return csrf;
    let html = '';
    try {
      const res = await session.fetch(itemUrl, { credentials: 'include', headers: { Accept: 'text/html' } });
      html = await res.text();
    } catch {
      throw Object.assign(new Error(`Couldn’t reach ${siteHost}. Check your connection.`), { status: 0 });
    }
    const m = /<meta\s+name="csrf-token"\s+content="([^"]+)"/i.exec(html) || /<meta\s+content="([^"]+)"\s+name="csrf-token"/i.exec(html);
    if (!m) throw Object.assign(new Error('You’re signed out of GitLab.'), { status: 401, signedOut: true });
    csrf = m[1].replace(/&amp;/g, '&').replace(/&#x2B;|&#43;/gi, '+').replace(/&#x2F;|&#47;/gi, '/').replace(/&#x3D;|&#61;/gi, '=');
    return csrf;
  }

  // A change, with the CSRF token (fetched again once if GitLab no longer takes it).
  async function change(item, p, options) {
    const pageUrl = webPath(item);
    try {
      return await call(p, { ...options, token: await csrfToken(pageUrl) });
    } catch (err) {
      if (![401, 403, 422].includes(err.status)) throw err;
      return call(p, { ...options, token: await csrfToken(pageUrl, true) });
    }
  }

  const parse = (key) => {
    const m = KEY.exec(key);
    if (!m) throw Object.assign(new Error('That isn’t an issue or merge request.'), { status: 400 });
    return { path: m[1], sign: m[2], iid: m[3], isMr: m[2] === '!' };
  };
  const webPath = (item) => `${site}/${item.path}/-/${item.isMr ? 'merge_requests' : 'issues'}/${item.iid}`;
  const restPath = (item) => `/api/v4/projects/${encodeURIComponent(item.path)}/${item.isMr ? 'merge_requests' : 'issues'}/${item.iid}`;

  // ---------- turning GitLab's data into the light view's ----------

  const abs = (u) => (!u ? null : /^https?:\/\//i.test(u) ? u : u.startsWith('/') && !u.startsWith('//') ? site + u : null);
  const media = (u) => {
    if (!u) return null;
    if (u.startsWith(`${site}/`)) return MEDIA + u.slice(site.length);
    if (u.startsWith('/') && !u.startsWith('//')) return MEDIA + u;
    return /^https:\/\//i.test(u) ? u : null;
  };
  const person = (u) => (u ? { name: u.name || u.username || 'Someone', avatar: media(u.avatarUrl) } : null);
  const people = (conn) => (conn?.nodes || []).map(person);
  const siteRe = new RegExp(`(\\s(?:src|data-src)=["'])${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'g');
  // GitLab's rendered Markdown: images load lazily from data-src; task list boxes become marks
  // (the light view shows no form controls); links and images on the site get full addresses.
  const fixHtml = (html) => (html || '')
    .replace(/<img\b[^>]*>/gi, (tag) => (/\sdata-src=/i.test(tag) ? tag.replace(/\ssrc=(["'])[^"']*\1/i, '').replace(/\sdata-src=/i, ' src=') : tag))
    .replace(/<input\b[^>]*type=["']checkbox["'][^>]*>\s*/gi, (tag) => (/\schecked\b/i.test(tag) ? '☑ ' : '☐ '))
    .replace(siteRe, `$1${MEDIA}/`)
    .replace(/(\ssrc=["'])\/(?!\/)/g, `$1${MEDIA}/`)
    .replace(/(\shref=["'])\/(?!\/)/g, `$1${site}/`);

  // "group/project#12" → "#12" when it's in the same project.
  const shortRef = (ref, fullPath) => (ref && ref.toLowerCase().startsWith(`${fullPath.toLowerCase()}`) && /^[#!&]\d+$/.test(ref.slice(fullPath.length)) ? ref.slice(fullPath.length) : ref);
  const typeName = (t) => ({ ISSUE: 'Issue', INCIDENT: 'Incident', TASK: 'Task', TEST_CASE: 'Test case', REQUIREMENT: 'Requirement', OBJECTIVE: 'Objective', KEY_RESULT: 'Key result', EPIC: 'Epic' })[t] || words(t);
  const row = (x, fullPath, type) => ({
    key: shortRef(x.reference, fullPath),
    url: x.webUrl,
    summary: x.title,
    status: type === 'Merge request' ? mrStatus(x.state, x.draft) : issueStatus(x.state),
    type: { name: type || x.workItemType?.name || 'Issue' },
    assignee: (() => {
      const list = x.assignees?.nodes || x.widgets?.find((w) => w?.assignees)?.assignees?.nodes;
      return list ? person(list[0]) : undefined;
    })(),
  });
  const date = (label, value) => value && { label, date: value };
  const chips = (labels) => (labels?.nodes || []).map((l) => ({ name: l.title, color: l.color, textColor: l.textColor }));

  function shape(item, project, x, me) {
    const isMr = item.isMr;
    const fullPath = project.fullPath;
    const ref = `${item.sign}${x.iid}`;
    const notes = (x.notes?.nodes || []).filter((n) => !n.system).slice(-20);
    const assignees = people(x.assignees);
    const widgets = project.workItems?.nodes?.[0]?.widgets || [];
    const linked = widgets.find((w) => w?.linkedItems)?.linkedItems?.nodes || [];
    const hierarchy = widgets.find((w) => w && 'children' in w) || {};
    const children = hierarchy.children?.nodes || [];
    const parent = hierarchy.parent;
    const iApproved = !!me && (x.approvedBy?.nodes || []).some((p) => p.username === me);

    const status = isMr ? mrStatus(x.state, x.draft) : issueStatus(x.state);
    const transitions = [];
    if (isMr) {
      const canEdit = x.userPermissions?.updateMergeRequest;
      if (x.state === 'opened') {
        if (iApproved) transitions.push({ id: 'unapprove', name: 'Revoke approval' });
        else if (x.userPermissions?.canApprove) transitions.push({ id: 'approve', name: 'Approve' });
        if (canEdit) transitions.push(x.draft ? { id: 'ready', name: 'Mark as ready' } : { id: 'draft', name: 'Mark as draft' });
        if (canEdit) transitions.push({ id: 'close', name: 'Close merge request' });
      } else if (x.state === 'closed' && canEdit) {
        transitions.push({ id: 'reopen', name: 'Reopen merge request' });
      }
    } else if (x.userPermissions?.updateIssue) {
      transitions.push(x.state === 'opened' ? { id: 'close', name: 'Close issue' } : { id: 'reopen', name: 'Reopen issue' });
    }

    const fields = isMr ? [
      { label: 'Author', people: [person(x.author)].filter(Boolean) },
      { label: 'Assignees', people: assignees, empty: 'Unassigned' },
      { label: 'Reviewers', people: people(x.reviewers), empty: 'None' },
      x.approvalsRequired !== undefined && {
        label: 'Approvals',
        people: people(x.approvedBy),
        text: x.approved && !x.approvalsLeft ? 'Approved' : x.approvalsLeft ? `${x.approvalsLeft} more needed` : (x.approvedBy?.nodes || []).length ? '' : 'None yet',
      },
      x.headPipeline && { label: 'Pipeline', status: pipelineStatus(x.headPipeline), url: abs(x.headPipeline.path) },
      x.state === 'opened' && (x.detailedMergeStatus || x.conflicts) && { label: 'Merge', text: x.conflicts ? 'Has conflicts' : MERGE_STATUS[x.detailedMergeStatus] || words(x.detailedMergeStatus) },
      x.diffStatsSummary && { label: 'Changes', text: `+${x.diffStatsSummary.additions} −${x.diffStatsSummary.deletions} · ${x.diffStatsSummary.fileCount} file${x.diffStatsSummary.fileCount === 1 ? '' : 's'}${x.commitCount ? ` · ${x.commitCount} commit${x.commitCount === 1 ? '' : 's'}` : ''}` },
      { label: 'Labels', chips: chips(x.labels) },
      x.milestone && { label: 'Milestone', text: x.milestone.title, url: abs(x.milestone.webPath) },
      date('Created', x.createdAt),
      date('Updated', x.updatedAt),
      date('Merged', x.mergedAt),
    ] : [
      x.status && { label: 'Status', status: { name: x.status.name, category: WORK_STATUS[x.status.category] || 'new' } },
      { label: 'Assignees', people: assignees, empty: 'Unassigned' },
      { label: 'Author', people: [person(x.author)].filter(Boolean) },
      { label: 'Labels', chips: chips(x.labels) },
      x.milestone && { label: 'Milestone', text: x.milestone.title, url: abs(x.milestone.webPath) },
      x.dueDate && { label: 'Due', date: x.dueDate },
      x.type && x.type !== 'ISSUE' && { label: 'Type', text: typeName(x.type) },
      date('Created', x.createdAt),
      date('Updated', x.updatedAt),
      date('Closed', x.closedAt),
    ];

    const sections = isMr ? [] : [
      { title: 'Child items', rows: children.map((c) => ({ item: row(c, fullPath) })) },
      { title: 'Linked items', rows: linked.filter((l) => l.workItem).map((l) => ({ rel: LINK_TYPE[l.linkType] || words(l.linkType), item: row(l.workItem, fullPath) })) },
      { title: 'Related merge requests', rows: (x.relatedMergeRequests?.nodes || []).map((m) => ({ item: row(m, fullPath, 'Merge request') })) },
    ].filter((s) => s.rows.length);

    return {
      id: `${fullPath}${ref}`,
      key: ref,
      tabTitle: `${x.title} (${ref})`,
      url: x.webUrl,
      summary: x.title,
      status,
      type: { name: isMr ? 'Merge request' : typeName(x.type || 'ISSUE') },
      subtitle: isMr ? { from: x.sourceBranch, to: x.targetBranch } : null,
      crumbs: [{ label: fullPath, url: `${site}/${fullPath}` }],
      parent: parent ? { ...row(parent, fullPath), assignee: undefined } : null,
      updated: x.updatedAt,
      created: x.createdAt,
      fields: fields.filter(Boolean),
      sections,
      attachments: [],
      descriptionHtml: fixHtml(x.descriptionHtml),
      comments: notes.map((n) => ({ id: n.id, author: person(n.author), created: n.createdAt, html: fixHtml(n.bodyHtml), internal: !!n.internal })),
      commentTotal: x.userNotesCount ?? notes.length,
      transitions,
      commentHint: 'Markdown',
    };
  }

  return {
    site,

    async issue(key) {
      const item = parse(key);
      const variables = { path: item.path, iid: item.iid };
      let res = await graphql(QUERY[item.sign].full, variables);
      // An older GitLab that doesn't know some of the fields answers with errors and no data.
      if (res.errors && !res.data?.project) res = await graphql(QUERY[item.sign].basic, variables);
      if (res.errors && !res.data) throw Object.assign(new Error(res.errors.map((e) => e.message).join(' ')), { status: 400 });
      const me = res.data?.currentUser?.username;
      if (!me) throw Object.assign(new Error('You’re signed out of GitLab.'), { status: 401, signedOut: true });
      const project = res.data.project;
      const x = project && (item.isMr ? project.mergeRequest : project.issue);
      if (!x) throw Object.assign(new Error(`${key} doesn’t exist, or you don’t have access to it.`), { status: 404 });
      return shape(item, project, x, me);
    },

    async transition(key, id) {
      const item = parse(key);
      const rest = restPath(item);
      if (id === 'close' || id === 'reopen') return change(item, rest, { method: 'PUT', body: { state_event: id } });
      if (!item.isMr) throw Object.assign(new Error('That change isn’t available here.'), { status: 400 });
      if (id === 'approve' || id === 'unapprove') return change(item, `${rest}/${id}`, { method: 'POST' });
      if (id === 'ready' || id === 'draft') {
        const res = await change(item, '/api/graphql', {
          method: 'POST',
          body: {
            query: 'mutation($path: ID!, $iid: String!, $draft: Boolean!) { mergeRequestSetDraft(input: { projectPath: $path, iid: $iid, draft: $draft }) { errors } }',
            variables: { path: item.path, iid: item.iid, draft: id === 'draft' },
          },
        });
        const errors = [...(res?.errors || []).map((e) => e.message), ...(res?.data?.mergeRequestSetDraft?.errors || [])];
        if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400 });
        return;
      }
      throw Object.assign(new Error('That change isn’t available here.'), { status: 400 });
    },

    async comment(key, text) {
      const item = parse(key);
      await change(item, `${restPath(item)}/notes`, { method: 'POST', body: { body: text } });
    },

    // An image from the GitLab site, for a site-media:// address.
    media(pathAndQuery) {
      return session.fetch(site + pathAndQuery, { credentials: 'include' });
    },
  };
}

module.exports = { createGitlabApi };
