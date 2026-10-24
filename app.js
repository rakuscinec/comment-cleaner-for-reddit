'use strict';

/* ---------- stav ---------- */
let bridgeTabId = null;
let identity = null;      // { name, modhash }
let items = [];           // zoznam postov/komentárov
let sortKey = 'created';
let sortDesc = true;
let processing = false;

/* ---------- pomocné ---------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function pad2(n) { return String(n).padStart(2, '0'); }

// Český formát: d.m.rrrr HH:MM:SS
function formatDateTime(ts) {
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
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

/* ---------- správa účtov cez cookies ---------- */
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

  setStatus('Prepínam na účet u/' + username + '...');
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
    log('Prepnuté na účet u/' + identity.name + '.');
    setStatus('Aktívny účet: u/' + identity.name);
  } catch (e) {
    log('CHYBA pri prepnutí na u/' + username + ': ' + e.message);
    setStatus('Chyba pri prepnutí účtu: ' + e.message);
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
  setStatus(reason || 'Čakanie na prihlásenie zrušené.');
}

async function addAccount() {
  if (pendingLoginTabId) return;

  setAddAccountUIWaiting(true);
  setStatus('Odhlasujem aktuálny účet na Reddite, aby šlo prihlásiť nový...');
  // Bez vyčistenia cookies by Reddit na /login presmeroval späť na už prihláseného používateľa.
  await clearRedditCookies();
  identity = null;
  bridgeTabId = null;
  await refreshAccountUI();

  // Kontrolu identity robíme cez samostatnú old.reddit.com kartu (bridge), nie cez prihlasovaciu
  // kartu na www.reddit.com — tá má iný tvar API a /api/me.json na nej nemusí fungovať rovnako.
  await ensureBridgeTab();

  const tab = await chrome.tabs.create({ url: 'https://www.reddit.com/login', active: true });
  pendingLoginTabId = tab.id;
  log('Otvorená karta na prihlásenie na Reddit (tab ' + tab.id + '). Prihlás sa PRESNE v nej — účet sa zachytí automaticky.');
  setStatus('Čakám, kým sa prihlásiš v novootvorenej karte... (pokus 0)');

  let attempts = 0;
  const maxAttempts = 150; // ~5 min pri intervale 2 s

  pendingLoginPoll = setInterval(async () => {
    attempts++;
    const stillOpen = await chrome.tabs.get(pendingLoginTabId).catch(() => null);
    if (!stillOpen) {
      cancelPendingLogin('Karta na prihlásenie bola zatvorená, zrušené.');
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
      log('Uložený nový účet: u/' + id.name);
      setStatus('Účet u/' + id.name + ' uložený a aktivovaný.');
      await refreshAccountUI();
    } catch (e) {
      if (attempts >= maxAttempts) {
        cancelPendingLogin('Vypršal čas na prihlásenie (5 min). Naposledy: ' + e.message);
        log('Prihlásenie sa nepodarilo zachytiť do 5 minút. Posledná chyba: ' + e.message);
        return;
      }
      setStatus('Čakám na prihlásenie v novej karte... (pokus ' + attempts + '/' + maxAttempts + ', zatiaľ neprihlásený)');
      if (attempts % 5 === 0) {
        log('Stále čakám na prihlásenie (pokus ' + attempts + '). Dôvod: ' + e.message);
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
    empty.textContent = 'Zatiaľ žiadny uložený účet.';
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

  document.getElementById('identityBtn').textContent = (currentName ? 'u/' + currentName : 'Neprihlásený') + ' ▾';
}

/* ---------- funkcie spúšťané v kontexte reddit tabu ---------- */
async function __rc_getIdentity() {
  const res = await fetch('/api/me.json', { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!data || !data.data || !data.data.name) {
    throw new Error('Nie si prihlásený na Reddite (v tabe old.reddit.com).');
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

/* ---------- načítanie obsahu ---------- */
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
    setStatus('Pripájam sa na Reddit (old.reddit.com)...');
    await ensureBridgeTab();
    identity = await exec(bridgeTabId, __rc_getIdentity);
    await refreshAccountUI();
    setStatus('Načítavam obsah...');

    items = [];
    let after = null;
    let guard = 0;
    do {
      const page = await exec(bridgeTabId, __rc_fetchPage, [identity.name, after]);
      for (const child of page.children) items.push(mapChild(child));
      after = page.after;
      setStatus('Načítaných položiek: ' + items.length);
      guard++;
      if (after) await sleep(700);
    } while (after && guard < 200);

    sortItems();
    renderTable();
    document.getElementById('filterRow').hidden = false;
    document.getElementById('replaceRow').hidden = false;
    document.getElementById('actionRow').hidden = false;
    setStatus('Hotovo. Načítaných ' + items.length + ' položiek.');
    log('Načítaných ' + items.length + ' postov a komentárov pre u/' + identity.name + '.');
  } catch (e) {
    setStatus('Chyba: ' + e.message);
    log('CHYBA pri načítaní: ' + e.message);
  } finally {
    loadBtn.disabled = false;
  }
}

/* ---------- triedenie a render ---------- */
const SORT_ACCESSORS = {
  kind: item => item.kind === 't1' ? 'komentár' : 'post',
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
      badge.textContent = item.kind === 't1' ? 'komentár' : 'post';
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
      snippetLink.textContent = item.snippet || '(bez textu)';
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
    case 'pending': return 'čaká';
    case 'processing': return 'spracúva sa...';
    case 'done': return 'zmazané';
    case 'error': return 'chyba';
    case 'skipped': return 'preskočené';
    default: return s;
  }
}

function updateSelectedCount() {
  const n = items.filter(i => i.selected && i.status === 'pending').length;
  document.getElementById('selectedCount').textContent = 'Vybraných: ' + n;
  document.getElementById('deleteBtn').disabled = n === 0 || processing;
}

/* ---------- výberové nástroje ---------- */
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

/* ---------- prepis + zmazanie ---------- */
async function processSelected(replacementText) {
  processing = true;
  const selected = items.filter(i => i.selected && i.status === 'pending');
  log('Spúšťam spracovanie ' + selected.length + ' položiek. Text na prepis: "' + replacementText + '"');

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
      log('OK: ' + (item.kind === 't1' ? 'komentár' : 'post') + ' v r/' + item.subreddit + ' (' + formatDateTime(item.created) + ') zmazaný.');
    } catch (e) {
      item.status = 'error';
      log('CHYBA (' + item.fullname + '): ' + e.message);
    }
    renderTable();
    await sleep(1100);
  }

  processing = false;
  log('Spracovanie dokončené.');
  setStatus('Spracovanie dokončené.');
}

/* ---------- UI eventy ---------- */
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

/* potvrdzovací modál */
const modal = document.getElementById('confirmModal');
const confirmOk = document.getElementById('confirmOk');

document.getElementById('deleteBtn').addEventListener('click', () => {
  const n = items.filter(i => i.selected && i.status === 'pending').length;
  if (!n) return;
  document.getElementById('confirmText').textContent = `Naozaj chceš prepísať a natrvalo zmazať ${n} položiek?`;
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
document.getElementById('cancelLoginBtn').addEventListener('click', () => cancelPendingLogin('Čakanie na prihlásenie zrušené.'));

renderTable();
refreshAccountUI();
