# Chrome Web Store submission — Reddit Cleaner

Everything needed to fill in the Chrome Web Store Developer Dashboard, tab by tab.
Upload package: `dist/reddit-cleaner-<version>.zip` (build with `./scripts/build.sh`).

---

## Store listing tab

**Name** (from manifest): Reddit Cleaner – Bulk Overwrite & Delete

**Summary** (manifest `description`, max 132 chars):

> Load your Reddit posts and comments, select them by date, then bulk overwrite and delete them.

**Category:** Productivity → Tools

**Language:** English

**Description:**

```
Clean up your Reddit history in a few clicks.

Reddit Cleaner loads every post and comment from your Reddit account into one sortable table, lets you pick exactly what should go, and then overwrites and deletes the selected items for you — one by one, respecting Reddit's rate limits.

WHY OVERWRITE FIRST?
Deleting a comment on Reddit removes your name, but copies of the original text can live on in third-party archives and caches. Reddit Cleaner first edits the content to a text of your choice (a single "." by default) and only then deletes it, so the last version Reddit stores is the overwritten one.

FEATURES
• Loads all your posts and comments (with subreddit, score, date and a content preview)
• Sort by type, date, subreddit, score, content or status
• Quick selection: older than 1 hour / 1 day / 1 week / 1 month
• Select the latest N items, or everything within a date range
• Select all, clear or invert the selection, or tick items individually
• Custom replacement text used before deletion
• Confirmation dialog before anything irreversible happens
• Live status per item and a detailed log
• Multiple accounts: log in to several Reddit accounts and switch between them without logging out

HOW IT WORKS
The extension opens as a full page in a new tab. It uses your existing Reddit login and talks only to reddit.com — the same requests Reddit's own website makes. You always log in directly on reddit.com; the extension never sees your password.

PRIVACY
• No servers, no analytics, no tracking, no ads
• Nothing is sent to the developer or any third party
• Saved account sessions are stored only locally in your browser

GOOD TO KNOW
• Deletion is permanent — try it on a few old comments first.
• Link and image posts cannot be edited through Reddit, so they are deleted without overwriting.
• Switching accounts changes your Reddit login for the whole browser profile.
• Reddit Cleaner is an independent project and is not affiliated with or endorsed by Reddit, Inc.

Source code: https://github.com/rakuscinec/reddit-cleaner-extension
```

**Graphics** (in `store/assets/`):

| Field | File | Size |
|---|---|---|
| Store icon | `icons/icon128.png` | 128×128 |
| Screenshot 1 | `screenshot-table.png` | 1280×800 |
| Screenshot 2 | `screenshot-confirm.png` | 1280×800 |
| Screenshot 3 | `screenshot-progress.png` | 1280×800 |
| Screenshot 4 | `screenshot-accounts.png` | 1280×800 |
| Small promo tile | `promo-small-440x280.png` | 440×280 |

Screenshots show the real UI with fictional demo data (account `u/demo_user`).

**Homepage URL:** https://github.com/rakuscinec/reddit-cleaner-extension
**Support URL:** https://github.com/rakuscinec/reddit-cleaner-extension/issues

---

## Privacy practices tab

**Single purpose description:**

```
Reddit Cleaner lets users bulk overwrite and delete their own Reddit posts and comments. It loads the signed-in user's posts and comments from reddit.com, lets the user select items (e.g. by date), and then edits and deletes the selected items on reddit.com. It can also store and switch between the user's Reddit login sessions so the user can clean up several of their own accounts.
```

### Permission justifications

**scripting**
```
Used to run fetch requests inside a reddit.com tab (old.reddit.com) so they are sent with the user's Reddit session: reading the user's identity (/api/me.json), listing their posts and comments (/user/<name>/overview.json), and editing (/api/editusertext) and deleting (/api/del) the items the user selected. Scripts are only injected into reddit.com pages, and only the extension's own bundled functions are executed.
```

**tabs**
```
Used to open and manage the tabs the extension needs: a background old.reddit.com tab through which Reddit API requests are made, a reddit.com/login tab when the user adds an account (closed automatically after login is detected), and to find and focus the already-open extension page instead of opening a duplicate. The extension does not read or collect the user's browsing history.
```

**storage**
```
Used to save, locally in chrome.storage.local, the list of Reddit accounts the user added (username, session cookies and the time it was saved) and which account is currently active, so the user can switch between their own accounts. Nothing is synced or sent off the device.
```

**cookies**
```
Used only for reddit.com cookies to support switching between the user's own Reddit accounts: when an account is added its reddit.com session cookies are saved locally, and when the user switches accounts the current reddit.com cookies are removed and the saved ones for the selected account are restored. Cookies of other websites are never accessed.
```

**Host permission: https://*.reddit.com/***
```
Required to inject the API helper functions into the old.reddit.com tab and to read/write reddit.com cookies for account switching. The extension only acts on reddit.com, the website whose content it manages. No other hosts are accessed.
```

**Are you using remote code?** No, I am not using remote code.
(All JavaScript is bundled in the package; no external scripts, eval or remotely fetched code.)

### Data usage

Check the following types of data collected/handled:

- [x] **Authentication information** — reddit.com session cookies stored locally for account switching
- [x] **Website content** — the user's own Reddit posts and comments, loaded for display and selection
- [ ] Personally identifiable information
- [ ] Health information
- [ ] Financial and payment information
- [ ] Personal communications
- [ ] Location
- [ ] Web history
- [ ] User activity

Certify all three statements:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:**
https://github.com/rakuscinec/reddit-cleaner-extension/blob/main/PRIVACY.md

---

## Distribution tab

- Visibility: Public (or Unlisted for a first test release)
- Regions: All regions
- Pricing: Free

---

## Notes for review

Optional "Notes to reviewer" text (Account / Test instructions):

```
To test: click the toolbar icon (opens app.html in a new tab), log in to any Reddit test account via "+ Log in to a new account" in the top-right menu, then click "Load my posts and comments". Select one item and click "Overwrite and delete selected" → "Confirm and start". The extension only talks to reddit.com; no external servers are used.
```
