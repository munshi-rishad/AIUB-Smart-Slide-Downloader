importScripts('lib.js', 'teams.js', 'zip.js');   // shared helpers (AIUB) + SharePoint/Teams client (Teams)

const clean = s => s.replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
const hasExt = n => /\.[A-Za-z0-9]{1,6}$/.test(n);
const cleanPath = p => String(p).split('/').map(clean).filter(Boolean).join('/');   // "Course/Lab/Week 1"
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asList = v => (Array.isArray(v) ? v : v == null ? [] : [v]);   // PowerShell sends a list of one as a single value
const asMap = m => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, asList(v).map(String)]));

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ======================================================================
   Developer convenience: when the extension's own files change (Setup.bat copied a new version,
   or you edited them), reload by itself - no trip to chrome://extensions, never two copies.
   Waits until the copy has finished and no download is running. Off: CFG.DEV_AUTORELOAD = false.
   ====================================================================== */
const WATCH = ['manifest.json', 'lib.js', 'teams.js', 'zip.js', 'background.js', 'panel.js', 'site-learner.js', 'changes.json'];
async function signature() {
  let h = 2166136261;
  for (const f of WATCH) {
    let t = ''; try { t = await (await fetch(chrome.runtime.getURL(f), { cache: 'no-store' })).text(); } catch (e) {}   // a missing file must not stop the check
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= 0xff;
  }
  return String(h >>> 0);
}
async function devCheck() {
  if (!AIUB.CFG.DEV_AUTORELOAD) return;
  try {
    const sig = await signature();
    const { devSig } = await chrome.storage.local.get('devSig');
    if (!devSig) { await chrome.storage.local.set({ devSig: sig }); return; }
    if (devSig === sig) return;
    await sleep(3000);                                   // files may still be copying
    if ((await signature()) !== sig || busyNow()) return;   // not stable yet / busy: try again next time
    await chrome.storage.local.set({ devSig: sig });
    chrome.runtime.reload();
  } catch (e) {}
}
chrome.alarms.create('aiub-dev', { periodInMinutes: 0.5 });
chrome.alarms.create('aiub-update', { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'aiub-dev') devCheck(); if (a.name === 'aiub-update') checkUpdate(); });
chrome.runtime.onStartup.addListener(() => { devCheck(); checkUpdate(); });
chrome.runtime.onInstalled.addListener(() => { devCheck(); checkUpdate(); });

/* ======================================================================
   Updates from GitHub (CFG.UPDATE_REPO). Every 30 minutes (and on every run) the version number in
   extension/manifest.json on GitHub is compared with the installed one. A higher version is NOT installed
   by itself (CFG.ASK_BEFORE_UPDATE): the person is asked in the panel and with a Windows notification
   ("Update now" / "Later"). After "Update now" it is installed as soon as no download is running:
   the extension downloads the repository zip itself, the helper stores the files in a staging folder and
   swaps them in all at once (with a rollback if anything fails), and the extension reloads.
   What's new: extension/changes.json on GitHub, { "11.0": ["line", "line"] }.
   ====================================================================== */
