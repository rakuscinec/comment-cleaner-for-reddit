'use strict';

/* ---------- state ---------- */
let bridgeTabId = null;
let identity = null;      // { name, modhash }
let items = [];           // list of posts/comments
let sortKey = 'created';
let sortDesc = true;
let processing = false;
let stopLoading = false;
let loggedOut = false;    // the startup session check found that nobody is signed in

/* ---------- helpers ---------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function pad2(n) { return String(n).padStart(2, '0'); }

// Format: YYYY-MM-DD HH:MM:SS (local time)
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

function kindLabel(item) { return item.kind === 't1' ? 'comment' : 'post'; }

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
      if (tab && tab.url && tab.url.startsWith('https://old.reddit.com/')) return bridgeTabId;
    } catch (e) { /* tab was closed */ }
    bridgeTabId = null;
  }
  const existing = (await chrome.tabs.query({ url: 'https://old.reddit.com/*' }))
    .filter(t => t.id !== pendingLoginTabId);
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

// Runs in the page context (MAIN world) so requests are exactly like those made by
// old.reddit.com itself: same origin, same cookies, same headers.
async function exec(tabId, func, args) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args: args || [],
    world: 'MAIN'
  });
  if (result && result.__error) throw new Error(result.__error);
  return result;
}

async function loadIdentity() {
  await ensureBridgeTab();
  identity = await exec(bridgeTabId, __rc_getIdentity);
  loggedOut = false;
  return identity;
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

function hideResultRows() {
  document.getElementById('filterRow').hidden = true;
  document.getElementById('replaceRow').hidden = true;
  document.getElementById('actionRow').hidden = true;
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
  hideResultRows();

  try {
    await loadIdentity();
    log('Switched to account u/' + identity.name + '.');
    setStatus('Active account: u/' + identity.name);
  } catch (e) {
    loggedOut = true;
    log('ERROR switching to u/' + username + ': ' + e.message + ' (the saved session may have expired — sign in to this account again).');
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
  setStatus(reason || 'Waiting for sign-in cancelled.');
}

async function addAccount() {
  if (pendingLoginTabId) return;

  setAddAccountUIWaiting(true);
  setStatus('Signing out of the current Reddit account so a new one can sign in...');
  // Without clearing cookies, Reddit's /login would redirect back to the already signed-in user.
  await clearRedditCookies();
  identity = null;
  loggedOut = true;
  bridgeTabId = null;
  await refreshAccountUI();

  // Identity is checked through the separate old.reddit.com bridge tab, not the sign-in tab,
  // which redirects during sign-in, so a script in it might not finish.
  await ensureBridgeTab();

  const tab = await chrome.tabs.create({ url: 'https://www.reddit.com/login', active: true });
  pendingLoginTabId = tab.id;
  log('Opened a Reddit sign-in tab (tab ' + tab.id + '). Sign in in EXACTLY that tab — the account will be detected automatically.');
  setStatus('Waiting for you to sign in in the newly opened tab... (attempt 0)');

  let attempts = 0;
  const maxAttempts = 150; // ~5 min at a 2 s interval

  pendingLoginPoll = setInterval(async () => {
    attempts++;
    const stillOpen = await chrome.tabs.get(pendingLoginTabId).catch(() => null);
    if (!stillOpen) {
      cancelPendingLogin('The sign-in tab was closed, cancelled.');
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
      loggedOut = false;
      await chrome.tabs.remove(pendingLoginTabId).catch(() => {});
      pendingLoginTabId = null;
      setAddAccountUIWaiting(false);
      log('Saved new account: u/' + id.name);
      setStatus('Account u/' + id.name + ' saved and activated.');
      await refreshAccountUI();
    } catch (e) {
      if (attempts >= maxAttempts) {
        cancelPendingLogin('Sign-in timed out (5 min). Last error: ' + e.message);
        log('Could not detect a sign-in within 5 minutes. Last error: ' + e.message);
        return;
      }
      setStatus('Waiting for sign-in in the new tab... (attempt ' + attempts + '/' + maxAttempts + ', not signed in yet)');
      if (attempts % 5 === 0) {
        log('Still waiting for sign-in (attempt ' + attempts + '). Reason: ' + e.message);
      }
    }
  }, 2000);
}

async function refreshAccountUI() {
  const { accounts = {}, activeAccount } = await chrome.storage.local.get(['accounts', 'activeAccount']);
  // If the session check failed, don't show the last active saved account as signed in.
  const currentName = identity ? identity.name : (loggedOut ? null : activeAccount);
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

  document.getElementById('identityBtn').textContent = (currentName ? 'u/' + currentName : 'Not signed in') + ' ▾';
}

/* ---------- functions executed in the old.reddit.com tab (MAIN world) ----------
 * They must be self-contained (no references to outer variables) and return plain data.
 * Errors are returned as { __error } because thrown errors lose their message on the way back.
 */
async function __rc_getIdentity() {
  try {
    const res = await fetch('/api/me.json?raw_json=1', { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return { __error: 'HTTP ' + res.status + ' from /api/me.json' };
    const data = await res.json();
    // Signed out, /api/me.json returns {}.
    if (!data || !data.data || !data.data.name) return { __error: 'You are not signed in to Reddit.' };
    return { name: data.data.name, modhash: data.data.modhash || '' };
  } catch (e) {
    return { __error: String(e && e.message || e) };
  }
}

// One page (up to 100 items) of /user/<name>/<where>.json. Retries 429 / 5xx with a back-off
// and reports Reddit's rate-limit headers so the caller can slow down before hitting the limit.
async function __rc_fetchListing(username, where, sort, t, after) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const params = new URLSearchParams({ sort, limit: '100', raw_json: '1' });
  if (t) params.set('t', t);
  if (after) params.set('after', after);
  const url = '/user/' + encodeURIComponent(username) + '/' + where + '.json?' + params;
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        const retryAfter = Number(res.headers.get('retry-after')) || Number(res.headers.get('x-ratelimit-reset')) || 0;
        await sleep(Math.max(retryAfter * 1000, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) return { __error: 'HTTP ' + res.status + ' for ' + where + ' (' + sort + (t ? '/' + t : '') + ')' };
      const json = await res.json();
      const data = (json && json.data) || {};
      const children = (data.children || []).map(c => {
        const d = c.data || {};
        return {
          kind: c.kind,
          name: d.name,
          created_utc: d.created_utc,
          subreddit: d.subreddit || '',
          score: d.score || 0,
          permalink: d.permalink || '',
          body: d.body,
          title: d.title,
          selftext: d.selftext,
          is_self: !!d.is_self,
          archived: !!d.archived,
          locked: !!d.locked
        };
      });
      return {
        children,
        after: data.after || null,
        remaining: Number(res.headers.get('x-ratelimit-remaining')),
        reset: Number(res.headers.get('x-ratelimit-reset'))
      };
    }
  } catch (e) {
    return { __error: String(e && e.message || e) };
  }
}

// One POST to the Reddit web API. Retries 429 / 5xx and Reddit's own "RATELIMIT" errors
// ("you are doing that too much. try again in 5 seconds.") after the requested delay.
async function __rc_post(path, fields, modhash) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-modhash': modhash },
        body: new URLSearchParams(Object.assign({ uh: modhash }, fields))
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        const retryAfter = Number(res.headers.get('retry-after')) || Number(res.headers.get('x-ratelimit-reset')) || 0;
        await sleep(Math.max(retryAfter * 1000, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) return { __error: 'HTTP ' + res.status };
      const json = await res.json().catch(() => null);
      const errors = json && json.json && json.json.errors;
      if (errors && errors.length) {
        const rl = errors.find(e => e[0] === 'RATELIMIT');
        if (rl && attempt < 5) {
          const m = /(\d+)\s*(second|minute|millisecond)/.exec(rl[1] || '');
          const unit = m ? (m[2] === 'minute' ? 60000 : m[2] === 'second' ? 1000 : 1) : 1000;
          await sleep((m ? Number(m[1]) * unit : 5000) + 500);
          continue;
        }
        return { __error: errors.map(e => e[0] + ': ' + e[1]).join('; ') };
      }
      return { ok: true };
    }
  } catch (e) {
    return { __error: String(e && e.message || e) };
  }
}

