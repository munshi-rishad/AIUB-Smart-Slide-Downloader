// Run:  node tests/background.test.js  -- runs extension/background.js with a fake Chrome and a fake helper
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '../extension');
const sent = [], listeners = {}, DB = {}, notes = [];
const ev = name => ({ addListener: f => { (listeners[name] = listeners[name] || []).push(f); } });
function connectNative() {
  const h = [], d = [];
  return { onMessage: { addListener: f => h.push(f) }, onDisconnect: { addListener: f => d.push(f) }, disconnect() {},
    postMessage(m) { sent.push(m); setTimeout(() => h.forEach(f => f({ id: m.id, ok: true, ver: 3, map: {}, done: (m.pairs || []).map((_, i) => i) })), 1); } };
}
function fileResponse() {
  let n = 0;
  return { ok: true, status: 200, headers: { get: k => (k === 'content-type' ? 'application/pdf' : '') },
    body: { getReader: () => ({ read: async () => (n++ < 2 ? { done: false, value: new Uint8Array(1000) } : { done: true }) }) } };
}
const ctx = { TextDecoder, Blob, DecompressionStream, console, setTimeout, clearTimeout, btoa, AbortController, AbortSignal, URL, Uint8Array, Math, Date, Map, Set, Promise, Number, String, Array, Object, Error, JSON, RegExp,
  fetch: async () => fileResponse(),
  chrome: {
    runtime: { onMessage: ev('msg'), onStartup: ev('startup'), onInstalled: ev('installed'), connectNative, getURL: f => f },
    alarms: { create() {}, onAlarm: ev('alarm') }, tabs: { onRemoved: ev('removed'), query: async () => [], create: async () => ({}), update: async () => ({}), reload: async () => {} },
    windows: { update: async () => ({}) }, action: { onClicked: ev('click'), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    storage: { local: { get: async k => { const ks = k == null ? Object.keys(DB) : [].concat(k); const o = {}; ks.forEach(x => { if (x in DB) o[x] = DB[x]; }); return o; }, set: async o => { Object.assign(DB, o); }, remove: async k => { [].concat(k).forEach(x => delete DB[x]); } } },
    notifications: { create: (id, o) => { notes.push(o); }, clear() {}, onButtonClicked: ev('nbtn'), onClicked: ev('nclick') },
    downloads: { onDeterminingFilename: ev('dname'), onChanged: ev('dchg'), search: async () => [], download() {} },
    scripting: { executeScript: async () => {} } } };
ctx.self = ctx;
ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8') + (f === 'teams.js' ? '\nthis.Teams = Teams;' : ''), ctx));
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'background.js'), 'utf8'), ctx);
const handler = listeners.msg[0];
const ask = (m, tab) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('NO REPLY for ' + m.cmd + ' (the panel would hang forever)')), 15000); handler(m, { tab: { id: tab || 1 } }, r => { clearTimeout(t); res(r); }); });
(async () => {
  let r = await ask({ cmd: 'save', url: 'https://x/f.pdf', folder: 'Course/Lab', name: '01 - a.pdf' });
  assert.strictEqual(r.status, 'done');
  const ops = sent.map(m => m.op);
  assert.strictEqual(JSON.stringify(ops), JSON.stringify(['begin', 'chunk', 'end']));
  assert.strictEqual(sent[0].folder, 'Course/Lab');
  console.log('ok  a download is saved through the helper and the panel gets its answer');
  r = await ask({ cmd: 'listall', folders: ['A'] }); assert.strictEqual(r.ok, true); assert.strictEqual(r.ver, 3);
  console.log('ok  helper version is passed on');
  sent.length = 0;
  r = await ask({ cmd: 'move', pairs: [{ f: 'Old Course/01 - A.pdf', t: 'New Course/Lab/01 - A (PORTAL).PDF' }] });
  assert.strictEqual(JSON.stringify(r.done), '[0]'); assert.strictEqual(sent[0].op, 'moveall'); assert.strictEqual(sent[0].prune, true);
  assert.strictEqual(sent[0].pairs[0].t, 'New Course/Lab/01 - A (PORTAL).PDF');
  r = await ask({ cmd: 'listx', folders: ['Old Course'] }); assert.strictEqual(r.ok, true); assert.strictEqual(sent[1].op, 'listx');
  console.log('ok  files can be moved into other folders; old folders are listed without being created');
  assert.strictEqual((await ask({ cmd: 'lock' }, 1)).ok, true);
  assert.strictEqual((await ask({ cmd: 'lock' }, 2)).busy, true);
  handler({ cmd: 'unlock' }, { tab: { id: 1 } }, () => {});
  assert.strictEqual((await ask({ cmd: 'lock' }, 2)).ok, true);
  console.log('ok  only one portal tab can run at a time');
  handler({ cmd: 'unlock' }, { tab: { id: 2 } }, () => {});
  // a real repository zip (GitHub layout: <repo>-main/extension/...) served for the download URL
  const os = require('os'), cp = require('child_process'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  fs.mkdirSync(path.join(tmp, 'R-main/extension'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'R-main/helper'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'R-main/extension/manifest.json'), JSON.stringify({ version: '10.1', key: 'K' }));
  fs.writeFileSync(path.join(tmp, 'R-main/extension/background.js'), '// new');
  fs.writeFileSync(path.join(tmp, 'R-main/helper/host.ps1'), 'x');
  cp.execFileSync('python3', ['-I', '-c', "import zipfile,sys,os\nz=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)\nfor r,_,f in os.walk(sys.argv[2]):\n  for n in f: z.write(os.path.join(r,n), os.path.relpath(os.path.join(r,n), sys.argv[3]))\nz.close()", path.join(tmp, 'r.zip'), path.join(tmp, 'R-main'), tmp]);
  const repoZip = fs.readFileSync(path.join(tmp, 'r.zip'));
  let reloaded = false; ctx.chrome.runtime.getManifest = () => ({ version: '9.9', key: 'K' }); ctx.chrome.runtime.reload = () => { reloaded = true; };
  ctx.fetch = async u => {
    u = String(u);
    if (u.includes('raw.githubusercontent.com/munshi-rishad/AIUB-Smart-Slide-Downloader/main/extension/manifest.json')) return { ok: true, json: async () => ({ version: '10.1' }) };
    if (u.includes('raw.githubusercontent.com/munshi-rishad/AIUB-Smart-Slide-Downloader/main/extension/changes.json')) return { ok: true, json: async () => ({ '10.1': ['Faster', 'Asks first'], '9.0': ['old'] }) };
    if (u.includes('github.com/munshi-rishad/AIUB-Smart-Slide-Downloader/archive/refs/heads/main.zip')) return { status: 200, ok: true, headers: { get: k => (k.toLowerCase() === 'content-length' ? String(repoZip.length) : '') }, arrayBuffer: async () => repoZip.buffer.slice(repoZip.byteOffset, repoZip.byteOffset + repoZip.length) };
    return fileResponse();
  };
  sent.length = 0; await ask({ cmd: 'checkUpdate' }); await new Promise(r => setTimeout(r, 500));
  assert.strictEqual(DB.updAvail, '10.1'); assert(!sent.some(m => /^x/.test(m.op)), 'nothing may be installed before the person says yes'); assert(!reloaded);
  assert.strictEqual(notes.length, 1); assert.strictEqual(JSON.stringify(notes[0].buttons.map(b => b.title)), JSON.stringify(['Update now', 'Later']));
  assert.strictEqual(JSON.stringify(DB.updNotes), JSON.stringify([{ v: '10.1', items: ['Faster', 'Asks first'] }]));
  console.log('ok  a newer version is found: the person is asked (notification + panel), nothing is installed yet');
  await ask({ cmd: 'updateLater' }); assert(DB.updSnooze && DB.updSnooze.v === '10.1');
  console.log('ok  "Later" hides the question for a day');
  sent.length = 0; await ask({ cmd: 'updateNow' }); await new Promise(r => setTimeout(r, 800));
  const uops = sent.map(m => m.op + (m.name ? ':' + m.name : ''));
  assert.strictEqual(uops[0], 'xstart');
  assert(uops.includes('xstage:background.js') && uops.includes('xstage:manifest.json'), 'files are staged: ' + uops);
  assert(!sent.some(m => m.name === 'host.ps1'), 'helper files must not be touched');
  const commit = sent.find(m => m.op === 'xcommit'); assert(commit, 'the update is committed in one step');
  assert.strictEqual(JSON.stringify(commit.names.slice().sort()), JSON.stringify(['background.js', 'manifest.json']));
  assert.strictEqual(sent[sent.length - 1].op, 'xcommit');
  assert(reloaded, 'the extension did not reload after the update');
  assert.strictEqual(DB.updDone.to, '10.1');
  console.log('ok  "Update now": staged, swapped in all at once (xcommit), extension reloads');
  reloaded = false; ctx.chrome.runtime.getManifest = () => ({ version: '10.1', key: 'K' });
  for (const f of listeners.installed) await f({ reason: 'update', previousVersion: '9.9' });
  assert.strictEqual(DB.justUpdated.to, '10.1'); assert.strictEqual(DB.justUpdated.from, '9.9'); assert.strictEqual(DB.updAvail, '');
  console.log('ok  after the update the panel is told (justUpdated) and the question is cleared');
  ctx.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const t0 = Date.now(); r = await ask({ cmd: 'save', url: 'https://x/g.pdf', folder: 'C', name: 'g.pdf' });
  assert.strictEqual(r.status, 'fail'); console.log('ok  a failing download still answers (after ' + Math.round((Date.now() - t0) / 1000) + ' s of retries)');
  console.log('\n9 checks passed'); process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