const UPD_EVERY = 30 * 60000, UPD_RETRY = 6 * 3600000, SNOOZE = 24 * 3600000;
let updPending = null, applying = false;
const busyNow = () => active || pend.size || (runLock && Date.now() - runLock.t < 15 * 60000);
const store = chrome.storage.local;
async function remoteNotes(v) {   // what's new in every version after the installed one, up to v
  try {
    const C = AIUB.CFG, r = await fetch(`https://raw.githubusercontent.com/${C.UPDATE_REPO}/${C.UPDATE_BRANCH}/extension/changes.json`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const all = await r.json(), cur = chrome.runtime.getManifest().version;
    return Object.keys(all).filter(k => AIUB.versionNewer(k, cur) && !AIUB.versionNewer(k, v)).sort((a, b) => (AIUB.versionNewer(a, b) ? -1 : 1))
      .map(k => ({ v: k, items: (Array.isArray(all[k]) ? all[k] : [all[k]]).map(x => String(x).slice(0, 200)).slice(0, 8) })).slice(0, 5);
  } catch (e) { return []; }
}
async function checkUpdate(every) {   // every: minimum time between two checks (30 min in the background, 2 min when the dashboard opens)
  const C = AIUB.CFG; if (!C.AUTO_UPDATE) return;
  try {
    const { updChecked = 0 } = await store.get('updChecked');
    if (Date.now() - updChecked >= (every || UPD_EVERY)) {
      const r = await fetch(`https://raw.githubusercontent.com/${C.UPDATE_REPO}/${C.UPDATE_BRANCH}/extension/manifest.json`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const v = String((await r.json()).version || '');
        updPending = AIUB.versionNewer(v, chrome.runtime.getManifest().version) ? v : null;
        const { updAvail = '' } = await store.get('updAvail');
        const set = { updChecked: Date.now(), updAvail: updPending || '' };
        if (updPending && updPending !== updAvail) { set.updNotes = await remoteNotes(updPending); set.updErr = ''; }
        if (!updPending) Object.assign(set, { updNotes: [], updApproved: '', updErr: '' });
        await store.set(set);
        if (updPending && updPending !== updAvail) notifyUpdate(updPending, set.updNotes);
      }
    }
  } catch (e) {}
  await showBadge();
  return maybeApply();
}
async function showBadge() {
  try {
    const { updAvail } = await store.get('updAvail');
    await chrome.action.setBadgeText({ text: updAvail ? 'NEW' : '' });
    if (updAvail) { await chrome.action.setBadgeBackgroundColor({ color: '#1767c7' }); await chrome.action.setTitle({ title: `New version v${updAvail} is available: open the AIUB portal dashboard to update` }); }
  } catch (e) {}
}
function notifyUpdate(v, notes) {
  if (!AIUB.CFG.ASK_BEFORE_UPDATE || !chrome.notifications) return;
  const lines = (notes || []).flatMap(n => n.items).slice(0, 3).join(' · ');
  try {
    chrome.notifications.create('aiub-update', {
      type: 'basic', iconUrl: 'icon128.png', priority: 1,
      title: `AIUB Smart Slide Downloader v${v} is available`,
      message: (lines || 'A new version is ready.') + ' Do you want to update?',
      buttons: [{ title: 'Update now' }, { title: 'Later' }]
    });
  } catch (e) {}
}
async function approveUpdate() {
  const { updAvail } = await store.get('updAvail');
  if (!updAvail) return { ok: false, err: 'no new version' };
  updPending = updAvail;
  await store.set({ updApproved: updAvail, updErr: '', updTried: null });
  maybeApply();
  return { ok: true };
}
async function snoozeUpdate() {
  const { updAvail } = await store.get('updAvail');
  if (updAvail) await store.set({ updSnooze: { v: updAvail, until: Date.now() + SNOOZE } });
  return { ok: true };
}
if (chrome.notifications) {
  chrome.notifications.onButtonClicked.addListener((id, b) => { if (id !== 'aiub-update') return; chrome.notifications.clear(id); b === 0 ? approveUpdate() : snoozeUpdate(); });
  chrome.notifications.onClicked.addListener(id => { if (id !== 'aiub-update') return; chrome.notifications.clear(id); openDashboard(); });
}
async function installUpdate() {
  const C = AIUB.CFG, url = `https://github.com/${C.UPDATE_REPO}/archive/refs/heads/${C.UPDATE_BRANCH}.zip`;
  Zip.clearCache();
  const all = await Zip.list(url);
  const man = all.find(e => /^[^/]+\/(?:[^/]+\/)?extension\/manifest\.json$/.test(e.path));   // repo root, or one folder deeper
  if (!man) throw new Error('the download is not this extension');
  const pre = man.path.slice(0, -'manifest.json'.length);
  const files = all.filter(e => e.path.startsWith(pre) && /^[A-Za-z0-9._-]+\.(js|json|png|html|css)$/.test(e.path.slice(pre.length)));
  if (!files.some(e => e.base === 'background.js')) throw new Error('the download is not this extension');
  const readAll = async e => { const rd = await Zip.open(url, e), parts = []; for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); } return parts; };
  const text = async e => new TextDecoder().decode(await new Blob(await readAll(e)).arrayBuffer());
  const nm = JSON.parse(await text(man));
  if (!nm.key || nm.key !== chrome.runtime.getManifest().key) throw new Error('the download is not this extension (different key)');
  try { await call('xstart', {}); }
  catch (e) { throw new Error(/unknown op/i.test(e.message) ? 'the helper is too old' : e.message); }
  for (const e of files) {   // 1. every file goes to a staging folder first (the running extension is not touched yet)
    const parts = await readAll(e), fid = ++fidc;
    try {
      await call('xstage', { fid, name: e.base });
      for (const p of parts) for (let i = 0; i < p.length; i += CHUNK) await call('chunk', { fid }, b64(p.subarray(i, i + CHUNK)));
      await call('end', { fid });
    } catch (err) { try { await call('abort', { fid }); } catch (_) {} throw err; }
  }
  await call('xcommit', { names: files.map(e => e.base) });   // 2. all files are swapped in at once; files the new version no longer has are removed
  Zip.clearCache();
}
async function maybeApply() {
  if (applying || busyNow()) return;
  const { updAvail, updApproved, updTried } = await store.get(['updAvail', 'updApproved', 'updTried']);
  updPending = updPending || updAvail || null;
  if (!updPending || !AIUB.versionNewer(updPending, chrome.runtime.getManifest().version)) return;
  if (AIUB.CFG.ASK_BEFORE_UPDATE && updApproved !== updPending) return;   // waiting for "Update now"
  if (updTried && updTried.v === updPending && Date.now() - updTried.t < UPD_RETRY) return;   // failed a moment ago: do not hammer
  applying = true;
  try {
    await store.set({ updTried: { v: updPending, t: Date.now() } });
    await installUpdate();
    const { updNotes = [] } = await store.get('updNotes');
    await store.set({ updDone: { from: chrome.runtime.getManifest().version, to: updPending, notes: updNotes, t: Date.now() }, updErr: '' });
    for (let i = 0; i < 120 && busyNow(); i++) await sleep(5000);
    chrome.runtime.reload();
  } catch (e) { try { await store.set({ updErr: String(e.message || e).slice(0, 200) }); } catch (_) {} }
  applying = false;
}
// the new version has started: tell the panel, so it shows "Updated to vX" and brings the saved files up to date
chrome.runtime.onInstalled.addListener(async d => {
  try {
    const now = chrome.runtime.getManifest().version;
    if (d.reason === 'update' && d.previousVersion && d.previousVersion !== now) {
      const { updDone } = await store.get('updDone');
      await store.set({ justUpdated: { from: d.previousVersion, to: now, notes: (updDone && updDone.to === now && updDone.notes) || [], t: Date.now() } });
    }
    const { updAvail } = await store.get('updAvail');
    if (updAvail && !AIUB.versionNewer(updAvail, now)) await store.set({ updAvail: '', updApproved: '', updNotes: [], updErr: '', updTried: null, updDone: null });
  } catch (e) {}
  showBadge();
});

