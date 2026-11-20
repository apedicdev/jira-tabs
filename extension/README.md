# Jira Tab Reuse

A Chrome extension that gives every Jira issue its own tab, and only one:

- **Clicking a link to another issue** inside Jira opens it in a new tab next to the one you're on. The page you were on stays as it was. Links to the issue you're on, such as comment links, and links to boards and other pages work as usual.
- **Opening an issue that's already open** switches to its tab instead. This works however you open it: a link inside Jira, Cmd-click, a link from Slack or email, a new window, or typing the address.
  - A new tab or window opened for it is closed.
  - If the tab you were on had already moved to the issue, it goes back to the page you came from.

It uses your normal Jira login, so it needs no API token. It works on every `*.atlassian.net` site.

## Install

1. Open `chrome://extensions` in Chrome (or `edge://extensions` in Edge).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `extension` folder (the one containing `manifest.json`).
4. Optional: pin it from the puzzle-piece menu so you can see its button.

Keep the folder where it is: Chrome loads the extension from it each time it starts.

**After changing the files**, click the reload arrow on the extension's card in `chrome://extensions`, then refresh any Jira tabs that are already open.

## Jira as an app (optional)

Jira doesn't tell Chrome how to install it as an app, so *Install page as app* only covers the folder of the page you installed from, and issue links then open in Chrome. The extension fills that gap: on Jira pages it describes Jira as an app named **Jira** that covers the whole site and opens with tabs.

1. If you already installed Jira as an app, uninstall it first (in the app window: ⋮ → *Uninstall Jira*).
2. With the extension loaded, open your Jira site in Chrome and click the install icon at the right of the address bar (or ⋮ → *Cast, save and share* → *Install Jira*).

Two features are still experimental in Chrome, and each person turns them on in `chrome://flags`. An extension can't do that for them.

| Setting | What it does | Without it |
|---|---|---|
| **Desktop PWA tab strip** (`#enable-desktop-pwas-tab-strip`) | Tabs inside the app window | Each issue opens in its own app window. Reuse still works and switches to that window. |
| **Desktop PWA Link Capturing** (`#enable-user-navigation-capturing-pwa`), set to *Enabled V2, On by default* | Jira links from Chrome, Slack or email open in the app | Those links open in Chrome tabs. Reuse still switches to the app if the issue is already open there. |

## Use

- Open Jira issues as usual. Each issue gets its own tab, and opening one that's already open takes you to its tab.
- Want a second copy of an issue, or a link to open in the same tab? Click the extension's button to turn it off (the button shows **off**). Click again to turn it back on.

What counts as "the same issue": the issue page itself, `https://<site>.atlassian.net/browse/KEY-123`. Comment links (`?focusedCommentId=`) and lower-case keys match too. A board, backlog or list that shows an issue in its side panel doesn't count as that issue's tab. When it switches to the open tab, it doesn't reload it, so anything you were typing there is kept. A comment link therefore doesn't scroll to the comment.

## Permissions

- **Read and change your data on atlassian.net sites:** needed to see which tabs show which Jira issue, to catch clicks on issue links, and to add the app description. The extension doesn't read page contents or send anything anywhere.
- **Storage:** remembers whether it's turned on.

## Files

| File | What it does |
|---|---|
| `manifest.json` | Extension settings and permissions |
| `background.js` | Watches tabs and switches to the one already showing the issue |
| `content.js` | On Jira pages, opens issue links in their own tab and adds the app description |
| `app-icons.js` | Icons for the Jira app |
| `icons/` | Toolbar and extension-page icons |
