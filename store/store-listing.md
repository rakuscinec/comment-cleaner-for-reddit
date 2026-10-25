# Chrome Web Store – submission texts

Copy each block into the matching field in the Chrome Web Store Developer Dashboard.
Upload the package built by `scripts/build.sh` (`dist/comment-cleaner-for-reddit-<version>.zip`).

---

## Store listing tab

**Name** (from manifest)
```
Comment Cleaner for Reddit
```

**Summary / short description** (max 132 characters; taken from the manifest `description`)
```
Load your Reddit posts and comments, select them by date, then bulk overwrite and delete them.
```

**Category**
```
Productivity → Tools
```
(If the dashboard offers only one level: "Tools".)

**Language**
```
English
```

**Detailed description**
```
Clean up your Reddit history in a few clicks.

Comment Cleaner for Reddit loads your posts and comments into one sortable table, lets you pick exactly what should go, and then overwrites and deletes the selected items for you – one by one, respecting Reddit's rate limits.

WHY OVERWRITE FIRST?
Deleting a comment on Reddit removes your name, but copies of the original text can live on in third-party archives and caches. Comment Cleaner for Reddit first edits the content to a text of your choice (a single "." by default) and only then deletes it, so the last version Reddit stores is the overwritten one.

MORE THAN THE NEWEST 1000
Reddit shows at most about 1000 items per list. With deep scan turned on, the extension also reads your comments and posts sorted by top, controversial and hot (all time and past year) and merges the results, which usually reaches much older items. Anything still hidden shows up after newer items are deleted – just load again.

FEATURES
• Fast parallel loading with a progress bar and time estimate
• Progress bar and time estimate while deleting, too
• Sort by type, date, subreddit, score, content or status
• Quick selection: older than 1 hour / 1 day / 1 week / 1 month
• Select the latest N items or everything within a date range
• Select all, clear or invert the selection, or tick items individually
• Custom replacement text used before deletion
• Confirmation dialog before anything irreversible happens
• Live status per item and a detailed log
• Optional: switch between several of your Reddit accounts without signing out

HOW IT WORKS
The extension opens as a full page in a new tab and shows right away which Reddit account you are signed in to. It uses your existing Reddit sign-in and talks only to reddit.com – the same requests Reddit's own website makes. You always sign in directly on reddit.com; the extension never sees your password.

PRIVACY
• No servers, no analytics, no tracking, no ads
• Nothing is sent to the developer or any third party
• Saved account sessions are stored only locally in your browser

GOOD TO KNOW
• Deletion is permanent – try it on a few old comments first.
• Link and image posts cannot be edited on Reddit, so they are deleted without overwriting. Archived items are also deleted without overwriting.
• Switching accounts changes your Reddit sign-in for the whole browser profile.
• The extension uses Reddit's unofficial web API, which may change at any time.

Comment Cleaner for Reddit is an independent project and is not affiliated with, endorsed by or sponsored by Reddit, Inc.
```

**Graphic assets** (files in this folder)
- Store icon 128×128: `../extension/icons/icon128.png`
- Screenshot 1 (1280×800): `screenshot-1.png` – deletion in progress
- Screenshot 2 (1280×800): `screenshot-2.png` – loaded table and account menu
- Small promo tile 440×280: `promo-small-440x280.png`
- Marquee promo tile 1400×560: `promo-marquee-1400x560.png`

Screenshots show the real UI (`extension/app.html` + `app.css`) with fictional demo data (accounts
`u/demo_user` and `u/demo_alt`). All PNGs are 24-bit RGB without alpha.

**Homepage URL**
```
https://rakuscinec.github.io/comment-cleaner-for-reddit/
```

**Support URL**
```
https://github.com/rakuscinec/comment-cleaner-for-reddit/issues
```

---

## Privacy practices tab

**Single purpose description**
```
The extension has a single purpose: it lets the signed-in user overwrite and delete their own Reddit posts and comments in bulk. It loads the user's posts and comments from reddit.com, lets the user select items (for example by date) and then edits and deletes the selected items on reddit.com. Optional switching between saved Reddit accounts only serves this purpose (cleaning up several of the user's own accounts).
```

**Permission justifications**

`scripting`
```
Used to run the extension's requests inside an old.reddit.com tab, so they use the user's existing Reddit sign-in exactly like the Reddit website does: reading the signed-in username (/api/me.json), listing the user's posts and comments (/user/<name>/comments.json and /submitted.json), and editing (/api/editusertext) and deleting (/api/del) the items the user selected. Only the extension's own bundled functions are executed, and only in reddit.com tabs.
```

`storage`
```
Used to store, locally in the browser (chrome.storage.local), the list of Reddit accounts the user has added for account switching (username, session cookies, time saved) and which one is active. Nothing is synced or sent anywhere.
```

`cookies`
```
Used only for the optional multi-account feature: when the user adds a Reddit account, the extension saves that account's reddit.com cookies in local extension storage. When the user switches accounts, it clears the reddit.com cookies and restores the saved ones, so the user can clean up several of their own accounts without signing out and in again. Only reddit.com cookies are read or written.
```

Host permission `https://*.reddit.com/*`
```
Required to find or open the old.reddit.com tab used for the requests above and run the extension's functions in it, to read the user's own posts and comments and to edit and delete the ones the user selects, and to read and write reddit.com cookies for account switching. The extension does not access any other site.
```

(The `tabs` permission is not requested: the extension only opens, focuses and closes tabs and reads
the URL of reddit.com tabs, which the host permission already covers. Its own page is found with
`chrome.runtime.getContexts`.)

**Are you using remote code?**
```
No, I am not using remote code.
```
(All JavaScript is bundled in the package. The extension only fetches JSON data from Reddit.)

**Data usage** – tick these categories:
- [x] **Authentication information** – reddit.com session cookies (only when the user adds an account
  for switching) and Reddit's modhash anti-forgery token.
- [x] **Personally identifiable information** – the Reddit username.
- [x] **Website content** – the text, titles and links of the user's own posts and comments.

Leave all other categories unticked (health, financial and payment, personal communications,
location, web history, user activity – the extension does not monitor clicks, keystrokes or browsing).

Tick all three certifications:
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**
```
https://rakuscinec.github.io/comment-cleaner-for-reddit/privacy-policy.html
```

---

## Distribution tab

- Visibility: Public (or Unlisted for a test run first)
- Regions: All regions
- Pricing: Free

## Notes for the reviewer (optional field "Test instructions", if requested)
```
A Reddit account with at least one comment is needed. Sign in to reddit.com, click the extension icon (it opens the extension page in a new tab and shows the signed-in account), then click "Load my posts and comments". Editing and deleting are only performed after the user selects items, clicks "Overwrite and delete selected" and confirms in a dialog. The extension only talks to reddit.com; no external servers are used.
```
