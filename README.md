# Jira Tabs

Ways to work in Jira (and Confluence, and GitLab) with one tab per issue:

| Folder | What it is | Needs |
|---|---|---|
| [`desktop/`](desktop/README.md) | **Desktop apps** (Electron), the recommended option: **Jira Tabs** (Jira and Confluence) and **GitLab Tabs**. Real pages, your normal login, their own tabs, pinned tabs. | Nothing; install the apps |
| [`extension/`](extension/README.md) | **Chrome extension** for Jira in Chrome. Tabs inside an installed Jira app need experimental Chrome settings. | Chrome |
| this folder | **Web app** with its own issue view, using the Jira API through a small local server | A Jira API token |

Why the desktop apps: they open each issue, page or merge request once, switching to its tab instead of loading another copy, and they free the memory of tabs you aren't using. With about ten Jira tabs, that took memory from 3.6 GB to 645 MB. See [Why use it](desktop/README.md#why-use-it).

The rest of this file is about the web app.

---

An installable web app (PWA) for Jira with its own tabs. Every issue opens in one tab. Opening an issue that already has a tab, from the list, a link inside another issue, the search box or a link from outside the app, switches to that tab (it flashes) instead of opening a duplicate.

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
