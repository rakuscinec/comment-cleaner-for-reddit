// This "popup" is never actually shown — it immediately redirects to the full
// app.html page in a new tab and closes itself, so the extension works as a
// full page rather than a persistent popup window.
// The extension's own open page is found with runtime.getContexts, so no "tabs" permission is needed.
(async () => {
  const url = chrome.runtime.getURL('app.html');
  const [existing] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  if (existing && existing.tabId >= 0) {
    await chrome.tabs.update(existing.tabId, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
})();