/* ---------- loading content ---------- */
function mapChild(c) {
  const isComment = c.kind === 't1';
  return {
    kind: c.kind,
    fullname: c.name,
    created: c.created_utc * 1000,
    subreddit: c.subreddit,
    score: c.score,
    permalink: 'https://www.reddit.com' + c.permalink,
    snippet: isComment ? (c.body || '') : (c.selftext || c.title || ''),
    // Only comments and text posts have an editable body.
    editable: isComment || c.is_self,
    archived: c.archived,
    selected: false,
    status: 'pending'
  };
}

// Reddit returns at most ~1000 items (10 pages of 100) per listing and sort order.
const LISTING_CAP_PAGES = 10;
const NEW_STREAMS = [
  { where: 'comments', sort: 'new' },
  { where: 'submitted', sort: 'new' }
];
// Extra sort orders: each has its own ~1000-item window, so together they reach older items.
const DEEP_SORTS = [
  { sort: 'top', t: 'all' },
  { sort: 'controversial', t: 'all' },
  { sort: 'hot' },
  { sort: 'top', t: 'year' },
  { sort: 'controversial', t: 'year' }
];
const LISTING_CONCURRENCY = 4;

/* ---------- progress ---------- */
let progress = null;
let progressTimer = null;
let renderTimer = null;

