# Jira Tabs 2 and GitLab Tabs 2 (desktop apps)

Two apps built from the same code:

- **Jira Tabs 2**: Jira and Confluence Cloud (`your-company.atlassian.net`). The first time it opens, it asks for your site.
- **GitLab Tabs 2**: GitLab (`gitlab.com` unless you choose another site).

Each app shows the real site and uses your normal login, so it needs no API token and no Chrome settings.

## Version 2: light tabs

Jira Tabs 2 and GitLab Tabs 2 are separate apps from Jira Tabs and GitLab Tabs (version 1), with their own icons (purple and magenta, with a "2"), sign-in, tabs and settings, so both versions can be installed side by side. Sign in once in each the first time you open it. Links between the two apps go from version 2 to version 2: a GitLab link clicked in Jira Tabs 2 opens in GitLab Tabs 2, and the other way round.

A Jira or GitLab page loads the whole web app, which takes 300–450 MB for every open issue. In version 2, Jira issues, and GitLab issues and merge requests, open as **light tabs** instead: the app draws the item itself from the site's data, fetched with your sign-in. All light tabs share one small page, so ten open items take about as much memory as one page, and switching between them is instant.

- **What a light tab shows:**
  - A Jira issue: summary, status (which you can change), description, subtasks, linked issues, attachments and comments.
  - A GitLab issue: title, open or closed (which you can change), status, assignees, labels, milestone, due date, description, parent epic, child items, linked items, related merge requests and comments.
  - A GitLab merge request: title, branches, draft/open/merged/closed, reviewers, approvals, pipeline, whether it can be merged, changes, description and comments. You can approve it (or revoke your approval), mark it ready or draft, and close or reopen it.
  - You can add a comment (⌘Enter to send): plain text in Jira, Markdown in GitLab.
  - **Images** in the description and comments, and image attachments, open in a preview over the issue: click one to see it as large as fits, click it again for its actual size, ← → for the issue's other images, Esc to close. **Open original** opens the file itself. ⌘-click still opens it in a new tab.
- **For everything else**, such as editing fields, the rich-text editor, a merge request's changes or merging, choose **Open full Jira** / **Open full GitLab** (or ⇧⌘J). That tab becomes the real page; ⇧⌘J turns it back into a light tab and frees the page.
- **Links in a light tab** follow the usual rules: issues and merge requests open in light tabs (or switch to theirs), other pages of the site open in new full tabs, other websites in your browser.
- **Other pages** (For you, boards, filters, Confluence; GitLab's lists, pipelines, epics, and a merge request's Changes, Commits and Pipelines tabs) are still full pages. Issue and merge request links clicked in them open light tabs.
- **The light tab you're on has its full page ready.** A second after it opens, the app loads its full page out of sight and keeps it while you stay on the tab, so **Open full …** shows it at once. When you switch away, that page is dropped after a minute. (Turning a full page back into a light tab with ⇧⌘J doesn't load it again straight away, since that's usually to free the memory.)
- Pointing at a link to an issue or merge request fetches its data and loads its full page out of sight, so its light tab is ready when you click. Pointing at **Open full …** loads it too.
- Both are turned off with **Load Issues When Pointing at Links** (see below).
- If you're signed out, the light tab says so; **Open full …** shows the site's sign-in page.
- To go back to full pages, untick **Jira Tabs 2 → Open Issues in Light View** (**GitLab Tabs 2 → Open Issues and Merge Requests in Light View**), or `lightIssues` in `config.json`.

## How the tabs work

- **Every item gets one tab.** Items are:
  - in Jira Tabs 2, Jira issues and Confluence pages, blog posts, whiteboards and databases;
  - in GitLab Tabs 2, issues (and work items), merge requests and epics.
