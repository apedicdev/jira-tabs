# Jira Tabs

Ways to work in Jira (and Confluence, and GitLab) with one tab per issue:

| Folder | What it is | Needs |
|---|---|---|
| [`desktop/`](desktop/README.md) | **Desktop apps** (Electron), the recommended option: **Jira Tabs** (Jira and Confluence) and **GitLab Tabs**. Real pages, your normal login, their own tabs, pinned tabs. | Nothing; install the apps |
| [`extension/`](extension/README.md) | **Chrome extension** for Jira in Chrome. Tabs inside an installed Jira app need experimental Chrome settings. | Chrome |
| this folder | **Web app** with its own issue view, using the Jira API through a small local server | A Jira API token |

## Why use the desktop apps

A Jira tab is one of the heaviest things a browser holds, and working in Jira in a browser tends to load it many times over. The desktop apps load each issue, page or merge request once, and keep only the tabs you're using loaded.

### One tab per item

In a browser, clicking around Jira, Confluence or GitLab either replaces the page you were reading or opens yet another tab, and links from Slack or email add more. You end up with several copies of the same issue, each out of date with the others, mixed in with everything else.

- **It recognises the item, not just the address.** All the links to one item lead to its one tab: a Jira issue and links to its comments; a Confluence page, its editor and old-style page links; a merge request's Overview and Changes; a GitLab issue and its work-item link.
- **Already open means switch.** Wherever the link comes from, an item that's open brings its tab forward instead of opening a duplicate. That covers links in pages, the address box, typed keys such as `ABC-123` or `group/project!12`, links from other apps, and links passed between Jira Tabs and GitLab Tabs.
- **An item never replaces the page you're on.** A link to another issue opens next to the current tab, so you keep your place. Boards, filters and pipelines open in the same tab as usual.
- **Pinned tabs act as home.** Jira's *For you* always stays on its own page.

Every duplicate avoided is a whole copy of Jira that isn't loaded, which is also the biggest saving below.

### Performance

Measured on a Mac with about ten Jira tabs:

| | Memory |
|---|---|
| One open Jira issue page | 330–440 MB, in its own process |
| About ten tabs, all loaded | 3.6 GB in 16 processes |
| The same tabs after reopening, with sleeping tabs | 645 MB in 4 processes |

How the apps keep it down:

1. **No duplicate tabs**, as above.
2. **Sleeping tabs:** after 5 minutes unused, a tab's page is closed but the tab stays in the strip; opening it reloads it in a second or two.
3. **Closing unused tabs** after 10 minutes; ⇧⌘T brings them back.
4. **Light start-up:** on launch only the tab you were on, and pinned tabs, load, not every saved tab.
5. **Loading before you click:** pointing at an issue link starts loading it out of sight, and the click then shows that page without fetching it again. At most two load ahead at a time, each dropped after a minute.

Limits:

- A tab that's in use is as heavy as the same page in Chrome. The apps can't make Jira's own front end lighter, only avoid running more copies than you need.
- A sleeping tab reloads when opened and starts back at the top. A page with unsaved changes is never put to sleep.
- Issues you only pointed at may show up in Jira's *Recently viewed*.
- Each app includes its own copy of Chromium, about 250 MB before any page.

Sleeping, closing and loading ahead can each be changed or turned off in the app menu (see [desktop/README.md](desktop/README.md)).

---

# The web app

The rest of this file is about the web app: an installable web app (PWA) for Jira with its own tabs. Every issue opens in one tab. Opening an issue that already has a tab, from the list, a link inside another issue, the search box or a link from outside the app, switches to that tab (it flashes) instead of opening a duplicate.

## Run it

Node 18 or newer. Nothing to install.

```bash
cp .env.example .env    # then fill in your Jira site, email and API token
node server.mjs
```

Open <http://localhost:4300>. Without a `.env` the app runs on sample data, so you can try it first.

**Install it as an app:** in Chrome or Edge, click the install icon at the right of the address bar (or ⋮ → *Cast, save and share* → *Install page as app*). It then runs in its own window, without the browser's tabs and address bar.

To start the server automatically, run `node server.mjs` from a login item, launchd or pm2. The installed app needs it running.

## Credentials

| Setting | Value |
|---|---|
| `JIRA_BASE_URL` | Your site, e.g. `https://your-site.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | A classic API token from <https://id.atlassian.com/manage-profile/security/api-tokens> (*Create API token*, not *with scopes*) |
| `JIRA_PAT` | Jira Data Center / Server only: a personal access token, used instead of email and token |
| `PORT` | Optional, default `4300` |

The app acts as you, with your Jira permissions.

## Why there is a small server

Jira Cloud refuses to be shown inside another page (iframe), and doesn't let a web page on another site call its API. So `server.mjs` runs on your machine, keeps the token, and calls Jira for the app. It:

- listens on `127.0.0.1` only and rejects requests addressed to any other host name;
- only accepts writes (status changes and comments) with a custom header, which other websites cannot send;
- serves Jira images and attachments in a sandbox, so their content can never run as part of the app.

The browser keeps a copy of issues you open, so open tabs still load when you are offline.

## Using it

- **Sidebar:** saved filters (Assigned to me, Reported by me, Watching, Recently viewed) and a search box that takes plain text, JQL, an issue key or a Jira issue link. A blue bar marks issues that already have a tab.
- **Tabs:** drag to reorder, middle-click or × to close. Tabs and the active one are restored when you reopen the app. An issue is refreshed in the background when you return to it after 2 minutes.
- **Issue view:** description, subtasks, linked issues, attachments and comments. Change the status from the status menu and add comments. Links to other issues open in tabs (reused when already open).
- **Open in Jira** opens the issue in your browser; clicking it again for the same issue goes back to that browser tab while it is still open.
- **Links from outside:** `http://localhost:4300/?open=PROJ-123` (or `?open=` followed by any Jira issue URL) opens that issue. In the installed app, Chrome sends such links to the already-open window, which then reuses the issue's tab.

| Shortcut | Action |
|---|---|
| `/` or Ctrl/⌘ K | Search, or type a key and press Enter to open it |
| Ctrl/⌘-click, middle-click | Open in a background tab |
| Alt/⌥ 1…9 | Go to tab (9 = last) |
| Alt/⌥ [ and ] | Previous / next tab |
| Alt/⌥ W | Close tab |
| Alt/⌥ Shift T | Reopen the last closed tab |
| Alt/⌥ R | Refresh the issue |
| Alt/⌥ B | Show or hide the issue list |
| Ctrl/⌘ Enter | Send the comment |

Alt shortcuts are ignored while you are typing, so characters such as `#` (⌥3 on a UK Mac keyboard) still type normally.

## Files

| File | What it does |
|---|---|
| `server.mjs` | Static server and Jira proxy |
| `demo.mjs` | Sample issues used when no credentials are set |
| `public/index.html`, `app.js`, `app.css` | The app |
| `public/manifest.webmanifest`, `sw.js`, `icons/` | What makes it installable and work offline |

## Licence

MIT; see [LICENSE](LICENSE).
