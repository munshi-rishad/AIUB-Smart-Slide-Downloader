const clean = s => s.replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
const hasExt = n => /\.[A-Za-z0-9]{1,6}$/.test(n);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Icon click -> manual re-check in the current tab (auto mode is the content script from manifest.json)
chrome.action.onClicked.addListener(async tab => {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.__aiubManual = true; } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['panel.js'] });
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
const CHUNK = 512 * 1024;
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
    const id = ++rid; pend.set(id, { res, rej });
    const msg = { id, op, ...fields }; if (data !== undefined) msg.data = data;   // data last: the helper has a fast path for chunks
    try { p.postMessage(msg); } catch (e) { pend.delete(id); return rej(e); }
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
    return { ok: true, map: r.map || {} };
  } catch (e) {
    if (/unknown op/i.test(e.message)) {   // older helper: ask folder by folder
      try { const map = {}; for (const f of folders) map[f] = (await call('list', { folder: f })).names || []; return { ok: true, map }; }
      catch (e2) { return { ok: false, err: e2.message }; }
    }
    return { ok: false, err: e.message };
  }
}

async function saveNative({ url, folder, name }) {
  folder = clean(folder); name = clean(name) || 'file';
  const fid = ++fidc; active++;
  try {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!hasExt(name)) {
      const hn = clean(nameFromHeaders(r.headers));
      name += (hn.match(/\.[A-Za-z0-9]{1,6}$/) || [''])[0] || TYPES[ct] || '';
    }
    if (ct === 'text/html' && !/\.html?$/i.test(name)) throw new Error('got a web page, not a file (please log in again)');
    await call('begin', { fid, folder, name });
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let i = 0; i < value.length; i += CHUNK) await call('chunk', { fid }, b64(value.subarray(i, i + CHUNK)));
    }
    await call('end', { fid });
    return { status: 'done' };
  } catch (e) {
    try { await call('abort', { fid }); } catch (_) {}
    return { status: 'fail', err: e.message };
  } finally { active--; armIdle(); }
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
  folder = clean(folder); name = clean(name) || 'file';
  const rx = `AIUB[\\\\/]${esc(folder)}[\\\\/]${esc(name)}(\\.\\w{1,6})?$`;
  try { return (await chrome.downloads.search({ filenameRegex: rx, state: 'complete', exists: true })).length > 0; }
  catch (e) { return false; }
}
async function handleDownload({ url, folder, name }) {
  folder = clean(folder); name = clean(name) || 'file';
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
  if (m.cmd === 'listall') { listAll(m.folders || []).then(reply); return true; }
  if (m.cmd === 'save') { saveNative(m).then(reply); return true; }
  if (m.cmd === 'dl') { handleDownload(m).then(reply); return true; }
  if (m.cmd === 'has') { hasFile(m.folder, m.name).then(have => reply({ have })); return true; }
});