// after the extension was installed or updated, refresh the open dashboard so the new version starts by itself
const DASH_URL = /portal\.aiub\.edu\/Student(\/Home(\/Index(\/\d+)?)?)?\/?(\?|#|$)/i;
chrome.runtime.onInstalled.addListener(async () => {
  try { for (const t of await chrome.tabs.query({ url: 'https://portal.aiub.edu/*' })) if (DASH_URL.test(t.url || '')) chrome.tabs.reload(t.id); } catch (e) {}
});

async function openDashboard() {   // the course list (and the panel) lives on the portal dashboard
  try {
    const dash = (await chrome.tabs.query({ url: 'https://portal.aiub.edu/*' })).find(t => DASH_URL.test(t.url || ''));
    if (dash) { await chrome.tabs.update(dash.id, { active: true }); await chrome.windows.update(dash.windowId, { focused: true }); await chrome.tabs.reload(dash.id); }
    else await chrome.tabs.create({ url: 'https://portal.aiub.edu/Student' });
  } catch (e) {}
}
// Icon click -> manual re-check in the current tab (auto mode is the content script from manifest.json)
chrome.action.onClicked.addListener(async tab => {
  if (!/^https:\/\/portal\.aiub\.edu\//i.test(tab.url || '')) { await openDashboard(); return; }   // e.g. clicked on Teams
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.__aiubManual = true; } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib.js', 'panel.js'] });
  } catch (e) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#d33' });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 3000);
  }
});

