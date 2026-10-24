'use strict';

/* ---------- state ---------- */
let bridgeTabId = null;
let identity = null;      // { name, modhash }
let items = [];           // list of posts/comments
let sortKey = 'created';
let sortDesc = true;
let processing = false;

/* ---------- helpers ---------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function pad2(n) { return String(n).padStart(2, '0'); }

// Local time as YYYY-MM-DD HH:MM:SS
function formatDateTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function log(msg) {
  const el = document.getElementById('logOutput');
  el.textContent += `[${formatDateTime(Date.now())}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function setStatus(msg) {
  document.getElementById('statusText').textContent = msg;
}

/* ---------- bridge tab (old.reddit.com) ---------- */
function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    function check() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (tab.status === 'complete') { resolve(); return; }
        setTimeout(check, 200);
      });
    }
    check();
  });
}

async function ensureBridgeTab() {
  if (bridgeTabId !== null) {
    try {
      const tab = await chrome.tabs.get(bridgeTabId);
      if (tab) return bridgeTabId;
    } catch (e) { bridgeTabId = null; }
  }
  const existing = await chrome.tabs.query({ url: 'https://old.reddit.com/*' });
  let tab = existing[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: 'https://old.reddit.com/', active: false });
    await waitForTabComplete(tab.id);
  } else if (tab.status !== 'complete') {
    await waitForTabComplete(tab.id);
  }
  bridgeTabId = tab.id;
  return bridgeTabId;
}

async function exec(tabId, func, args) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args: args || []
  });
  return result;
}

/* ---------- account management via cookies ---------- */
const REDDIT_COOKIE_DOMAIN = 'reddit.com';
let pendingLoginTabId = null;
let pendingLoginPoll = null;

async function getRedditCookies() {
  return chrome.cookies.getAll({ domain: REDDIT_COOKIE_DOMAIN });
}

function cookieToUrl(c) {
  const domain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
  return `https://${domain}${c.path}`;
}

async function clearRedditCookies() {
  const cookies = await getRedditCookies();
  for (const c of cookies) {
    await chrome.cookies.remove({ url: cookieToUrl(c), name: c.name, storeId: c.storeId });
  }
}

async function restoreCookies(cookies) {
  for (const c of cookies) {
    const details = {
      url: cookieToUrl(c),
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      storeId: c.storeId
    };
    if (!c.hostOnly) details.domain = c.domain;
    if (!c.session && c.expirationDate) details.expirationDate = c.expirationDate;
    await chrome.cookies.set(details);
  }
}

async function activateAccount(username) {
  const { accounts = {} } = await chrome.storage.local.get('accounts');
  const acc = accounts[username];
  if (!acc) return;

  setStatus('Switching to account u/' + username + '...');
  await clearRedditCookies();
  await restoreCookies(acc.cookies);
  await chrome.storage.local.set({ activeAccount: username });

  items = [];
  identity = null;
  renderTable();
  document.getElementById('filterRow').hidden = true;
  document.getElementById('replaceRow').hidden = true;
  document.getElementById('actionRow').hidden = true;

  try {
    await ensureBridgeTab();
    identity = await exec(bridgeTabId, __rc_getIdentity);
    log('Switched to account u/' + identity.name + '.');
    setStatus('Active account: u/' + identity.name);
  } catch (e) {
    log('ERROR switching to u/' + username + ': ' + e.message);
    setStatus('Error switching account: ' + e.message);
  }
  await refreshAccountUI();
}

function stopLoginPoll() {
  if (pendingLoginPoll) { clearInterval(pendingLoginPoll); pendingLoginPoll = null; }
}

function setAddAccountUIWaiting(waiting) {
  document.getElementById('addAccountBtn').hidden = waiting;
  document.getElementById('cancelLoginBtn').hidden = !waiting;
  document.getElementById('loginHint').hidden = !waiting;
}

function cancelPendingLogin(reason) {
  stopLoginPoll();
  if (pendingLoginTabId) {
    chrome.tabs.remove(pendingLoginTabId).catch(() => {});
    pendingLoginTabId = null;
  }
  setAddAccountUIWaiting(false);
  setStatus(reason || 'Stopped waiting for login.');
}

