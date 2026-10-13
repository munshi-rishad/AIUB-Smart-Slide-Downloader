const pending = new Map();   // url -> {path}
const waiters = new Map();   // downloadId -> resolve
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = s => s.replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');

// Icon click -> manual re-check (runs the panel in the current tab, no new tabs).
// Auto mode (on every dashboard load after login) is handled by the content script in manifest.json.
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

// Force file into Downloads/AIUB/<Course>/<file>, keep server extension if title has none
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const job = pending.get(item.url) || pending.get(item.finalUrl);
  if (!job) return;
  const base = (item.filename || '').split(/[\\/]/).pop();
  const ext = (base.match(/\.[A-Za-z0-9]{1,6}$/) || [''])[0];
  let path = job.path;
  if (!/\.[A-Za-z0-9]{1,6}$/.test(job.name) && ext) path += ext;
  suggest({ filename: path, conflictAction: 'overwrite' });
});

chrome.downloads.onChanged.addListener(async d => {
  const res = waiters.get(d.id);
  if (!res || !d.state) return;
  if (d.state.current === 'complete') { waiters.delete(d.id); res({ status: 'done' }); }
  else if (d.state.current === 'interrupted') { waiters.delete(d.id); res({ status: 'fail', err: (d.error && d.error.current) || 'interrupted' }); }
});

// Fallback mode only (no Desktop folder chosen): is this file already in Downloads/AIUB/<Course>/ ?
async function hasFile(folder, name) {
  folder = clean(folder); name = clean(name) || 'file';
  const rx = `AIUB[\\\\/]${esc(folder)}[\\\\/]${esc(name)}(\\.\\w{1,6})?$`;
  try {
    const have = await chrome.downloads.search({ filenameRegex: rx, state: 'complete', exists: true });
    return have.length > 0;
  } catch (e) { return false; }
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

chrome.runtime.onMessage.addListener((m, s, send) => {
  if (m.cmd === 'dl') { handleDownload(m).then(send); return true; }
  if (m.cmd === 'has') { hasFile(m.folder, m.name).then(have => send({ have })); return true; }
});

// ---------------- Desktop/AIUB via the native helper ----------------
const HOST = 'com.aiub.downloader';
let rid = 0;
const CHUNK = 192 * 1024;
const TYPES = { 'application/pdf': '.pdf', 'application/zip': '.zip', 'application/x-zip-compressed': '.zip', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx', 'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx', 'text/plain': '.txt' };
const hasExt = n => /\.[A-Za-z0-9]{1,6}$/.test(n);

function nativeOnce(msg) {
  return new Promise((res, rej) => {
    chrome.runtime.sendNativeMessage(HOST, { id: ++rid, ...msg }, r => {
      const e = chrome.runtime.lastError;
      if (e) return rej(new Error(e.message));
      if (!r || !r.ok) return rej(new Error((r && r.err) || 'helper error'));
      res(r);
    });
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

async function saveNative({ url, folder, name }) {
  folder = clean(folder); name = clean(name) || 'file';
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!hasExt(name)) {
    const hn = clean(nameFromHeaders(r.headers));
    name += (hn.match(/\.[A-Za-z0-9]{1,6}$/) || [''])[0] || TYPES[ct] || '';
  }
  if (ct === 'text/html' && !/\.html?$/i.test(name)) throw new Error('got a web page, not a file (session expired?)');

  const port = chrome.runtime.connectNative(HOST);
  const pend = new Map(); let dead = null;
  port.onMessage.addListener(m => { const p = pend.get(m.id); if (!p) return; pend.delete(m.id); m.ok ? p.res(m) : p.rej(new Error(m.err || 'helper error')); });
  port.onDisconnect.addListener(() => {
    dead = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'helper closed';
    for (const p of pend.values()) p.rej(new Error(dead)); pend.clear();
  });
  const send = m => new Promise((res, rej) => { if (dead) return rej(new Error(dead)); m.id = ++rid; pend.set(m.id, { res, rej }); port.postMessage(m); });
  try {
    await send({ op: 'begin', folder, name });
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let i = 0; i < value.length; i += CHUNK) await send({ op: 'chunk', data: b64(value.subarray(i, i + CHUNK)) });
    }
    await send({ op: 'end' });
    return { status: 'done' };
  } catch (e) {
    try { await send({ op: 'abort' }); } catch (_) {}
    return { status: 'fail', err: e.message };
  } finally { try { port.disconnect(); } catch (_) {} }
}

chrome.runtime.onMessage.addListener((m, s, send) => {
  if (m.cmd === 'ping') { nativeOnce({ op: 'ping' }).then(r => send({ ok: true, path: r.path }), e => send({ ok: false, err: e.message })); return true; }
  if (m.cmd === 'list') { nativeOnce({ op: 'list', folder: clean(m.folder) }).then(r => send({ ok: true, names: r.names || [] }), e => send({ ok: false, err: e.message })); return true; }
  if (m.cmd === 'save') { saveNative(m).then(send).catch(e => send({ status: 'fail', err: e.message })); return true; }
});
