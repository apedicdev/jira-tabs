# Jira Tabs and GitLab Tabs (desktop apps)

Two apps built from the same code:

- **Jira Tabs**: Jira and Confluence Cloud (`your-company.atlassian.net`). The first time it opens, it asks for your site.
- **GitLab Tabs**: GitLab (`gitlab.com` unless you choose another site).

Each app shows the real site and uses your normal login, so it needs no API token and no Chrome settings.

## How the tabs work

- **Every item gets one tab.** Items are:
  - in Jira Tabs, Jira issues and Confluence pages, blog posts, whiteboards and databases;
  - in GitLab Tabs, issues (and work items), merge requests and epics.
- **A link to another item opens it in a new tab** next to the one you're on, and the page you were on stays as it was. If that item is already open, you're switched to its tab instead (the tab flashes).
- **Different views of one item stay in its tab:** a Confluence page and its editor, a merge request's Overview and Changes, a Jira issue and links to its comments.
- **Other pages** open in the current tab as usual. That includes boards, filters, Confluence space overviews, pipelines and files.
- **Links to other websites** open in your web browser. A Jira link clicked in GitLab Tabs opens in Jira Tabs, and a GitLab link clicked in Jira Tabs opens in GitLab Tabs, when that app is installed.
- **Pinned tabs** are small tabs at the front that always stay on their page. Opening that page from anywhere, including the Home shortcut, switches to the pinned tab, and links clicked in it open in new tabs. Jira Tabs starts with **For you** pinned.
  - Pin or unpin a tab with the pin button in the toolbar, ⇧⌘P, or by right-clicking the tab.
  - Pinned tabs can't be closed until you unpin them.
- **Unused tabs go to sleep, then close.** Both count from when you last switched away from a tab.
  - **After 5 minutes the tab sleeps.** It stays in the strip, dimmed, with its title, but its page is closed, which frees its memory (a Jira issue takes 300–450 MB). Opening it reloads the page, which takes a second or two, and you're back at the top of the page. Tabs reopened from last time start asleep, except the one you were on.
  - **After 10 minutes it closes.** ⇧⌘T brings closed tabs back, one at a time.
  - Change either time, or turn it off, under **Jira Tabs → Put Unused Tabs to Sleep After** and **Close Unused Tabs After** (**GitLab Tabs → …**; on Windows, in the File menu).
  - Never put to sleep or closed: the tab you're on, pinned tabs, a tab playing sound, and a page that warns about unsaved changes.
  - The time keeps counting while the app is in the background or the Mac is asleep.
- **Items load before you click.** When you point at a link to a Jira issue, or a GitLab issue, merge request or epic, that would open in a new tab, the app starts loading it out of sight. The tab then shows straight away when you click.
  - At most two items load ahead at a time, and each is dropped a minute after you last pointed at its link.
  - Items loaded this way may show up in *Recently viewed* (Jira) or recent items (GitLab) even if you don't click. To turn it off, untick **Jira Tabs → Load Issues When Pointing at Links** (or **GitLab Tabs → Load Issues and Merge Requests When Pointing at Links**).
  - Confluence pages aren't loaded ahead: Confluence records who viewed a page, and page owners can see that.
- Tabs, pins and the window come back when you reopen the app.

## The address box (⌘L)

| App | Type | Opens |
|---|---|---|
| Jira Tabs | `ABC-123` | That issue |
| GitLab Tabs | `group/project!12`, `group/project#34`, `group&5` | That merge request, issue or epic |
| GitLab Tabs | `!12` or `#34` | That merge request or issue in the project you're looking at |
| Both | A web address | That page (in the app if it belongs there, otherwise in your browser) |
| Both | Anything else | A search |

An item that's already open switches to its tab. In a new tab (⌘T), the empty tab is closed when that happens.

## Install