/* ======================================================================
   Mode A (main): save into Desktop/AIUB/<Course>/ through the Windows helper.
   One helper process is shared by every file of a run (fast, no re-spawning).
   ====================================================================== */
const HOST = 'com.aiub.downloader';
const CHUNK = 1024 * 1024;   // big pieces + several in flight: the helper is never waiting for the network
const TYPES = { 'application/pdf': '.pdf', 'application/zip': '.zip', 'application/x-zip-compressed': '.zip', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx', 'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx', 'text/plain': '.txt' };

let port = null, rid = 0, fidc = 0, active = 0, idleT = null;
const pend = new Map();

function getPort() {
  if (port) return port;
  const p = chrome.runtime.connectNative(HOST);
  p.onMessage.addListener(m => {
    const q = pend.get(m.id); if (!q) return;
    pend.delete(m.id);
    m.ok ? q.res(m) : q.rej(new Error(m.err || 'helper error'));
  });
  p.onDisconnect.addListener(() => {
    const e = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'helper closed';
    if (port === p) port = null;
    for (const q of pend.values()) q.rej(new Error(e));
    pend.clear();
  });
  return (port = p);
}
function armIdle() {   // close the helper 8s after the last activity
  clearTimeout(idleT);
  idleT = setTimeout(() => { if (!active && !pend.size && port) { try { port.disconnect(); } catch (e) {} port = null; } else armIdle(); }, 8000);
}
function call(op, fields, data) {
  return new Promise((res, rej) => {
    let p; try { p = getPort(); } catch (e) { return rej(e); }
    const id = ++rid; const to = setTimeout(() => { if (pend.delete(id)) rej(new Error('helper timeout: no answer for 120 seconds')); }, 120000);
    pend.set(id, { res: v => { clearTimeout(to); res(v); }, rej: e => { clearTimeout(to); rej(e); } });
    const msg = { id, op, ...fields }; if (data !== undefined) msg.data = data;   // data last: the helper has a fast path for chunks
    try { p.postMessage(msg); } catch (e) { pend.delete(id); clearTimeout(to); return rej(e); }
    armIdle();
  });
}
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function nameFromHeaders(h) {
  const cd = h.get('content-disposition') || '';
  let m = cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i);
  if (m) { try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch (e) {} }
  m = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
  return m ? m[1].trim() : '';
}

// Which files does each course folder already contain? One round-trip for all courses.
async function listAll(folders) {
  try {
    const r = await call('listall', { folders });
    return { ok: true, map: asMap(r.map), ver: r.ver || 1 };
  } catch (e) {
    if (/unknown op/i.test(e.message)) {   // older helper: ask folder by folder
      try { const map = {}; for (const f of folders) map[f] = asList((await call('list', { folder: f })).names); return { ok: true, map }; }
      catch (e2) { return { ok: false, err: e2.message }; }
    }
    return { ok: false, err: e.message };
  }
}