async function addAccount() {
  if (pendingLoginTabId) return;

  setAddAccountUIWaiting(true);
  setStatus('Logging out of the current Reddit account so a new one can log in...');
  // Without clearing cookies, Reddit's /login would redirect back to the already logged-in user.
  await clearRedditCookies();
  identity = null;
  bridgeTabId = null;
  await refreshAccountUI();

  // Identity is checked via the separate old.reddit.com (bridge) tab, not the www.reddit.com login
  // tab — that one has a different API shape and /api/me.json may not behave the same there.
  await ensureBridgeTab();

  const tab = await chrome.tabs.create({ url: 'https://www.reddit.com/login', active: true });
  pendingLoginTabId = tab.id;
  log('Opened a Reddit login tab (tab ' + tab.id + '). Log in EXACTLY in that tab — the account will be captured automatically.');
  setStatus('Waiting for you to log in in the newly opened tab... (attempt 0)');

  let attempts = 0;
  const maxAttempts = 150; // ~5 min at a 2 s interval

  pendingLoginPoll = setInterval(async () => {
    attempts++;
    const stillOpen = await chrome.tabs.get(pendingLoginTabId).catch(() => null);
    if (!stillOpen) {
      cancelPendingLogin('The login tab was closed, cancelled.');
      return;
    }
    try {
      const id = await exec(bridgeTabId, __rc_getIdentity);
      stopLoginPoll();
      const cookies = await getRedditCookies();
      const { accounts = {} } = await chrome.storage.local.get('accounts');
      accounts[id.name] = { cookies, savedAt: Date.now() };
      await chrome.storage.local.set({ accounts, activeAccount: id.name });
      identity = id;
      await chrome.tabs.remove(pendingLoginTabId).catch(() => {});
      pendingLoginTabId = null;
      setAddAccountUIWaiting(false);
      log('Saved new account: u/' + id.name);
      setStatus('Account u/' + id.name + ' saved and activated.');
      await refreshAccountUI();
    } catch (e) {
      if (attempts >= maxAttempts) {
        cancelPendingLogin('Login timed out (5 min). Last error: ' + e.message);
        log('Could not detect a login within 5 minutes. Last error: ' + e.message);
        return;
      }
      setStatus('Waiting for login in the new tab... (attempt ' + attempts + '/' + maxAttempts + ', not logged in yet)');
      if (attempts % 5 === 0) {
        log('Still waiting for login (attempt ' + attempts + '). Reason: ' + e.message);
      }
    }
  }, 2000);
}

async function refreshAccountUI() {
  const { accounts = {}, activeAccount } = await chrome.storage.local.get(['accounts', 'activeAccount']);
  const currentName = identity ? identity.name : activeAccount;
  const list = document.getElementById('accountList');
  list.innerHTML = '';

  const names = Object.keys(accounts);
  if (!names.length) {
    const empty = document.createElement('div');
    empty.className = 'account-empty';
    empty.textContent = 'No saved accounts yet.';
    list.appendChild(empty);
  } else {
    for (const name of names) {
      const row = document.createElement('button');
      row.className = 'account-row' + (name === currentName ? ' active' : '');
      row.textContent = 'u/' + name + (name === currentName ? ' ✓' : '');
      row.addEventListener('click', () => { activateAccount(name); document.getElementById('accountMenu').hidden = true; });
      list.appendChild(row);
    }
  }

  document.getElementById('identityBtn').textContent = (currentName ? 'u/' + currentName : 'Not logged in') + ' ▾';
}

