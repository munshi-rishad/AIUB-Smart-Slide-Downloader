(() => {
  const manual = !!window.__aiubManual; window.__aiubManual = false;
  const onDash = /portal\.aiub\.edu\/Student(\/Home(\/Index(\/\d+)?)?)?\/?(\?|#|$)/i.test(location.href);
  if (!manual && (!onDash || window.__aiubRan)) return;   // auto mode: only once, only on the dashboard
  if (window.__aiubRunning) return;
  window.__aiubRan = true;
  if (window.__aiubPanel) window.__aiubPanel.remove();
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:14px;right:14px;z-index:2147483647';
  window.__aiubPanel = host;
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
*{box-sizing:border-box;font-family:"Segoe UI",Arial,sans-serif}
.p{width:420px;max-height:88vh;display:flex;flex-direction:column;background:#eef2f8;border-radius:14px;box-shadow:0 8px 30px #0006;overflow:hidden;color:#1c2a3a}
.h{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(120deg,#0b3a7e,#1465c0);color:#fff}
.lg{width:34px;height:34px;border-radius:9px;background:#fff;color:#0b3a7e;font-weight:800;font-size:19px;display:grid;place-items:center}
.t{flex:1}.t b{display:block;font-size:14px}.t small{font-size:11.5px;opacity:.85}
.x{background:#ffffff30;border:0;color:#fff;width:28px;height:28px;border-radius:7px;cursor:pointer;font-size:15px}
.b{padding:12px;overflow:auto}
.st{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:10px}
.s{background:#fff;border-radius:9px;padding:7px 2px;text-align:center}
.s b{display:block;font-size:19px;color:#0b3a7e}.s span{font-size:9.5px;color:#667}
.s.ok b{color:#1b9e4b}.s.sk b{color:#c78a00}.s.fl b{color:#d33}
.bar{height:7px;background:#d3dcea;border-radius:5px;overflow:hidden}
.bar div{height:100%;width:0;background:linear-gradient(90deg,#1465c0,#2ecc71);transition:width .25s}
.bar.top{margin-bottom:8px}
.m{font-size:12.5px;font-weight:600;margin-bottom:8px;color:#0b3a7e}
.g{display:none;background:#fff8e1;border:1px solid #f1d98a;border-radius:11px;padding:11px 12px;margin-bottom:10px;font-size:12.5px;line-height:1.45;color:#5b4300}
.g button{border:0;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;margin:8px 6px 0 0}
.g .go{background:#0b3a7e;color:#fff}.g .no{background:#e6e9ef;color:#334}
.g .er{color:#c0392b;margin-top:6px}
.c{background:#fff;border-radius:11px;padding:10px 12px;margin-bottom:8px}
.c h4{margin:0 0 6px;font-size:12.5px;color:#0b3a7e}
.r{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.bd{display:inline-block;font-size:10.5px;padding:1px 8px;border-radius:20px;background:#e3ebf7;color:#235}
.bd.ok{background:#d5f5e1;color:#146c34}.bd.w{background:#fff1cc;color:#8a5b00}.bd.fl{background:#fde0e0;color:#a22}
.n{font-size:11px;color:#667}
</style>
<div class="p"><div class="h"><div class="lg">A</div><div class="t"><b>AIUB Downloader</b><small id="sub">Starting…</small></div><button class="x" id="x" title="Close">✕</button></div>
<div class="b"><div class="st">
<div class="s"><b id="a">0</b><span>Courses</span></div><div class="s"><b id="f">0</b><span>Files</span></div>
<div class="s ok"><b id="d">0</b><span>Saved</span></div><div class="s sk"><b id="k">0</b><span>Had</span></div><div class="s fl"><b id="e">0</b><span>Failed</span></div></div>
<div class="g" id="g"></div>
<div class="bar top"><div id="o"></div></div><div class="m" id="m"></div><div id="cs"></div></div></div>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  $('x').onclick = () => host.remove();
  const msg = (t, c) => { $('m').textContent = t; $('m').style.color = c || '#0b3a7e'; };
  const S = { a: 0, f: 0, d: 0, k: 0, e: 0, n: 0 };   // n = total new files to fetch
  const upd = () => { for (const k of ['a', 'f', 'd', 'k', 'e']) $(k).textContent = S[k]; $('o').style.width = (S.n ? Math.round(100 * (S.d + S.e) / S.n) : 0) + '%'; };
  const sanitize = s => s.replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  const hasExt = n => /\.[A-Za-z0-9]{1,6}$/.test(n);
  function limiter(n) { let a = 0; const q = []; const nx = () => { if (a < n && q.length) { a++; const { fn, res, rej } = q.shift(); fn().then(res, rej).finally(() => { a--; nx(); }); } }; return fn => new Promise((res, rej) => { q.push({ fn, res, rej }); nx(); }); }
  const scanL = limiter(6), dlL = limiter(3);

  // ---------- Desktop/AIUB via the helper (null => fallback to Downloads/AIUB) ----------
  const ping = async () => { try { const r = await chrome.runtime.sendMessage({ cmd: 'ping' }); return r && r.ok ? r : null; } catch (e) { return null; } };
  async function ensureHelper() {
    let r = await ping(); if (r) return r;
    return new Promise(resolve => {
      const g = $('g'); g.style.display = 'block';
      g.innerHTML = '<b>One-time setup: AIUB helper not installed</b><br>Open the <b>aiub-helper</b> folder (keep it somewhere permanent, e.g. C:\\AIUB-Helper) and double-click <b>install.bat</b>. It creates <b>Desktop → AIUB</b> for you. Then press “Check again”.<br>';
      const go = document.createElement('button'); go.className = 'go'; go.textContent = 'Check again';
      const no = document.createElement('button'); no.className = 'no'; no.textContent = 'Skip (use Downloads/AIUB)';
      g.appendChild(go); g.appendChild(no);
      no.onclick = () => { g.style.display = 'none'; resolve(null); };
      go.onclick = async () => {
        const r = await ping();
        if (r) { g.style.display = 'none'; return resolve(r); }
        let e = g.querySelector('.er'); if (!e) { e = document.createElement('div'); e.className = 'er'; g.appendChild(e); }
        e.textContent = 'Helper still not found. Run install.bat, then reload the extension in chrome://extensions and try again.';
      };
    });
  }

  // ---------- Scraping ----------
  function extractCourses() {
    const out = [], seen = new Set();
    document.querySelectorAll('a').forEach(a => {
      if (!/^\s*Notes\s*$/i.test(a.textContent)) return;
      let box = a, text = '';
      for (let i = 0; i < 8 && box.parentElement; i++) {
        box = box.parentElement; text = box.innerText || '';
        if (/^\s*\d{3,6}\s*-/.test(text) && /Status/.test(text) && (text.match(/Notes/g) || []).length === 1) break;
      }
      if (!/^\s*\d{3,6}\s*-/.test(text)) return;
      const title = text.trim().split('\n')[0].trim();
      const parts = text.split(/Status\s*:/i);
      const tail = (parts[parts.length - 1] || '').split(/Result/i)[0];
      const w = (tail.match(/Dropped|Invalid|Valid/gi) || []).map(x => x.toLowerCase());
      const active = w.includes('valid') && !w.includes('dropped') && !w.includes('invalid');
      if (!active) return;   // dropped courses: completely ignored, not even listed
      const raw = a.getAttribute('href') || '';
      const href = raw && !/^(#|javascript)/i.test(raw) ? new URL(raw, location.href).href : '';
      if (!href || seen.has(title)) return; seen.add(title);
      out.push({ title, href });
    });
    return out;
  }
  function findFiles(doc, base) {
    const files = [], used = new Map();
    doc.querySelectorAll('tr').forEach(tr => {
      if (!/\d+(\.\d+)?\s*Mb/i.test(tr.textContent)) return;
      const a = tr.querySelector('a[href]');
      const h = a && a.getAttribute('href');
      if (!h || /^(#|javascript)/i.test(h)) return;
      let name = sanitize(a.textContent.trim()) || 'file';
      const key = name.toLowerCase();
      if (used.has(key)) { const n = used.get(key) + 1; used.set(key, n); name = hasExt(name) ? name.replace(/(\.[A-Za-z0-9]{1,6})$/, ` (${n})$1`) : `${name} (${n})`; }
      else used.set(key, 1);
      files.push({ name, url: new URL(h, base).href });
    });
    return files;
  }
  async function viaIframe(href) {
    return new Promise(res => {
      const fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;left:-9999px;width:800px;height:600px;border:0';
      fr.src = href; document.body.appendChild(fr);
      let n = 0;
      const t = setInterval(() => {
        n++;
        try {
          const d = fr.contentDocument;
          if (d) {
            const f = findFiles(d, fr.contentWindow.location.href);
            if (f.length) { clearInterval(t); fr.remove(); return res(f); }
            if (n === 8) { const tb = d.querySelector('a[href*="notesTab"]'); if (tb) tb.click(); }
          }
        } catch (e) {}
        if (n > 60) { clearInterval(t); fr.remove(); res([]); }
      }, 250);
    });
  }
  async function getFiles(c) {
    try {
      const r = await fetch(c.href, { credentials: 'include' });
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const f = findFiles(doc, c.href); if (f.length) return f;
    } catch (e) {}
    return viaIframe(c.href);
  }

  // ---------- Saving ----------
  const isHad = (have, name) => {
    const n = name.toLowerCase();
    if (have.has(n)) return true;
    if (hasExt(n)) return false;
    for (const x of have) if (x.startsWith(n + '.') && hasExt(x) && x.length - n.length <= 7) return true;
    return false;
  };

  // ---------- UI ----------
  function card(c) {
    const el = document.createElement('div'); el.className = 'c';
    el.innerHTML = '<h4></h4><div class="r"><span class="bd"></span><span class="n"></span></div><div class="bar"><div></div></div>';
    el.querySelector('h4').textContent = c.title;
    c.bd = el.querySelector('.bd'); c.n = el.querySelector('.n'); c.fill = el.querySelector('.bar div');
    c.bar = el.querySelector('.bar'); c.bar.style.display = 'none';
    setBd(c, 'Waiting', '');
    $('cs').appendChild(el);
  }
  const setBd = (c, t, k) => { c.bd.textContent = t; c.bd.className = 'bd ' + (k || ''); };
  const prog = c => {
    const done = c.ok + c.bad, tot = c.todo.length;
    c.fill.style.width = (tot ? Math.round(100 * done / tot) : 100) + '%';
    c.n.textContent = `${done}/${tot}`;
  };

  async function run() {
    if (!/portal\.aiub\.edu\/Student(\/Home(\/Index(\/\d+)?)?)?\/?(\?|#|$)/i.test(location.href)) {
      $('sub').textContent = 'Wrong page'; msg('Open the Dashboard (portal.aiub.edu/Student) and click the icon again.', '#c0392b'); return;
    }
    $('sub').textContent = 'Looking for your courses…';
    let courses = extractCourses();
    for (let i = 0; i < 40 && !courses.length; i++) { await new Promise(r => setTimeout(r, 500)); courses = extractCourses(); }
    S.a = courses.length; upd();
    $('sub').textContent = `${courses.length} active course(s)`;
    if (!courses.length) { msg('No active courses found.', '#c0392b'); if (!manual) setTimeout(() => host.remove(), 4000); return; }

    const rootDir = await ensureHelper();   // null => fallback to Downloads/AIUB
    $('sub').textContent = rootDir ? `${courses.length} active course(s) → Desktop/AIUB` : `${courses.length} active course(s) → Downloads/AIUB`;
    courses.forEach(card);

    // Phase 1: for every active course, find the files and work out which ones are new/missing
    msg('Checking for new files…');
    await Promise.all(courses.map(c => scanL(async () => {
      setBd(c, 'Checking…', 'w');
      const files = await getFiles(c);
      c.folder = sanitize(c.title.replace(/^\d+\s*-\s*/, ''));
      c.todo = []; c.ok = 0; c.bad = 0;
      try {
        let have = null;
        if (rootDir) {
          const lr = await chrome.runtime.sendMessage({ cmd: 'list', folder: c.folder });
          if (!lr || !lr.ok) throw new Error((lr && lr.err) || 'helper error');
          have = new Set(lr.names.map(n => n.toLowerCase()));
        }
        for (const f of files) {
          let had = false;
          if (have) had = isHad(have, f.name);
          else { try { const r = await chrome.runtime.sendMessage({ cmd: 'has', folder: c.folder, name: f.name }); had = !!(r && r.have); } catch (e) {} }
          if (had) S.k++; else c.todo.push(f);
        }
      } catch (e) { c.todo = files; c.setupErr = e.message; }
      S.f += files.length; S.n += c.todo.length; upd();
      if (c.setupErr) setBd(c, 'Folder error', 'fl');
      else if (!files.length) setBd(c, 'No files on portal', '');
      else if (!c.todo.length) setBd(c, 'Up to date ✔', 'ok');
      else setBd(c, `${c.todo.length} new file${c.todo.length > 1 ? 's' : ''}`, 'w');
    })));

    // Phase 2: download course by course, with a progress bar on each course
    for (const c of courses) {
      if (!c.todo.length || c.setupErr && !c.todo.length) continue;
      $('sub').textContent = c.title.replace(/^\d+\s*-\s*/, '');
      msg(`Downloading ${c.todo.length} new file${c.todo.length > 1 ? 's' : ''}…`);
      c.bar.style.display = 'block'; prog(c); setBd(c, 'Downloading…', 'w');
      await Promise.all(c.todo.map(f => dlL(async () => {
        try {
          const r = await chrome.runtime.sendMessage({ cmd: rootDir ? 'save' : 'dl', url: f.url, folder: c.folder, name: f.name });
          if (!r || (r.status !== 'done' && r.status !== 'skip')) throw new Error((r && r.err) || 'failed');
          c.ok++; S.d++;
        } catch (e) { c.bad++; S.e++; c.lastErr = e.message; }
        prog(c); upd();
      })));
      if (c.bad) { setBd(c, `${c.ok} saved, ${c.bad} failed`, 'fl'); c.n.textContent = c.lastErr || ''; }
      else setBd(c, 'Completed ✔', 'ok');
    }
    $('sub').textContent = `${S.a} active course(s)`;
    if (S.e) msg(`${S.d} new saved, ${S.e} failed. Click the extension icon to retry the failed ones.`, '#c0392b');
    else if (S.d) msg(`Done! ${S.d} new file(s) saved. ${S.k} were already in your AIUB folder.`, '#1b9e4b');
    else { msg(`All up to date ✔  (${S.k} files already in your AIUB folder)`, '#1b9e4b'); setTimeout(() => host.remove(), 6000); }
  }
  window.__aiubRunning = true;
  run().catch(e => msg('Error: ' + e.message, '#c0392b')).finally(() => { window.__aiubRunning = false; });
})();