- **A link to another item opens it in a new tab** next to the one you're on, and the page you were on stays as it was. If that item is already open, you're switched to its tab instead (the tab flashes).
- **Different views of one item stay in its tab:** a Confluence page and its editor, a merge request's Overview and Changes, a Jira issue and links to its comments.
- **Other pages** open in the current tab as usual. That includes boards, filters, Confluence space overviews, pipelines and files.
- **Links to other websites** open in your web browser. A Jira link clicked in GitLab Tabs 2 opens in Jira Tabs 2, and a GitLab link clicked in Jira Tabs 2 opens in GitLab Tabs 2, when that app is installed.
- **Pinned tabs** are small tabs at the front that always stay on their page. Opening that page from anywhere, including the Home shortcut, switches to the pinned tab, and links clicked in it open in new tabs. Jira Tabs 2 starts with **For you** pinned.
  - Pin or unpin a tab with the pin button in the toolbar, ⇧⌘P, or by right-clicking the tab.
  - Pinned tabs can't be closed until you unpin them.
- **Unused tabs go to sleep, then close.** Both count from when you last switched away from a tab.
  - **After 5 minutes the tab sleeps.** It stays in the strip, dimmed, with its title, but its page is closed, which frees its memory (a Jira issue takes 300–450 MB). Opening it reloads the page, which takes a second or two, and you're back at the top of the page. Tabs reopened from last time start asleep, except the one you were on.
  - Light tabs have no page of their own, so they don't sleep; they close like other tabs.
  - **After 10 minutes it closes.** ⇧⌘T brings closed tabs back, one at a time.
  - Change either time, or turn it off, under **Jira Tabs 2 → Put Unused Tabs to Sleep After** and **Close Unused Tabs After** (**GitLab Tabs 2 → …**; on Windows, in the File menu).
  - Never put to sleep or closed: the tab you're on, pinned tabs, a tab playing sound, and a page that warns about unsaved changes.
  - The time keeps counting while the app is in the background or the Mac is asleep.
