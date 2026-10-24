# Comment Cleaner for Reddit

A Brave/Chrome extension (Manifest V3) that loads all of your Reddit posts and comments, lets you
sort and select them by date, and then bulk **overwrites** and **deletes** them.

## How it works

- The UI runs as a standalone extension page opened in a new tab (not a popup, not a panel inside
  a website).
- In the background it keeps one quiet tab on `old.reddit.com` and uses it to call Reddit's
  official but undocumented JSON API (`/user/<name>/overview.json`, `/api/editusertext`,
  `/api/del`) with your login (cookies) — exactly the way Reddit's own web pages do.
- The button in the top-right corner shows the current account (or “Not logged in”). Clicking it
  opens the list of saved accounts and a “+ Log in to a new account” option.

## Multiple accounts (switching without logging out)

A Reddit session is technically tied to the `reddit.com` cookies in the given browser profile, so
when you add an account the extension captures its cookies and stores them locally
(`chrome.storage.local`, only in your browser). When you switch accounts it removes the current
cookies and restores the saved ones for the chosen account — no Incognito windows or manual
logging out needed.

1. Click the account button (top right) → “+ Log in to a new account”.
2. A new tab opens for logging in to Reddit — log in as usual (you type your password directly on
   reddit.com, never into the extension). The extension detects the login automatically (it
   checks every 2 seconds), closes the tab and saves the account to the list.
3. For another account repeat steps 1–2.
4. Later, switch accounts simply by clicking a name in the list — the extension swaps the cookies
   and reloads the identity.

**Important:** switching accounts changes the Reddit login for the **whole browser** (that
profile/window), not just inside the extension — if you have reddit.com open in another tab, it
will also act as the newly selected account after switching.

## Installation

### From the Chrome Web Store

Install it from the store listing (once published) — works in Chrome, Brave and other
Chromium-based browsers.

### From source (Brave or Chrome)

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on “Developer mode” (top right).
3. Click “Load unpacked” and select this folder (`reddit-cleaner-extension`).
4. Click the extension icon in the toolbar — a new tab with the app opens.

## Usage

1. Choose/log in to an account in the top right (see “Multiple accounts”) and click
   “Load my posts and comments”.
2. Sort by date and select items using:
   - quick buttons (older than an hour / day / week / month),
   - “Latest N items”,
   - a from–to date range,
   - “Invert selection”,
   - or manually via the checkboxes / “Select all”.
3. Set the text the content should be overwritten with (default `.`).
4. Click “Overwrite and delete selected” and confirm the dialog.
5. The extension overwrites and deletes the selected items one by one (with pauses because of
   Reddit's rate limits) and logs the progress at the bottom of the page.

## Important notes

- **Irreversible.** Once overwritten and deleted, the original content cannot be restored.
- **Link/image posts**: the Reddit API does not allow editing the body/title of such posts, so
  they are only deleted (without overwriting) — the extension notes this in the log.
- **Rate limits**: there are deliberate pauses (~1 s) between actions. With hundreds of items it
  can take a while — keep the tab open and don't close the quiet `old.reddit.com` tab.
- This is an unofficial (but common, e.g. by similar open-source tools) use of Reddit's public
  JSON API through your own login. Reddit may change the API's behaviour at any time, which can
  break the tool.
- Try it on a small sample first (e.g. 2–3 old comments) before deleting in bulk.
- **Saved account cookies** contain login session tokens — they are stored only locally in this
  extension's `chrome.storage.local` (never sent anywhere), but anyone with access to your browser
  profile also has access to the saved accounts. On a shared computer consider logging those
  accounts out after use (e.g. via “Log out” directly on Reddit).

## Privacy

See [PRIVACY.md](PRIVACY.md). In short: no analytics, no servers of our own — the extension only
talks to reddit.com and keeps everything in your browser.

## Building the Chrome Web Store package

```sh
./scripts/build.sh
```

Creates `dist/comment-cleaner-for-reddit-<version>.zip` containing only the files the extension needs.
Store listing texts, permission justifications and graphics live in [`store/`](store/).

Icons are rendered from `icons/icon.svg` (48/128 px) and `icons/icon-small.svg` (16/32 px).

## Disclaimer

Comment Cleaner for Reddit is an independent project and is not affiliated with, endorsed or sponsored by
Reddit, Inc.