Open the `.dmg` and drag the app into Applications. If your account can't add apps there (no admin rights), use the Applications folder in your home folder instead (`~/Applications`); Spotlight and Launchpad find apps there too. The first time you open it, sign in as usual; it stays signed in.

| App | Installer |
|---|---|
| Jira Tabs | `dist/jira/Jira Tabs-<version>-arm64.dmg` |
| GitLab Tabs | `dist/gitlab/GitLab Tabs-<version>-arm64.dmg` |

The apps aren't signed with an Apple Developer ID yet. On a Mac where they were downloaded rather than built, macOS will refuse to open them the first time. Right-click the app and choose **Open**, or go to System Settings → Privacy & Security → **Open Anyway**. See [Sharing them](#sharing-them) to remove that step.

### Signing in with 1Password

Browser extensions don't run in the apps, so the 1Password extension can't fill sign-ins here. The apps ask the 1Password app directly instead:

1. Install 1Password's command-line tool: `brew install 1password-cli` (or see [1Password's guide](https://developer.1password.com/docs/cli/get-started/)).
2. In 1Password, open **Settings → Developer** and turn on **Integrate with 1Password CLI**.
3. On a sign-in page, press **⇧⌘F**, choose **Edit → Fill Sign-in From 1Password**, or right-click the field and choose **Fill From 1Password**.

1Password asks you to approve (Touch ID) and the app fills in the username, password or one-time code that page asks for. With several sign-ins saved for the site, you pick one. Nothing is filled unless you ask, only into fields you can see, and only with a sign-in saved for that website. The app doesn't keep anything.

**Passkeys don't work in the apps.** Passkeys from iCloud Keychain or 1Password are only available to web browsers that Apple approves. Choose to sign in with your password instead (Atlassian: *Log in with password* or *Continue* without the passkey), and let 1Password fill the password and one-time code.

To use another site, choose **Jira Tabs → Change Jira Site…** (or **GitLab Tabs → Change GitLab Site…**).

### Settings built into the apps

`config.json` holds each app's defaults: its site, the pages it starts with pinned (a path such as `/jira/for-you` means that page of your site), when unused tabs sleep and close (`sleepUnusedTabsAfterMinutes`, `closeUnusedTabsAfterMinutes`, 0 for never) and whether items load ahead when you point at their links (`preloadLinks`).

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
| ⌘+, ⌘−, ⌘0 | Zoom in, out, reset |

Ctrl/Cmd-click or middle-click a link to open it in a background tab. Right-click a link for *Open Link in New Tab*, *Open Link in Browser* and *Copy Link Address*. Right-click a tab to pin it, copy its link, or close it, the other tabs, or the tabs to its right. Drag tabs to reorder them. Middle-click a tab to close it.

## Links from other apps

| App | Links it opens |
|---|---|
| Jira Tabs | `jira-tabs://ABC-123` and `jira-tabs://open?url=<a Jira or Confluence address>` |
| GitLab Tabs | `gitlab-tabs://group/project!12` and `gitlab-tabs://open?url=<a GitLab address>` |

These follow the same rules as links inside the app. Only addresses of the app's own site are accepted, so other apps can't use it to open other websites.

Ordinary `https://` links in Slack or email go to your default web browser, because that's how macOS works. To send them to the apps instead, you can use a link-routing app such as [Finicky](https://github.com/johnste/finicky) with rules for `*.atlassian.net` and `gitlab.com`. This hasn't been tried yet.

## Build them

Needs Node 18 or newer.

```bash
npm install
npm start               # run Jira Tabs from source
npm run start:gitlab    # run GitLab Tabs from source
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
| `src/preload-ui.js`, `src/ui/` | Tab strip and toolbar |
| `config.json` | Each app's site, the pages it starts with pinned, and when unused tabs close |
| `build/gitlab.config.js` | Build settings for GitLab Tabs (Jira Tabs uses `package.json`) |
| `build/jira/`, `build/gitlab/` | App icons |
