// Run:  node tests/zip.test.js   -- extension/zip.js against a real zip file and a fake server (with and without Range support)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziptest-'));
fs.mkdirSync(path.join(dir, 'in/sub'), { recursive: true });
fs.writeFileSync(path.join(dir, 'in/Memo One.txt'), 'hello memo '.repeat(500));
fs.writeFileSync(path.join(dir, 'in/sub/Slides.bin'), Buffer.from(Array.from({ length: 70000 }, (_, i) => (i * 7) & 255)));
fs.writeFileSync(path.join(dir, 'in/.hidden'), 'x');
cp.execFileSync('python3', ['-I', '-c', `import zipfile,sys,os
z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)
for r,_,fs_ in os.walk(sys.argv[2]):
  for f in fs_: z.write(os.path.join(r,f), os.path.relpath(os.path.join(r,f), sys.argv[2]))
z.writestr('stored.txt','plain', compress_type=zipfile.ZIP_STORED); z.writestr('__MACOSX/junk','x'); z.close()`, path.join(dir, 't.zip'), path.join(dir, 'in')]);
const data = fs.readFileSync(path.join(dir, 't.zip'));
let range = true, hits = 0;
global.fetch = async (url, o) => {
  hits++; const h = (o && o.headers) || {}; const m = (h.Range || '').match(/bytes=(-?\d+)(?:-(\d+))?/);
  const hd = (x) => ({ get: k => (x[k.toLowerCase()] || '') });
  if (range && m) {
    let a, b; if (m[1][0] === '-') { a = Math.max(0, data.length + +m[1]); b = data.length - 1; } else { a = +m[1]; b = Math.min(+m[2], data.length - 1); }
    const body = data.subarray(a, b + 1);
    return { status: 206, ok: true, headers: hd({ 'content-range': `bytes ${a}-${b}/${data.length}` }), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  }
  return { status: 200, ok: true, headers: hd({ 'content-length': String(data.length), 'content-type': 'application/zip' }), arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length) };
};
const Zip = require('../extension/zip.js');
const readAll = async rd => { const parts = []; for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(Buffer.from(value)); } return Buffer.concat(parts); };
(async () => {
  for (range of [true, false]) {
    Zip.clearCache(); hits = 0;
    const list = await Zip.list('u');
    assert.deepStrictEqual(list.map(e => e.base).sort(), ['Memo One.txt', 'Slides.bin', 'stored.txt']);
    for (const e of list) {
      const got = await readAll(await Zip.open('u', e));
      const want = e.base === 'stored.txt' ? Buffer.from('plain') : fs.readFileSync(path.join(dir, 'in', e.base === 'Slides.bin' ? 'sub/Slides.bin' : e.base));
      assert(got.equals(want), e.base + ' differs'); assert.strictEqual(got.length, e.usize);
    }
    console.log('ok  zip listed and unpacked ' + (range ? 'with Range requests (' + hits + ' requests)' : 'when the server ignores Range (' + hits + ' request)'));
  }
  console.log('\n2 checks passed');
})().catch(e => { console.error(e); process.exit(1); });