/* ---------- functions executed in the context of the reddit tab ---------- */
async function __rc_getIdentity() {
  const res = await fetch('/api/me.json', { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!data || !data.data || !data.data.name) {
    throw new Error('You are not logged in to Reddit (in the old.reddit.com tab).');
  }
  return { name: data.data.name, modhash: data.data.modhash || '' };
}

async function __rc_fetchPage(username, after) {
  const url = '/user/' + encodeURIComponent(username) + '/overview.json?sort=new&limit=100' + (after ? '&after=' + after : '');
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  return json.data;
}

async function __rc_editItem(fullname, text, modhash) {
  const body = new URLSearchParams({ api_type: 'json', thing_id: fullname, text, uh: modhash });
  const res = await fetch('/api/editusertext', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-modhash': modhash },
    body
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json().catch(() => null);
  if (json && json.json && json.json.errors && json.json.errors.length) {
    throw new Error(JSON.stringify(json.json.errors));
  }
  return true;
}

async function __rc_deleteItem(fullname, modhash) {
  const body = new URLSearchParams({ id: fullname, uh: modhash });
  const res = await fetch('/api/del', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-modhash': modhash },
    body
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return true;
}

/* ---------- loading content ---------- */
function mapChild(child) {
  const d = child.data;
  const isComment = child.kind === 't1';
  return {
    kind: child.kind,
    fullname: d.name,
    id: d.id,
    created: d.created_utc * 1000,
    subreddit: d.subreddit,
    score: d.score,
    permalink: 'https://www.reddit.com' + d.permalink,
    snippet: isComment ? (d.body || '') : (d.selftext || d.title || ''),
    editable: isComment ? true : !!(d.is_self && typeof d.selftext === 'string' && d.selftext.length >= 0),
    selected: false,
    status: 'pending'
  };
}

async function loadAll() {
  const loadBtn = document.getElementById('loadBtn');
  loadBtn.disabled = true;
  try {
    setStatus('Connecting to Reddit (old.reddit.com)...');
    await ensureBridgeTab();
    identity = await exec(bridgeTabId, __rc_getIdentity);
    await refreshAccountUI();
    setStatus('Loading content...');

    items = [];
    let after = null;
    let guard = 0;
    do {
      const page = await exec(bridgeTabId, __rc_fetchPage, [identity.name, after]);
      for (const child of page.children) items.push(mapChild(child));
      after = page.after;
      setStatus('Items loaded: ' + items.length);
      guard++;
      if (after) await sleep(700);
    } while (after && guard < 200);

    sortItems();
    renderTable();
    document.getElementById('filterRow').hidden = false;
    document.getElementById('replaceRow').hidden = false;
    document.getElementById('actionRow').hidden = false;
    setStatus('Done. Loaded ' + items.length + ' items.');
    log('Loaded ' + items.length + ' posts and comments for u/' + identity.name + '.');
  } catch (e) {
    setStatus('Error: ' + e.message);
    log('ERROR while loading: ' + e.message);
  } finally {
    loadBtn.disabled = false;
  }
}

/* ---------- sorting and rendering ---------- */
const SORT_ACCESSORS = {
  kind: item => item.kind === 't1' ? 'comment' : 'post',
  created: item => item.created,
  subreddit: item => item.subreddit.toLowerCase(),
  score: item => item.score,
  snippet: item => (item.snippet || '').toLowerCase(),
  status: item => item.status
};

function compareValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortItems() {
  const accessor = SORT_ACCESSORS[sortKey] || SORT_ACCESSORS.created;
  items.sort((a, b) => {
    const cmp = compareValues(accessor(a), accessor(b));
    return sortDesc ? -cmp : cmp;
  });
}

function updateSortIndicators() {
  document.querySelectorAll('#itemsTable thead th[data-sort-key]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sortKey === sortKey) {
      arrow.textContent = sortDesc ? ' ↓' : ' ↑';
      th.classList.add('sorted');
    } else {
      arrow.textContent = '';
      th.classList.remove('sorted');
    }
  });
}

function renderTable() {
  const body = document.getElementById('itemsBody');
  const emptyState = document.getElementById('emptyState');
  body.innerHTML = '';

  if (!items.length) {
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    for (const item of items) {
      const tr = document.createElement('tr');

      const tdCheck = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.selected;
      cb.disabled = item.status !== 'pending';
      cb.addEventListener('change', () => { item.selected = cb.checked; updateSelectedCount(); });
      tdCheck.appendChild(cb);

      const tdType = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'badge ' + (item.kind === 't1' ? 'comment' : 'post');
      badge.textContent = item.kind === 't1' ? 'comment' : 'post';
      tdType.appendChild(badge);

      const tdDate = document.createElement('td');
      tdDate.textContent = formatDateTime(item.created);

      const tdSub = document.createElement('td');
      tdSub.textContent = 'r/' + item.subreddit;

      const tdScore = document.createElement('td');
      tdScore.className = 'score ' + (item.score > 0 ? 'score-positive' : item.score < 0 ? 'score-negative' : 'score-zero');
      tdScore.textContent = (item.score > 0 ? '+' : '') + item.score;

      const tdSnippet = document.createElement('td');
      tdSnippet.className = 'snippet';
      const snippetLink = document.createElement('a');
      snippetLink.href = item.permalink;
      snippetLink.target = '_blank';
      snippetLink.rel = 'noopener noreferrer';
      snippetLink.title = item.snippet;
      snippetLink.textContent = item.snippet || '(no text)';
      tdSnippet.appendChild(snippetLink);

      const tdStatus = document.createElement('td');
      tdStatus.className = 'status-' + item.status;
      tdStatus.textContent = statusLabel(item.status);

      tr.append(tdCheck, tdType, tdDate, tdSub, tdScore, tdSnippet, tdStatus);
      body.appendChild(tr);
    }
  }
  updateSelectedCount();
  updateSortIndicators();
}

function statusLabel(s) {
  switch (s) {
    case 'pending': return 'pending';
    case 'processing': return 'processing...';
    case 'done': return 'deleted';
    case 'error': return 'error';
    case 'skipped': return 'skipped';
    default: return s;
  }
}

function updateSelectedCount() {
  const n = items.filter(i => i.selected && i.status === 'pending').length;
  document.getElementById('selectedCount').textContent = 'Selected: ' + n;
  document.getElementById('deleteBtn').disabled = n === 0 || processing;
}

/* ---------- selection tools ---------- */
function selectAll(v) {
  items.forEach(i => { if (i.status === 'pending') i.selected = v; });
  renderTable();
}

function selectLastN(n) {
  const sorted = [...items].sort((a, b) => b.created - a.created);
  let count = 0;
  for (const item of sorted) {
    if (count >= n) break;
    if (item.status === 'pending') { item.selected = true; count++; }
  }
  renderTable();
}

function selectOlderThanMs(ms) {
  const cutoff = Date.now() - ms;
  items.forEach(i => { if (i.status === 'pending' && i.created <= cutoff) i.selected = true; });
  renderTable();
}

function invertSelection() {
  items.forEach(i => { if (i.status === 'pending') i.selected = !i.selected; });
  renderTable();
}

function selectDateRange(fromTs, toTs) {
  items.forEach(i => { if (i.status === 'pending' && i.created >= fromTs && i.created <= toTs) i.selected = true; });
  renderTable();
}

/* ---------- overwrite + delete ---------- */
async function processSelected(replacementText) {
  processing = true;
  const selected = items.filter(i => i.selected && i.status === 'pending');
  log('Starting to process ' + selected.length + ' items. Replacement text: "' + replacementText + '"');

  for (const item of selected) {
    item.status = 'processing';
    renderTable();
    try {
      if (item.editable) {
        await exec(bridgeTabId, __rc_editItem, [item.fullname, replacementText, identity.modhash]);
        await sleep(1100);
      }
      await exec(bridgeTabId, __rc_deleteItem, [item.fullname, identity.modhash]);
      item.status = 'done';
      log('OK: ' + (item.kind === 't1' ? 'comment' : 'post') + ' in r/' + item.subreddit + ' (' + formatDateTime(item.created) + ') deleted.');
    } catch (e) {
      item.status = 'error';
      log('ERROR (' + item.fullname + '): ' + e.message);
    }
    renderTable();
    await sleep(1100);
  }

  processing = false;
  log('Processing finished.');
  setStatus('Processing finished.');
}

/* ---------- UI events ---------- */
document.getElementById('loadBtn').addEventListener('click', loadAll);

document.querySelectorAll('#itemsTable thead th[data-sort-key]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sortKey;
    if (sortKey === key) {
      sortDesc = !sortDesc;
    } else {
      sortKey = key;
      sortDesc = true;
    }
    sortItems();
    renderTable();
  });
});

