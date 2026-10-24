# Privacy Policy — Comment Cleaner for Reddit

_Last updated: 25 October 2026_

Comment Cleaner for Reddit (“the extension”) is a browser extension that helps you overwrite and
delete your own Reddit posts and comments. This policy explains what data the extension handles and how.

## Summary

- The extension has **no servers** of its own and **does not send any data to the developer** or
  to any third party.
- It communicates **only with reddit.com**, using your own Reddit login, to perform the actions
  you request.
- It contains **no analytics, tracking, advertising or remote code**.

## Data the extension handles

### Reddit session cookies (authentication information)

To let you switch between several Reddit accounts, the extension reads your `reddit.com` cookies
when you add an account and stores them together with the account's username in
`chrome.storage.local` — storage that lives only inside your browser profile. When you switch
accounts, the extension replaces the current `reddit.com` cookies with the saved ones.

These cookies are never transmitted anywhere except to reddit.com itself, as part of normal
requests to Reddit. Your Reddit password is never seen by the extension — you log in directly on
reddit.com.

### Your posts and comments (website content)

When you click “Load my posts and comments”, the extension downloads the list of your posts and
comments from reddit.com and shows them in a table. This data is kept **only in memory** while the
extension page is open; it is not saved to disk and is discarded when you close the page.

When you start a deletion, the extension sends edit and delete requests for the items you selected
to reddit.com.

### Other stored data

The extension stores the username of the currently active account (`activeAccount`) and the time
each account was saved, in `chrome.storage.local`.

## Data sharing

The extension does not sell, share or transfer any user data to third parties. It does not use or
transfer data for purposes unrelated to its single purpose (managing your own Reddit content), and
does not use it to determine creditworthiness or for lending purposes.

## Data retention and deletion

Saved account data stays in your browser until you remove the extension or clear the extension's
storage. Uninstalling the extension deletes all of its stored data. Content you delete on Reddit
is deleted by Reddit and cannot be recovered by the extension.

## Security note

Saved session cookies give access to the saved Reddit accounts. Anyone with access to your browser
profile could use them. On a shared computer, log out of the saved accounts on Reddit after use
(this invalidates the stored sessions) or remove the extension.

## Changes

If this policy changes, the updated version will be published in this repository with a new
“Last updated” date.

## Contact

Questions or concerns about this policy or the extension:

- Email: [schrapnel@gmail.com](mailto:schrapnel@gmail.com)
- GitHub: <https://github.com/rakuscinec/reddit-cleaner-extension/issues>