// rename / move saved files (also into other folders): [{ f: 'Course/Old.pdf', t: 'Course/Sub/New.pdf' }] -> { ok, done: [indexes that moved] }
async function moveFiles(pairs) {
  try { const r = await call('moveall', { pairs: pairs.map(p => ({ f: cleanPath(p.f), t: cleanPath(p.t) })), prune: true }); return { ok: true, done: asList(r.done).map(Number) }; }
  catch (e) { return { ok: false, err: e.message, done: [] }; }
}
// list folders WITHOUT creating them (folders an older version used)
async function listFolders(folders) {
  try { const r = await call('listx', { folders: folders.map(cleanPath) }); return { ok: true, map: asMap(r.map) }; }
  catch (e) { return { ok: false, err: e.message }; }
}

async function saveNativeOnce({ url, folder, name, zip }) {
  folder = cleanPath(folder); name = clean(name) || 'file';
  const fid = ++fidc; active++;
  let stall;
  try {
    touchLock();
    const ac = new AbortController();
    const watch = () => { clearTimeout(stall); stall = setTimeout(() => ac.abort(), 60000); };   // the NETWORK sent nothing for 60 s = stuck connection
    const unwatch = () => clearTimeout(stall);   // waiting for the helper is not a network stall
    watch();
    let reader;
    if (zip) reader = await Zip.open(url, zip);   // one file taken out of a zip (only its own bytes are downloaded)
    else {
      const r = await fetch(url, { credentials: 'include', signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!hasExt(name)) {
        const hn = clean(nameFromHeaders(r.headers));
        let ext = (hn.match(/\.[A-Za-z0-9]{1,6}$/) || [''])[0] || TYPES[ct] || '';
        name += AIUB.CFG.UPPERCASE ? ext.toUpperCase() : ext;
      }
      if (ct === 'text/html' && !/\.html?$/i.test(name)) throw new Error('got a web page, not a file (please log in again)');
      reader = r.body.getReader();
      unwatch();
    }
    await call('begin', { fid, folder, name });
    unwatch();
    // gather the network's small pieces into 1 MB pieces and keep 4 of them in flight (no waiting for every answer)
    let buf = [], bl = 0; const fly = [];
    const send = async () => {
      const take = Math.min(bl, CHUNK), out = new Uint8Array(take); let o = 0;
      while (o < take) { const a = buf[0], need = take - o; if (a.length <= need) { out.set(a, o); o += a.length; buf.shift(); } else { out.set(a.subarray(0, need), o); buf[0] = a.subarray(need); o += need; } }
      bl -= take;
      const pr = call('chunk', { fid }, b64(out)); pr.catch(() => {}); fly.push(pr);
      if (fly.length >= 4) await Promise.all(fly.splice(0));
    };
    for (;;) {
      watch();
      const { done, value } = await reader.read();
      unwatch();
      if (done) break;
      buf.push(value); bl += value.length;
      while (bl >= CHUNK) await send();
    }
    while (bl > 0) await send();
    await Promise.all(fly.splice(0));
    clearTimeout(stall);
    await call('end', { fid });
    return { status: 'done' };
  } catch (e) {
    try { await call('abort', { fid }); } catch (_) {}
    return { status: 'fail', err: /abort/i.test(e.message) ? 'timeout: no data for 60 seconds' : e.message };
  } finally { clearTimeout(stall); active--; armIdle(); }
}

// a dropped connection is retried twice (the internet often comes back within seconds)
// one run at a time: two portal tabs writing the same file would corrupt it
let runLock = null;   // { tab, t }
const touchLock = () => { if (runLock) runLock.t = Date.now(); };
chrome.tabs.onRemoved.addListener(id => { if (runLock && runLock.tab === id) runLock = null; });

const RETRYABLE = /failed to fetch|network|timeout|interrupted|helper closed|terminated|aborted|load failed|HTTP (408|429|5\d\d)/i;
async function saveNative(job) {
  let r;
  for (let i = 0; i < 3; i++) {
    r = await saveNativeOnce(job);
    if (r.status === 'done' || !RETRYABLE.test(r.err || '')) return r;
    await sleep(i ? 5000 : 1500);
  }
  return r;
}

/* ======================================================================
   Mode B (fallback, no helper): Chrome Downloads folder / AIUB / <Course>
   ====================================================================== */
const pending = new Map();   // url -> {path, name}
const waiters = new Map();   // downloadId -> resolve

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const job = pending.get(item.url) || pending.get(item.finalUrl);
  if (!job) return;
  const base = (item.filename || '').split(/[\\/]/).pop();
  const ext = (base.match(/\.[A-Za-z0-9]{1,6}$/) || [''])[0];
  let path = job.path;
  if (!hasExt(job.name) && ext) path += ext;
  suggest({ filename: path, conflictAction: 'overwrite' });
});
chrome.downloads.onChanged.addListener(d => {
  const res = waiters.get(d.id);
  if (!res || !d.state) return;
  if (d.state.current === 'complete') { waiters.delete(d.id); res({ status: 'done' }); }
  else if (d.state.current === 'interrupted') { waiters.delete(d.id); res({ status: 'fail', err: (d.error && d.error.current) || 'interrupted' }); }
});
async function hasFile(folder, name) {
  folder = cleanPath(folder); name = clean(name) || 'file';
  const rx = `AIUB[\\\\/]${esc(folder).replace(/\//g, '[\\\\\\\\/]')}[\\\\/]${esc(name)}(\\.\\w{1,6})?$`;
  try { return (await chrome.downloads.search({ filenameRegex: rx, state: 'complete', exists: true })).length > 0; }
  catch (e) { return false; }
}
async function handleDownload({ url, folder, name }) {
  folder = cleanPath(folder); name = clean(name) || 'file';
  if (await hasFile(folder, name)) return { status: 'skip' };
  const path = `AIUB/${folder}/${name}`;
  pending.set(url, { path, name });
  return new Promise(res => {
    chrome.downloads.download({ url, filename: path, conflictAction: 'overwrite' }, id => {
      if (id === undefined) return res({ status: 'fail', err: (chrome.runtime.lastError || {}).message });
      waiters.set(id, res);
    });
    setTimeout(() => res({ status: 'fail', err: 'timeout' }), 180000);
  });
}