document.querySelectorAll('.quick-select').forEach(btn => {
  btn.addEventListener('click', () => selectOlderThanMs(Number(btn.dataset.ms)));
});

document.getElementById('lastNBtn').addEventListener('click', () => {
  const n = parseInt(document.getElementById('lastNInput').value, 10);
  if (n > 0) selectLastN(n);
});

document.getElementById('dateRangeBtn').addEventListener('click', () => {
  const fromVal = document.getElementById('dateFrom').value;
  const toVal = document.getElementById('dateTo').value;
  if (!fromVal && !toVal) return;
  const fromTs = fromVal ? new Date(fromVal + 'T00:00:00').getTime() : -Infinity;
  const toTs = toVal ? new Date(toVal + 'T23:59:59').getTime() : Infinity;
  selectDateRange(fromTs, toTs);
});

document.getElementById('selectAllBtn').addEventListener('click', () => selectAll(true));
document.getElementById('clearSelBtn').addEventListener('click', () => selectAll(false));
document.getElementById('invertSelBtn').addEventListener('click', invertSelection);

document.getElementById('masterCheck').addEventListener('change', (e) => selectAll(e.target.checked));

/* confirmation modal */
const modal = document.getElementById('confirmModal');
const confirmOk = document.getElementById('confirmOk');

document.getElementById('deleteBtn').addEventListener('click', () => {
  const n = items.filter(i => i.selected && i.status === 'pending').length;
  if (!n) return;
  document.getElementById('confirmText').textContent = `Do you really want to overwrite and permanently delete ${n} item${n === 1 ? '' : 's'}?`;
  modal.hidden = false;
  confirmOk.focus();
});

document.getElementById('confirmCancel').addEventListener('click', () => { modal.hidden = true; });

confirmOk.addEventListener('click', async () => {
  modal.hidden = true;
  const replacementText = document.getElementById('replacementText').value || '.';
  document.getElementById('deleteBtn').disabled = true;
  await processSelected(replacementText);
  updateSelectedCount();
});

/* identity dropdown */
const identityBtn = document.getElementById('identityBtn');
const accountMenu = document.getElementById('accountMenu');

identityBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  accountMenu.hidden = !accountMenu.hidden;
});

document.addEventListener('click', (e) => {
  if (!accountMenu.hidden && !accountMenu.contains(e.target) && e.target !== identityBtn) {
    accountMenu.hidden = true;
  }
});

document.getElementById('addAccountBtn').addEventListener('click', addAccount);
document.getElementById('cancelLoginBtn').addEventListener('click', () => cancelPendingLogin('Stopped waiting for login.'));

renderTable();
refreshAccountUI();
