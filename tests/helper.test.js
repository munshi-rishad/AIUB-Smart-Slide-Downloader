// Run on Windows only:  node tests/helper.test.js   -- talks to helper/host.ps1 exactly like Chrome does (native messaging)
// The helper always writes to Desktop\AIUB, so this test works only inside its own "zz-test-..." folder there and removes it afterwards.
const assert = require('assert'), cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
if (process.platform !== 'win32') { console.log('skipped (Windows only)'); process.exit(0); }
const repo = path.join(__dirname, '..'), ext = path.join(repo, 'extension');
const desk = cp.execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"]).toString().trim();
const root = path.join(desk, 'AIUB');
const T = 'zz-test-' + Date.now();
const p = cp.spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'helper', 'host.ps1')], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = Buffer.alloc(0), id = 0; const wait = new Map();
p.stdout.on('data', d => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) { const n = buf.readUInt32LE(0); if (buf.length < 4 + n) break; const m = JSON.parse(buf.slice(4, 4 + n).toString()); buf = buf.slice(4 + n); const w = wait.get(m.id); if (w) { wait.delete(m.id); w(m); } }
});
const call = (op, fields, data) => new Promise((res, rej) => {
  const m = { id: ++id, op, ...fields }; if (data !== undefined) m.data = data;
  const b = Buffer.from(JSON.stringify(m)); const h = Buffer.alloc(4); h.writeUInt32LE(b.length);
  const to = setTimeout(() => { wait.delete(m.id); rej(new Error('no answer from the helper for "' + op + '" within 20 s')); }, 20000);
  wait.set(m.id, v => { clearTimeout(to); res(v); }); p.stdin.write(Buffer.concat([h, b]));
});
const ci = !!process.env.GITHUB_ACTIONS;
const log = console.log; console.log = t => { log(t); if (ci && /^ok  /.test(t)) log('::notice::' + t); };
p.on('exit', c => { if (c !== null) log((ci ? '::warning::' : '') + 'helper exited with code ' + c); });
const save = async (folder, name, text) => { const fid = ++id + 1000; assert((await call('begin', { fid, folder, name })).ok); assert((await call('chunk', { fid }, Buffer.from(text).toString('base64'))).ok); assert((await call('end', { fid })).ok); };
const ex = (...a) => fs.existsSync(path.join(root, ...a));
(async () => {
  log((ci ? '::notice::' : '') + 'desktop: ' + desk);
  let r = await call('ping', {}); assert.strictEqual(r.ver, 3); console.log('ok  helper version 3');
  await save(`${T}/Old Course/Lab`, '01 - A.pdf', 'hello'); await save(`${T}/Old Course/Lab`, 'B.pdf', 'b'); await save(`${T}/New`, 'TAKEN.PDF', 'other');
  assert.strictEqual(fs.readFileSync(path.join(root, T, 'Old Course', 'Lab', '01 - A.pdf'), 'utf8'), 'hello'); console.log('ok  a file is saved (begin/chunk/end)');
  r = await call('listx', { folders: [`${T}/Does Not Exist`, `${T}/Old Course/Lab`] });
  assert.strictEqual(r.map[`${T}/Does Not Exist`].length, 0); assert(!ex(T, 'Does Not Exist'), 'listx must not create folders');
  assert.strictEqual(r.map[`${T}/Old Course/Lab`].length, 2); console.log('ok  listx lists without creating folders');
  r = await call('moveall', { prune: true, pairs: [
    { f: `${T}/Old Course/Lab/01 - A.pdf`, t: `${T}/New/Sub/01 - A (PORTAL).PDF` },   // other folder + new name
    { f: `${T}/Old Course/Lab/B.pdf`, t: `${T}/New/TAKEN.PDF` },                       // target taken by another file: must not overwrite
    { f: `${T}/../../escape.pdf`, t: `${T}/x.pdf` }] });                                 // path tricks are cleaned, nothing leaves Desktop\AIUB
  assert.strictEqual(JSON.stringify(r.done), '[0]', JSON.stringify(r));
  assert(ex(T, 'New', 'Sub', '01 - A (PORTAL).PDF')); assert.strictEqual(fs.readFileSync(path.join(root, T, 'New', 'TAKEN.PDF'), 'utf8'), 'other');
  assert(ex(T, 'Old Course', 'Lab', 'B.pdf'), 'a file that could not move stays where it was');
  console.log('ok  moveall: into another folder with a new name; never overwrites; path tricks ignored');
  r = await call('moveall', { prune: true, pairs: [{ f: `${T}/Old Course/Lab/B.pdf`, t: `${T}/New/B.PDF` }] });
  assert(!ex(T, 'Old Course'), 'empty old folders are removed'); assert(ex(T, 'New')); console.log('ok  empty old folders are removed, Desktop\\AIUB itself never');
  r = await call('moveall', { pairs: [{ f: `${T}/New/B.PDF`, t: `${T}/New/b.pdf` }] }); assert.strictEqual(JSON.stringify(r.done), '[0]');
  assert(fs.readdirSync(path.join(root, T, 'New')).includes('b.pdf')); console.log('ok  a change of capital letters only is a real rename');
  // ---- staged extension update ----
  const before = fs.readFileSync(path.join(ext, 'background.js'), 'utf8');
  fs.writeFileSync(path.join(ext, 'obsolete.js'), '// old file');
  assert((await call('xstart', {})).ok);
  const stage = async (name, text) => { const fid = ++id + 5000; assert((await call('xstage', { fid, name })).ok, name); assert((await call('chunk', { fid }, Buffer.from(text).toString('base64'))).ok); assert((await call('end', { fid })).ok); };
  r = await call('xstage', { fid: 9, name: '..\\evil.js' }); assert.strictEqual(r.ok, false);
  await stage('background.js', '// NEW'); await stage('manifest.json', '{"version":"99"}');
  r = await call('xcommit', { names: ['background.js', 'manifest.json', 'missing.js'] }); assert.strictEqual(r.ok, false); assert(/missing/.test(r.err));
  assert.strictEqual(fs.readFileSync(path.join(ext, 'background.js'), 'utf8'), before, 'nothing changes when the update is incomplete');
  console.log('ok  an incomplete update changes nothing; bad file names are refused');
  const keep = fs.readdirSync(ext).filter(n => /\.(js|json|png|html|css)$/.test(n) && !['background.js', 'manifest.json', 'obsolete.js'].includes(n));
  const saved = Object.fromEntries(fs.readdirSync(ext).map(n => [n, fs.readFileSync(path.join(ext, n))]));
  for (const n of keep) await stage(n, fs.readFileSync(path.join(ext, n), 'utf8'));
  r = await call('xcommit', { names: ['background.js', 'manifest.json', ...keep] }); assert(r.ok, JSON.stringify(r));
  assert.strictEqual(fs.readFileSync(path.join(ext, 'background.js'), 'utf8'), '// NEW'); assert(!fs.existsSync(path.join(ext, 'obsolete.js')), 'files the new version no longer has are removed');
  assert(!fs.existsSync(path.join(repo, 'update')), 'staging folder cleaned up');
  console.log('ok  update swapped in at once; removed files deleted; staging folder cleaned');
  for (const [n, b] of Object.entries(saved)) if (n !== 'obsolete.js') fs.writeFileSync(path.join(ext, n), b);   // restore the repository files
  p.stdin.end(); fs.rmSync(path.join(root, T), { recursive: true, force: true });
  console.log('\n7 checks passed'); process.exit(0);
})().catch(e => { log((ci ? '::error::' : '') + 'FAIL: ' + e.message); try { fs.rmSync(path.join(root, T), { recursive: true, force: true }); } catch (_) {} process.exit(1); });
