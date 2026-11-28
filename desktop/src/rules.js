// What differs between the Jira and the GitLab version of the app: which pages are "items" that
// get one tab each, which sites open inside the app, and what the address box and links from
// other apps mean. No Electron here, so it can be tested on its own.

const parse = (url) => {
  if (url instanceof URL) return url;
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

// https://host for whatever the person typed as their site.
function normalizeSite(input) {
  const text = String(input || '').trim().replace(/\/+$/, '');
  if (!text) return null;
  const u = parse(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (!u || u.protocol !== 'https:' || !u.hostname.includes('.')) return null;
  return u.origin;
}

const looksLikeAddress = (t) => /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t);

// ---------- Jira ----------

const JIRA_ISSUE = /^\/browse\/([a-z][a-z0-9_]*-\d+)\/?$/i;
const JIRA_KEY = /^\s*([a-z][a-z0-9_]*-\d+)\s*$/i;
// Confluence (same site, under /wiki): a page and its editor, a blog post, a whiteboard or a
// database, identified by its content id.
const CONFLUENCE_CONTENT =
  /^\/wiki\/spaces\/[^/]+\/(?:pages(?:\/edit-v2)?|blog(?:\/\d{4}\/\d{2}\/\d{2})?|whiteboard|database)\/(\d+)(?:\/|$)/;
const CONFLUENCE_OLD = /^\/wiki\/pages\/(?:viewpage|editpage)\.action$/;
// The site's own sign-in steps: Jira sends you to /login.jsp and /login when you're signed out,
// and back through /SetCST afterwards.
const JIRA_SIGN_IN = /^\/(?:login(?:\.jsp)?|logout|SetCST(?:\/initiate)?|wiki\/(?:login|logout)\.action)\/?$/i;

const jira = {
  id: 'jira',
  name: 'Jira',
  productName: 'Jira Tabs 2', // version 2: a separate app from Jira Tabs, so both can be installed
  protocol: 'jira-tabs-2',
  addressPlaceholder: 'Issue key, Jira or Confluence address, or search',
  siteLabel: 'Your Jira address',
  sitePlaceholder: 'your-company.atlassian.net',
  isSiteHost: (host, siteHost) => /\.atlassian\.net$/i.test(host) || host === siteHost,
  // Atlassian's own pages (sign-in, profile) also stay in the app.
  isOtherInAppHost: (host) => /(^|\.)(atlassian\.com|jira\.com)$/i.test(host),
  item(u) {
    const host = u.hostname.toLowerCase();
    const m = JIRA_ISSUE.exec(u.pathname);
    if (m) return { key: `${host}/${m[1].toUpperCase()}`, label: m[1].toUpperCase() };
    const id = CONFLUENCE_CONTENT.exec(u.pathname)?.[1] ||
      (CONFLUENCE_OLD.test(u.pathname) && /^\d+$/.test(u.searchParams.get('pageId') || '') && u.searchParams.get('pageId'));
    return id ? { key: `${host}/wiki/${id}`, label: 'Confluence' } : null;
  },
  // Items loaded ahead when you point at a link to them: Jira issues only. Confluence records
  // page views, which page owners can see, so its pages are only loaded when you open them.
  preload: (u) => JIRA_ISSUE.test(u.pathname),
  preloadLabel: 'Load Issues When Pointing at Links',
  signIn: (u) => JIRA_SIGN_IN.test(u.pathname),
  // Items the app can show in its own light view, drawn from Jira's data: Jira issues.
  light: (u) => JIRA_ISSUE.exec(u.pathname)?.[1].toUpperCase() ?? null,
  lightKey: /^[A-Z][A-Z0-9_]*-\d+$/,
  lightLabel: 'Open Issues in Light View',
  reference(text, site) {
    const m = JIRA_KEY.exec(text);
    return m ? `${site}/browse/${m[1].toUpperCase()}` : null;
  },
  search: (text, site) =>
    `${site}/issues/?jql=${encodeURIComponent(`text ~ "${text.replace(/["\\]/g, '\\$&')}" ORDER BY updated DESC`)}`,
};