// Re-render the table at most once per second — with parallel loading, items arrive
// from several listings at once and a full re-render is expensive.
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    sortItems();
    renderTable();
  }, 1000);
}

function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ' + pad2(s % 60) + ' s';
  return Math.floor(m / 60) + ' h ' + pad2(m % 60) + ' min';
}

// progress = { label, startTs, done, total, totalIsUpperBound, finished, text }
function startProgress(p) {
  progress = Object.assign({ startTs: Date.now(), done: 0, total: 0, totalIsUpperBound: false, finished: false, text: '' }, p);
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(renderProgress, 500);
  renderProgress();
}

function finishProgress() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  if (progress) progress.finished = true;
  renderProgress();
}

function renderProgress() {
  const wrap = document.getElementById('progressWrap');
  if (!progress) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const p = progress;
  const ratio = p.total ? Math.min(1, p.done / p.total) : 0;
  document.getElementById('progressFill').style.width = (p.finished ? 100 : ratio * 100).toFixed(1) + '%';

  const elapsed = Date.now() - p.startTs;
  let eta;
  if (p.finished) {
    eta = 'Done in ' + formatDuration(elapsed);
  } else if (p.done > 0 && elapsed > 2000) {
    const remaining = (p.total - p.done) * (elapsed / p.done);
    // When the total is only an upper bound (listings may end early), the estimate is a maximum.
    eta = (p.totalIsUpperBound ? 'At most ~' : '~') + formatDuration(remaining) + ' left';
  } else {
    eta = 'Estimating time...';
  }
  document.getElementById('progressText').textContent = p.text;
  document.getElementById('progressEta').textContent = eta;
}