- **Items load before you click.** When you point at a link to a Jira issue, or a GitLab issue, merge request or epic, that would open in a new tab, the app starts loading it out of sight. The tab then shows straight away when you click.
  - At most two items load ahead at a time (plus the full page of the light tab you're on), and each is dropped a minute after you last pointed at its link.
  - Items loaded this way may show up in *Recently viewed* (Jira) or recent items (GitLab) even if you don't click. To turn it off, untick **Jira Tabs 2 → Load Issues When Pointing at Links** (or **GitLab Tabs 2 → Load Issues and Merge Requests When Pointing at Links**).
  - Confluence pages aren't loaded ahead: Confluence records who viewed a page, and page owners can see that.
- Tabs, pins and the window come back when you reopen the app.

## The address box (⌘L)

| App | Type | Opens |
|---|---|---|
| Jira Tabs 2 | `ABC-123` | That issue |
| GitLab Tabs 2 | `group/project!12`, `group/project#34`, `group&5` | That merge request, issue or epic |
| GitLab Tabs 2 | `!12` or `#34` | That merge request or issue in the project you're looking at |
| Both | A web address | That page (in the app if it belongs there, otherwise in your browser) |
| Both | Anything else | A search |

An item that's already open switches to its tab. In a new tab (⌘T), the empty tab is closed when that happens.

## Install

Open the `.dmg` and drag the app into Applications. If your account can't add apps there (no admin rights), use the Applications folder in your home folder instead (`~/Applications`); Spotlight and Launchpad find apps there too. The first time you open it, sign in as usual; it stays signed in.

| App | Installer |
|---|---|
| Jira Tabs 2 | `dist/jira/Jira Tabs 2-<version>-arm64.dmg` |
| GitLab Tabs 2 | `dist/gitlab/GitLab Tabs 2-<version>-arm64.dmg` |

The apps aren't signed with an Apple Developer ID yet. On a Mac where they were downloaded rather than built, macOS will refuse to open them the first time. Right-click the app and choose **Open**, or go to System Settings → Privacy & Security → **Open Anyway**. See [Sharing them](#sharing-them) to remove that step.

### Signing in with 1Password

Browser extensions don't run in the apps, so the 1Password extension can't fill sign-ins here. The apps ask the 1Password app directly instead:

1. Install 1Password's command-line tool: `brew install 1password-cli` (or see [1Password's guide](https://developer.1password.com/docs/cli/get-started/)).
2. In 1Password, open **Settings → Developer** and turn on **Integrate with 1Password CLI**.
3. On a sign-in page, press **⇧⌘F**, choose **Edit → Fill Sign-in From 1Password**, or right-click the field and choose **Fill From 1Password**.

1Password asks you to approve (Touch ID) and the app fills in the username, password or one-time code that page asks for. With several sign-ins saved for the site, you pick one. Nothing is filled unless you ask, only into fields you can see, and only with a sign-in saved for that website. The app doesn't keep anything.

**Passkeys don't work in the apps.** Passkeys from iCloud Keychain or 1Password are only available to web browsers that Apple approves. Choose to sign in with your password instead (Atlassian: *Log in with password* or *Continue* without the passkey), and let 1Password fill the password and one-time code.

To use another site, choose **Jira Tabs 2 → Change Jira Site…** (or **GitLab Tabs 2 → Change GitLab Site…**).

### Settings built into the apps

`config.json` holds each app's defaults: its site, the pages it starts with pinned (a path such as `/jira/for-you` means that page of your site), whether issues open as light tabs (`lightIssues`), when unused tabs sleep and close (`sleepUnusedTabsAfterMinutes`, `closeUnusedTabsAfterMinutes`, 0 for never) and whether items load ahead when you point at their links (`preloadLinks`).

To build the apps for your team with your own site already set, put your settings in `config.local.json` next to it, in the same shape; only the values you include are changed. That file isn't uploaded to the repository, but it is built into the apps. For example:

```json
{ "jira": { "site": "https://your-company.atlassian.net" } }
```

## Shortcuts

| Shortcut | Action |
|---|---|
| ⌘T | New tab |
| ⌘W | Close tab (not pinned tabs) |
| ⇧⌘T | Reopen the last closed tab |
| ⌘L | Address box |
| ⇧⌘P | Pin or unpin the tab |
| ⇧⌘H | Home (the first pinned tab) |
| ⌘1…⌘8, ⌘9 | Go to tab 1…8, last tab |
| ⌃Tab, ⌃⇧Tab (or ⌥⌘→, ⌥⌘←) | Next / previous tab |
| ⌘[ and ⌘] | Back / forward |
| ⌘R | Reload |
| ⌘F, ⌘G, ⇧⌘G | Find in page, next, previous |
| ⇧⌘C | Copy the page's link |
| ⇧⌘O | Open the page in your web browser |
| ⇧⌘F | Fill the sign-in from 1Password |
| ⇧⌘J | Switch an issue or merge request between the light view and the full page |
| ⌘+, ⌘−, ⌘0 | Zoom in, out, reset |

Ctrl/Cmd-click or middle-click a link to open it in a background tab. Right-click a link for *Open Link in New Tab*, *Open Link in Browser* and *Copy Link Address*. Right-click a tab to pin it, copy its link, or close it, the other tabs, or the tabs to its right. Drag tabs to reorder them. Middle-click a tab to close it.

## Links from other apps

| App | Links it opens |
|---|---|
| Jira Tabs 2 | `jira-tabs-2://ABC-123` and `jira-tabs-2://open?url=<a Jira or Confluence address>` |
| GitLab Tabs 2 | `gitlab-tabs-2://group/project!12` and `gitlab-tabs-2://open?url=<a GitLab address>` |

These follow the same rules as links inside the app. Only addresses of the app's own site are accepted, so other apps can't use it to open other websites.

Ordinary `https://` links in Slack or email go to your default web browser, because that's how macOS works. To send them to the apps instead, you can use a link-routing app such as [Finicky](https://github.com/johnste/finicky) with rules for `*.atlassian.net` and `gitlab.com`. This hasn't been tried yet.

## Build them

Needs Node 18 or newer.

```bash
npm install
npm start               # run Jira Tabs 2 from source
npm run start:gitlab    # run GitLab Tabs 2 from source
npm run dist            # build both, for Apple Silicon and Intel Macs, into dist/jira and dist/gitlab
```

`npm run dist:jira` or `npm run dist:gitlab` builds just one.

## Sharing them

Without signing, every colleague has to approve each app the first time (see [Install](#install)). To remove that step:

1. Get a **Developer ID Application** certificate from an Apple Developer account (your company may already have one) and install it in the Keychain of the Mac that builds the apps.
2. In `package.json`, under `build.mac`, remove `"identity": "-"` and set `"hardenedRuntime": true`. `build/gitlab.config.js` takes these settings from there.
3. Set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` in the environment, then run `npm run dist`. electron-builder signs the apps and has Apple notarize them.

Two more things to keep in mind:

- **Updates:** there are no automatic updates yet; electron-builder can add them later. Electron contains Chromium, so the apps should be rebuilt with a current Electron version every few months for security fixes.
- **Windows:** `npx electron-builder --win` builds a Windows installer. It hasn't been tested.

## How it's kept safe

- Pages run sandboxed and separate from the app's own code. The small script added to each page, `preload-page.js`, gives the page nothing; it only tells the app which link was clicked or pointed at.
- Pages may write to the clipboard, show notifications and go full screen; everything else is refused.
- The light view never talks to Jira or GitLab and holds no sign-in: the app fetches the data and hands it over. It runs sandboxed, with no permissions, and runs no scripts but its own. The site's text is cleaned before it's shown, and only images are passed through from the site.
- GitLab is read through its GraphQL API with your sign-in cookie. Changes (closing, approving, comments) go through its REST API with the CSRF token from the item's own page, which GitLab requires for changes made with a sign-in cookie.
- Filling from 1Password runs out of the page's reach, and only after you ask and 1Password approves. It checks the page is the website the sign-in was saved for, and again just before filling, in case the page changed meanwhile.
- Sign-in pop-ups, such as "Sign in with Google" inside a Jira app, open in a small window of the app, so they can hand the result back to the page.
- The apps identify themselves as Chrome, because some sign-in pages refuse apps that announce themselves as Electron.

## Limits

- Jira Cloud and Confluence Cloud (`*.atlassian.net`) only; GitLab.com or one self-hosted GitLab site.
- One window per app.

## Files

| File | What it does |
|---|---|
| `src/main.js` | Window, tabs, pinned tabs, sleeping and closing unused tabs, loading items ahead, link rules, menus and shortcuts |
| `src/rules.js` | What differs between the two apps: which pages are items, which are loaded ahead, which sites open in the app, what the address box does |
| `src/preload-page.js` | Tells the app about link clicks, and links you point at, in pages |
| `src/password-manager.js` | Fills sign-in forms from 1Password |
| `src/jira-api.js` | Fetches issues from Jira's API with your Jira sign-in, for light tabs |
| `src/gitlab-api.js` | Fetches issues and merge requests from GitLab's API with your GitLab sign-in, and makes the changes, for light tabs |
| `src/light/`, `src/preload-light.js` | The light view (both apps) |
| `src/preload-ui.js`, `src/ui/` | Tab strip and toolbar |
| `config.json` | Each app's site, the pages it starts with pinned, and when unused tabs close |
| `build/gitlab.config.js` | Build settings for GitLab Tabs 2 (Jira Tabs 2 uses `package.json`) |
| `build/jira-2/`, `build/gitlab-2/` | App icons (`build/jira/` and `build/gitlab/` hold version 1’s) |