// ---------- GitLab ----------

// /group/sub/project/-/issues/12, /-/merge_requests/34 (and /diffs etc.), /-/work_items/12,
// /groups/group/-/epics/5 or /groups/group/-/work_items/5.
const GITLAB_ITEM = /^\/(.+?)\/(?:-\/)?(issues|merge_requests|work_items|epics)\/(\d+)(?:\/.*)?$/;
const GITLAB_REF = /^([\w.-]+(?:\/[\w.-]+)+)([#!])(\d+)$/; // group/project#12, group/project!34
const GITLAB_EPIC_REF = /^([\w.-]+(?:\/[\w.-]+)*)&(\d+)$/; // group&5
const GITLAB_SHORT_REF = /^([#!])(\d+)$/; // #12 or !34 in the project you're looking at
// An issue, work item or merge request's own page (not its changes, commits or pipelines tab).
const GITLAB_LIGHT = /^\/(\w[\w.-]*(?:\/\w[\w.-]*)+)\/-\/(issues|merge_requests|work_items)\/(\d+)\/?$/;
const GITLAB_SIGN_IN = /^\/users\/(?:sign_in|sign_out|auth|password|unlock|confirmation|two_factor_auth\w*|identity_verification)(?:\/|$)/;

const projectOf = (url) => {
  const u = parse(url);
  const m = u && /^\/(.+?)\/-\//.exec(u.pathname);
  return m && !m[1].startsWith('groups/') ? m[1] : null;
};

const gitlab = {
  id: 'gitlab',
  name: 'GitLab',
  productName: 'GitLab Tabs 2', // version 2: a separate app from GitLab Tabs, so both can be installed
  protocol: 'gitlab-tabs-2',
  addressPlaceholder: 'group/project!12, #34, a GitLab address or search',
  siteLabel: 'Your GitLab address',
  sitePlaceholder: 'gitlab.com',
  isSiteHost: (host, siteHost) => host === siteHost,
  isOtherInAppHost: () => false,
  item(u) {
    const m = GITLAB_ITEM.exec(u.pathname);
    if (!m) return null;
    const [, path, type, iid] = m;
    const host = u.hostname.toLowerCase();
    if (path.startsWith('groups/')) {
      // Group-level work items are epics.
      if (type !== 'epics' && type !== 'work_items') return null;
      return { key: `${host}/${path.slice(7).toLowerCase()}&${iid}`, label: `&${iid}` };
    }
    if (type === 'epics') return null;
    // Work items in a project are issues under a new name; same number, same tab.
    const sign = type === 'merge_requests' ? '!' : '#';
    return { key: `${host}/${path.toLowerCase()}${sign}${iid}`, label: `${sign}${iid}` };
  },
  // Every item (issues, merge requests, epics) is loaded ahead when you point at a link to it.
  preload: (u) => !!gitlab.item(u),
  preloadLabel: 'Load Issues and Merge Requests When Pointing at Links',
  signIn: (u) => GITLAB_SIGN_IN.test(u.pathname),
  // Items the app can show in its light view: issues (and other project work items) as
  // "group/project#12", merge requests as "group/project!34".
  light(u) {
    const m = GITLAB_LIGHT.exec(u.pathname);
    if (!m || m[1].startsWith('groups/')) return null;
    return `${m[1]}${m[2] === 'merge_requests' ? '!' : '#'}${m[3]}`;
  },
  lightKey: /^\w[\w.-]*(?:\/\w[\w.-]*)+[#!]\d+$/,
  lightLabel: 'Open Issues and Merge Requests in Light View',
  reference(text, site, currentUrl) {
    let m = GITLAB_REF.exec(text);
    if (m) return `${site}/${m[1]}/-/${m[2] === '!' ? 'merge_requests' : 'issues'}/${m[3]}`;
    m = GITLAB_EPIC_REF.exec(text);
    if (m) return `${site}/groups/${m[1]}/-/epics/${m[2]}`;
    m = GITLAB_SHORT_REF.exec(text);
    const project = m && projectOf(currentUrl);
    if (project) return `${site}/${project}/-/${m[1] === '!' ? 'merge_requests' : 'issues'}/${m[2]}`;
    return null;
  },
  search: (text, site) => `${site}/search?search=${encodeURIComponent(text)}`,
};

const PROFILES = { jira, gitlab };

// The rules for one app (Jira or GitLab) and its site.
function createRules(profileId, siteInput) {
  const profile = PROFILES[profileId] || jira;
  const site = normalizeSite(siteInput);
  const siteHost = site ? new URL(site).hostname.toLowerCase() : '';
  const onSite = (u) => !!u && u.protocol === 'https:' && profile.isSiteHost(u.hostname.toLowerCase(), siteHost);

  const rules = {
    profile,
    site,
    home: site ? `${site}/` : null,
    // Pages of the site itself, where item links get their own tab.
    isSitePage: (url) => onSite(parse(url)),
    // Addresses that open inside the app rather than in the web browser.
    isInApp(url) {
      const u = parse(url);
      return onSite(u) || (!!u && u.protocol === 'https:' && profile.isOtherInAppHost(u.hostname));
    },
    // A key that is the same for every address of one issue / merge request, or null.
    itemOf(url) {
      const u = parse(url);
      return onSite(u) ? profile.item(u)?.key ?? null : null;
    },
    labelOf(url) {
      const u = parse(url);
      return onSite(u) ? profile.item(u)?.label ?? null : null;
    },
    // The site's sign-in pages, which a pinned tab goes through when you're signed out.
    isSignInPage(url) {
      const u = parse(url);
      return onSite(u) && !!profile.signIn?.(u);
    },
    // Whether this app has a light view, and the issue key of an address it can show there.
    canLight: !!profile.light,
    lightKeyOf(url) {
      const u = parse(url);
      return onSite(u) && profile.light ? profile.light(u) : null;
    },
    isLightKey: (key) => !!profile.lightKey?.test(String(key || '')),
    // Whether this app loads items ahead at all, and whether this address is one of them.
    canPreload: !!profile.preload,
    isPreloadable(url) {
      const u = parse(url);
      return onSite(u) && !!profile.preload?.(u);
    },
    // What typing into the address box means.
    resolveInput(text, currentUrl) {
      const t = String(text || '').trim();
      if (!t || !site) return null;
      const ref = profile.reference(t, site, currentUrl);
      if (ref) return ref;
      if (/^https?:\/\//i.test(t)) return parse(t)?.href ?? null;
      if (looksLikeAddress(t)) return parse(`https://${t}`)?.href ?? null;
      return profile.search(t, site);
    },
    // Links from other apps: <protocol>://open?url=<address>, <protocol>://<reference>, or an
    // https address. Only addresses that belong in the app are accepted, so other apps can't
    // use it to open random websites.
    fromOutside(link) {
      const u = parse(link);
      if (!u) return null;
      if (u.protocol === 'https:') return rules.isInApp(u) ? u.href : null;
      if (u.protocol !== `${profile.protocol}:` || !site) return null;
      const url = u.searchParams.get('url');
      if (url) return rules.isInApp(url) ? parse(url).href : null;
      // The "host" part of jira-tabs-2://ABC-1 is lower-cased by URL parsing; references don't care.
      const rest = decodeURIComponent(`${u.hostname}${u.pathname}${u.hash}`).replace(/^\/+|\/+$/g, '').replace(/^browse\//i, '');
      return profile.reference(rest, site, null);
    },
  };
  return rules;
}

module.exports = { PROFILES, createRules, normalizeSite };