async function loadAll() {
  const loadBtn = document.getElementById('loadBtn');
  const stopBtn = document.getElementById('stopLoadBtn');
  const deep = document.getElementById('deepScanInput').checked;
  loadBtn.disabled = true;
  stopBtn.hidden = false;
  stopLoading = false;
  try {
    setStatus('Connecting to Reddit (old.reddit.com)...');
    await loadIdentity();
    await refreshAccountUI();

    items = [];
    const seen = new Map();   // fullname -> item (deduplication across listings)
    renderTable();
    document.getElementById('filterRow').hidden = false;
    document.getElementById('replaceRow').hidden = false;
    document.getElementById('actionRow').hidden = false;

    // Shared gate: when Reddit reports that few requests are left in the current window,
    // all listing workers wait until the window resets.
    let pauseUntil = 0;
    let pages = 0;
    let plannedPages = 0;
    let extraFound = 0;

    const updateText = () => {
      progress.done = pages;
      progress.total = Math.max(plannedPages, pages);
      progress.text = `Pages: ${pages}/${progress.total}` +
        ` · Items: ${items.length.toLocaleString('en')}` +
        (deep ? ` · Older items found via extra sort orders: ${extraFound.toLocaleString('en')}` : '');
    };

    startProgress({ totalIsUpperBound: true });
    setStatus('Loading content...');

    // Reads one listing (one sort order) page by page; returns true if it hit Reddit's ~1000 cap.
    async function readStream(s, isExtra) {
      plannedPages += LISTING_CAP_PAGES;
      let after = null;
      let n = 0;
      let count = 0;
      try {
        do {
          const wait = pauseUntil - Date.now();
          if (wait > 0) await sleep(wait);
          const page = await exec(bridgeTabId, __rc_fetchListing, [identity.name, s.where, s.sort, s.t || '', after]);
          n++;
          pages++;
          for (const c of page.children) {
            count++;
            if (seen.has(c.name)) continue;
            const item = mapChild(c);
            seen.set(c.name, item);
            items.push(item);
            if (isExtra) extraFound++;
          }
          if (page.children.length) scheduleRender();
          if (page.remaining >= 0 && page.remaining < 5 && page.reset > 0) {
            pauseUntil = Math.max(pauseUntil, Date.now() + page.reset * 1000);
            log('Reddit rate limit almost reached, pausing ' + page.reset + ' s.');
          }
          after = page.after;
          updateText();
        } while (after && n < LISTING_CAP_PAGES + 2 && !stopLoading);
      } catch (e) {
        log('ERROR loading ' + s.where + ' (' + s.sort + (s.t ? '/' + s.t : '') + '): ' + e.message);
      } finally {
        // This listing is finished: replace its planned 10 pages with what it really took.
        plannedPages -= LISTING_CAP_PAGES - n;
        updateText();
      }
      return count >= 990 || (after && n >= LISTING_CAP_PAGES);
    }

    // Runs the given streams with limited concurrency.
    async function runStreams(streams, isExtra) {
      const queue = streams.slice();
      const results = new Map();
      async function worker() {
        while (queue.length && !stopLoading) {
          const s = queue.shift();
          results.set(s, await readStream(s, isExtra));
        }
      }
      await Promise.all(Array.from({ length: Math.min(LISTING_CONCURRENCY, queue.length) }, worker));
      return results;
    }

    // 1) The newest ~1000 comments and posts, in parallel.
    const capped = await runStreams(NEW_STREAMS, false);

    // 2) Only for the listings that hit the cap: extra sort orders to reach older items.
    const deepStreams = [];
    for (const s of NEW_STREAMS) {
      if (!capped.get(s)) continue;
      log('Your ' + s.where + ' list reached Reddit\'s ~1000-item limit' + (deep ? ' — reading extra sort orders to find older items.' : ' — older items are not listed (turn on deep scan).'));
      if (deep) for (const d of DEEP_SORTS) deepStreams.push(Object.assign({ where: s.where }, d));
    }
    if (deepStreams.length && !stopLoading) await runStreams(deepStreams, true);

    finishProgress();
    sortItems();
    renderTable();
    const comments = items.filter(i => i.kind === 't1').length;
    const msg = (stopLoading ? 'Stopped. ' : 'Done. ') + 'Loaded ' + items.length + ' items (' + comments + ' comments, ' +
      (items.length - comments) + ' posts) for u/' + identity.name + '.' +
      (extraFound ? ' ' + extraFound + ' of them were found only through extra sort orders.' : '');
    setStatus(msg);
    log(msg);
  } catch (e) {
    if (progress && !progress.finished) finishProgress();
    setStatus('Error: ' + e.message);
    log('ERROR while loading: ' + e.message);
  } finally {
    loadBtn.disabled = false;
    stopBtn.hidden = true;
  }
}