/* ====================================================================== */
chrome.runtime.onMessage.addListener((m, s, reply) => {
  const answer = p => p.then(reply, e => reply({ ok: false, status: 'fail', err: String((e && e.message) || e) }));   // never leave the panel waiting
  if (m.cmd === 'lock') {
    const tab = s.tab && s.tab.id;
    if (!runLock || runLock.tab === tab || Date.now() - runLock.t > 15 * 60000) { runLock = { tab, t: Date.now() }; reply({ ok: true }); }
    else reply({ ok: false, busy: true });
    return false;
  }
  if (m.cmd === 'unlock') { if (runLock && runLock.tab === (s.tab && s.tab.id)) { runLock = null; Zip.clearCache(); setTimeout(maybeApply, 1500); } return false; }
  if (m.cmd === 'checkUpdate') { answer(checkUpdate(2 * 60000).then(() => ({ ok: true }))); return true; }
  if (m.cmd === 'updateNow') { answer(approveUpdate()); return true; }
  if (m.cmd === 'updateLater') { answer(snoozeUpdate()); return true; }
  if (m.cmd === 'zipList') { answer(Zip.list(m.url).then(entries => ({ ok: true, entries }))); return true; }
  if (m.cmd === 'listall') { answer(listAll(m.folders || [])); return true; }
  if (m.cmd === 'move') { answer(moveFiles(m.pairs || [])); return true; }
  if (m.cmd === 'listx') { answer(listFolders(m.folders || [])); return true; }
  if (m.cmd === 'teams') { answer(Teams.fetchForCourses(m)); return true; }
  if (m.cmd === 'learnSite') { Teams.learnSite(m.url); return false; }
  if (m.cmd === 'save') { answer(saveNative(m)); return true; }
  if (m.cmd === 'dl') { answer(handleDownload(m)); return true; }
  if (m.cmd === 'has') { answer(hasFile(m.folder, m.name).then(have => ({ have }))); return true; }
});