/* ---------- sorting and rendering ---------- */
const SORT_ACCESSORS = {
  kind: item => kindLabel(item),
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
    const frag = document.createDocumentFragment();
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
      badge.className = 'badge ' + kindLabel(item);
      badge.textContent = kindLabel(item);
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
      frag.appendChild(tr);
    }
    body.appendChild(frag);
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
// Pause between write requests; Reddit throttles fast edits and deletes.
const WRITE_DELAY_MS = 1000;

async function processSelected(replacementText, deleteOnEditFail) {
  processing = true;
  const selected = items.filter(i => i.selected && i.status === 'pending');
  log('Starting to process ' + selected.length + ' items. Replacement text: "' + replacementText + '"');

  try {
    await loadIdentity(); // fresh modhash
  } catch (e) {
    log('ERROR: could not verify sign-in: ' + e.message);
    setStatus('Not signed in to Reddit — nothing was deleted.');
    processing = false;
    return;
  }

  setStatus('Overwriting and deleting ' + selected.length + ' items... keep this page and the old.reddit.com tab open.');
  startProgress({ total: selected.length });
  let ok = 0, failed = 0;
  const updateText = () => {
    progress.done = ok + failed;
    progress.text = `Processed: ${ok + failed}/${selected.length} · Deleted: ${ok} · Errors: ${failed}`;
  };
  updateText();

  for (const item of selected) {
    item.status = 'processing';
    scheduleRender();
    try {
      let note = '';
      if (item.editable && !item.archived) {
        try {
          await exec(bridgeTabId, __rc_post, ['/api/editusertext', { api_type: 'json', thing_id: item.fullname, text: replacementText }, identity.modhash]);
        } catch (e) {
          if (!deleteOnEditFail) throw new Error('overwrite failed, not deleted: ' + e.message);
          note = ' (overwrite failed: ' + e.message + ' — deleted without overwriting)';
        }
        await sleep(WRITE_DELAY_MS);
      } else if (item.editable) {
        note = ' (archived, cannot be edited — deleted without overwriting)';
      }
      await exec(bridgeTabId, __rc_post, ['/api/del', { id: item.fullname }, identity.modhash]);
      item.status = 'done';
      ok++;
      log('OK: ' + kindLabel(item) + ' in r/' + item.subreddit + ' (' + formatDateTime(item.created) + ') deleted' + note + '.');
    } catch (e) {
      item.status = 'error';
      failed++;
      log('ERROR (' + item.fullname + '): ' + e.message);
    }
    item.selected = false;
    updateText();
    scheduleRender();
    await sleep(WRITE_DELAY_MS);
  }

  finishProgress();
  processing = false;
  sortItems();
  renderTable();
  const msg = 'Processing finished: ' + ok + ' deleted, ' + failed + ' errors.';
  log(msg);
  setStatus(msg);
}

/* ---------- UI events ---------- */
document.getElementById('loadBtn').addEventListener('click', loadAll);
document.getElementById('stopLoadBtn').addEventListener('click', () => {
  stopLoading = true;
  setStatus('Stopping...');
});

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
  const deleteOnEditFail = document.getElementById('deleteOnEditFailInput').checked;
  document.getElementById('deleteBtn').disabled = true;
  await processSelected(replacementText, deleteOnEditFail);
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
document.getElementById('cancelLoginBtn').addEventListener('click', () => cancelPendingLogin('Waiting for sign-in cancelled.'));

// Check right after opening whether a Reddit session is active, so the signed-in account
// shows in the top right without having to click "Load my posts and comments".
async function checkSessionOnStart() {
  await refreshAccountUI();
  document.getElementById('identityBtn').textContent = 'Checking sign-in... ▾';
  setStatus('Checking Reddit sign-in...');
  try {
    await loadIdentity();
    setStatus('Signed in as u/' + identity.name + '.');
  } catch (e) {
    identity = null;
    loggedOut = true;
    setStatus('You are not signed in to Reddit — sign in using the button in the top right.');
    log('Sign-in check: ' + e.message);
  }
  await refreshAccountUI();
}

renderTable();
checkSessionOnStart();
