(() => {
  const manual = !!window.__aiubManual; window.__aiubManual = false;
  const DASH = /portal\.aiub\.edu\/Student(\/Home(\/Index(\/\d+)?)?)?\/?(\?|#|$)/i;
  const onDash = DASH.test(location.href);
  if (!manual && (!onDash || window.__aiubRan)) return;   // auto mode: once per page load, only on the dashboard
  if (window.__aiubRunning) return;
  window.__aiubRan = true;
  if (window.__aiubPanel) window.__aiubPanel.remove();

  // ---------- Panel shell ----------
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647';
  window.__aiubPanel = host;
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
*{box-sizing:border-box;margin:0;font-family:"Segoe UI",system-ui,Arial,sans-serif}
.p{width:min(330px,calc(100vw - 24px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:#fff;border-radius:16px;overflow:hidden;color:#1c2a3a;
  box-shadow:0 10px 32px rgba(11,40,90,.28),0 0 0 1px rgba(11,58,126,.08);animation:in .28s cubic-bezier(.2,.8,.2,1);transition:opacity .25s,transform .25s}
.p.out{opacity:0;transform:translateY(-8px) scale(.98)}
@keyframes in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
.h{display:flex;align-items:center;gap:10px;padding:11px 10px 11px 14px;background:linear-gradient(120deg,#0a3374,#1767c7);color:#fff}
.lg{width:30px;height:30px;flex:none;border-radius:9px;background:#fff;color:#0a3374;font-weight:800;font-size:17px;display:grid;place-items:center}
.t{flex:1;min-width:0}
.t b{display:block;font-size:14.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t small{display:block;font-size:11.5px;opacity:.88;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.x{flex:none;background:rgba(255,255,255,.18);border:0;color:#fff;width:26px;height:26px;border-radius:8px;cursor:pointer;font-size:13px}
.x:hover{background:rgba(255,255,255,.3)}
.pg{height:4px;background:#d9e3f2}
.pg div{height:100%;width:0;background:linear-gradient(90deg,#1767c7,#27c27a);transition:width .3s}
.pg.ind div{width:35%;animation:ind 1s ease-in-out infinite alternate}
@keyframes ind{from{margin-left:0}to{margin-left:65%}}
.b{padding:10px 10px 11px;overflow:auto;background:#f4f7fc}
.c{background:#fff;border-radius:11px;padding:9px 11px;margin-bottom:6px;box-shadow:0 1px 2px rgba(11,40,90,.07)}
.r{display:flex;align-items:center;justify-content:space-between;gap:8px}
.nm{min-width:0;font-size:12.5px;font-weight:600;color:#0a3374;line-height:1.3}
.bd{flex:none;font-size:10.5px;font-weight:600;padding:2px 9px;border-radius:20px;background:#e6edf8;color:#3a5675}
.bd.ok{background:#d8f4e3;color:#13703a}.bd.w{background:#fff0c9;color:#855900}.bd.b{background:#dbe8fb;color:#134a96}.bd.fl{background:#fde2e2;color:#a32121}
.bar{display:none;height:4px;margin-top:7px;background:#e3eaf5;border-radius:4px;overflow:hidden}
.bar div{height:100%;width:0;background:linear-gradient(90deg,#1767c7,#27c27a);transition:width .25s}
.er{display:none;margin-top:5px;font-size:10.5px;color:#a32121;line-height:1.3}
.ft{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 2px 0}
.m{font-size:12px;font-weight:600;color:#0a3374;line-height:1.35}
.rt{display:none;flex:none;border:0;border-radius:8px;padding:6px 12px;background:#0a3374;color:#fff;font-size:12px;font-weight:600;cursor:pointer}
.g{display:none;background:#fff8e1;border:1px solid #f1d98a;border-radius:11px;padding:10px 11px;margin-bottom:8px;font-size:12px;line-height:1.45;color:#5b4300}
.g button{border:0;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:600;cursor:pointer;margin:7px 6px 0 0}
.g .go{background:#0a3374;color:#fff}.g .no{background:#e6e9ef;color:#334}
.g .ge{color:#c0392b;margin-top:6px;font-size:11.5px}
@media (prefers-reduced-motion:reduce){.p,.pg div,.bar div{animation:none;transition:none}}
</style>
<div class="p" id="p">
  <div class="h"><div class="lg">A</div><div class="t"><b id="hi">Welcome</b><small id="sub">Starting…</small></div><button class="x" id="x" title="Close">✕</button></div>
  <div class="pg ind" id="pg"><div id="o"></div></div>
  <div class="b">
    <div class="g" id="g"></div>
    <div id="cs"></div>
    <div class="ft"><span class="m" id="m"></span><button class="rt" id="rt">Retry</button></div>
  </div>
</div>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  let closeT = null;
  const closeNow = () => { clearTimeout(closeT); $('p').classList.add('out'); setTimeout(() => host.remove(), 280); };
  $('x').onclick = closeNow;
  $('p').addEventListener('mouseenter', () => clearTimeout(closeT));   // hovering keeps the panel open
  const msg = (t, c) => { $('m').textContent = t; $('m').style.color = c || '#0a3374'; };
  const sub = t => { $('sub').textContent = t; };

  // ---------- Helpers ----------
  const S = { a: 0, f: 0, d: 0, k: 0, e: 0, n: 0 };   // courses, files found, saved, already had, failed, new to fetch
  const setProg = ind => { $('pg').className = 'pg' + (ind ? ' ind' : ''); if (!ind) $('o').style.width = (S.n ? Math.round(100 * (S.d + S.e) / S.n) : 100) + '%'; };
  const sanitize = s => s.replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  const hasExt = n => /\.[A-Za-z0-9]{1,6}$/.test(n);
  const limitName = (n, max) => { if (n.length <= max) return n; const m = n.match(/(\.[A-Za-z0-9]{1,6})$/); const ext = m ? m[1] : ''; return n.slice(0, max - ext.length).trim() + ext; };
  function limiter(n) { let a = 0; const q = []; const nx = () => { if (a < n && q.length) { a++; const { fn, res, rej } = q.shift(); fn().then(res, rej).finally(() => { a--; nx(); }); } }; return fn => new Promise((res, rej) => { q.push({ fn, res, rej }); nx(); }); }
  const scanL = limiter(8), dlL = limiter(4);
  const SMALL = new Set(['and', 'with', 'of', 'in', 'to', 'for', 'the', 'a', 'an', 'on', 'at']);
  const pretty = t => t.replace(/^\d+\s*-\s*/, '').split(/(\s+)/).map((w, i) => {
    if (!w || /^\s+$/.test(w) || /^\[.*\]$/.test(w)) return w;
    if (/^\.net$/i.test(w)) return '.NET';
    if (/^[ivx]+$/i.test(w)) return w.toUpperCase();
    const l = w.toLowerCase();
    if (i > 0 && SMALL.has(l)) return l;
    return l.replace(/^([^a-z]*)([a-z])/, (m, p, c) => p + c.toUpperCase());
  }).join('');

  // "Welcome RISHAD, NAJIAT ISLAM" on the portal -> "Rishad"
  function firstName() {
    let best = '';
    try {
      document.querySelectorAll('a,span,div,li,p,label,b,strong,h1,h2,h3,h4,h5,small,td').forEach(el => {
        const tc = el.textContent || '';
        if (tc.length < 9 || tc.length > 90) return;
        const m = tc.match(/^\s*Welcome\s*[,:]?\s+(.+?)\s*$/i);
        if (m && (!best || tc.length < best.length)) best = m[1];
      });
    } catch (e) {}
    let w = best ? best.split(',')[0].trim().split(/\s+/)[0] : '';
    if (w) { w = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); try { localStorage.setItem('aiubName', w); } catch (e) {} return w; }
    try { return localStorage.getItem('aiubName') || ''; } catch (e) { return ''; }
  }

  // ---------- Portal scraping ----------
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
  const SIZE = /\d+(\.\d+)?\s*(bytes?|[KMG]b)\b/i;
  function findFiles(doc, base) {
    const files = [], used = new Map();
    doc.querySelectorAll('tr').forEach(tr => {
      if (!SIZE.test(tr.textContent)) return;
      const a = tr.querySelector('a[href]');
      const h = a && a.getAttribute('href');
      if (!h || /^(#|javascript)/i.test(h)) return;
      let name = sanitize(a.textContent.trim()) || 'file';
      const key = name.toLowerCase();
      if (used.has(key)) {
        const n = used.get(key) + 1; used.set(key, n);
        name = hasExt(name) ? name.replace(/(\.[A-Za-z0-9]{1,6})$/, ` (${n})$1`) : `${name} (${n})`;
      } else used.set(key, 1);
      files.push({ name, url: new URL(h, base).href });
    });
    return files;
  }
  function viaIframe(href) {   // slow path: let the real page render (notes may load on a tab click)
    return new Promise(res => {
      const fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;left:-9999px;width:800px;height:600px;border:0';
      fr.src = href; document.body.appendChild(fr);
      let n = 0, loaded = -1, clicked = -1;
      const done = f => { clearInterval(t); fr.remove(); res(f); };
      const t = setInterval(() => {
        n++;
        try {
          const d = fr.contentDocument;
          if (d) {
            const f = findFiles(d, fr.contentWindow.location.href);
            if (f.length) return done(f);
            if (d.readyState === 'complete') {
              if (loaded < 0) loaded = n;
              if (clicked < 0 && n - loaded >= 4) {
                const tb = d.querySelector('a[href*="notesTab"]');
                if (!tb) return done([]);          // no notes tab and no files -> nothing to download
                tb.click(); clicked = n;
              }
              if (clicked >= 0 && n - clicked >= 10) return done([]);
            }
          }
        } catch (e) {}
        if (n > 100) done([]);
      }, 150);
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

  // ---------- Helper (Desktop/AIUB) ----------
  const send = async m => { try { return await chrome.runtime.sendMessage(m); } catch (e) { return { ok: false, err: e.message }; } };
  function gate(err) {
    return new Promise(resolve => {
      sub('One-time setup needed');
      const g = $('g'); g.style.display = 'block';
      const stale = /context invalidated/i.test(err || '');
      g.innerHTML = stale
        ? '<b>Extension was just updated.</b><br>Please refresh this page (F5).'
        : '<b>Setup needed (one time, 10 seconds)</b><br>Double-click <b>Setup.bat</b> in the AIUB-Smart-Slide-Downloader folder, then press “Check again”.<br>';
      if (!stale) {
        const go = document.createElement('button'); go.className = 'go'; go.textContent = 'Check again';
        const no = document.createElement('button'); no.className = 'no'; no.textContent = 'Skip (use Downloads)';
        g.appendChild(go); g.appendChild(no);
        if (err) { const e = document.createElement('div'); e.className = 'ge'; e.textContent = 'Not ready yet: ' + err; g.appendChild(e); }
        go.onclick = () => { g.style.display = 'none'; sub('Checking…'); resolve('again'); };
        no.onclick = () => { g.style.display = 'none'; resolve('skip'); };
      }
    });
  }
  async function getHave(folders) {   // -> { folder: [names] } or null (fallback to Chrome Downloads)
    for (;;) {
      const r = await send({ cmd: 'listall', folders });
      if (r && r.ok) return r.map;
      if (await gate(r && r.err) === 'skip') return null;
    }
  }
  const isHad = (have, name) => {
    const n = name.toLowerCase();
    if (have.has(n)) return true;
    if (hasExt(n)) return false;
    for (const x of have) if (x.startsWith(n + '.') && hasExt(x) && x.length - n.length <= 7) return true;
    return false;
  };

  // ---------- Course cards ----------
  function card(c) {
    const el = document.createElement('div'); el.className = 'c';
    el.innerHTML = '<div class="r"><span class="nm"></span><span class="bd"></span></div><div class="bar"><div></div></div><div class="er"></div>';
    const nm = el.querySelector('.nm'); nm.textContent = pretty(c.title); nm.title = c.title;
    c.bd = el.querySelector('.bd'); c.bar = el.querySelector('.bar'); c.fill = el.querySelector('.bar div'); c.er = el.querySelector('.er');
    setBd(c, 'Waiting', '');
    $('cs').appendChild(el);
  }
  const setBd = (c, t, k) => { c.bd.textContent = t; c.bd.className = 'bd ' + (k || ''); };
  const prog = c => { const done = c.ok + c.bad; c.fill.style.width = Math.round(100 * done / c.todo.length) + '%'; setBd(c, `Downloading ${done}/${c.todo.length}`, 'b'); };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // ---------- Main flow ----------
  async function start() {
    window.__aiubRunning = true;
    clearTimeout(closeT);
    Object.assign(S, { a: 0, f: 0, d: 0, k: 0, e: 0, n: 0 });
    $('cs').innerHTML = ''; $('rt').style.display = 'none'; $('g').style.display = 'none'; msg(''); setProg(true);
    const name = firstName();
    $('hi').textContent = name ? `Welcome, ${name}` : 'Welcome';
    if (!DASH.test(location.href)) {
      sub('Wrong page'); setProg(false); msg('Open your Dashboard (portal.aiub.edu/Student) and click the icon again.', '#c0392b'); return;
    }
    sub('Finding your courses…');
    let courses = extractCourses();
    for (let i = 0; i < 100 && !courses.length; i++) { await new Promise(r => setTimeout(r, 200)); courses = extractCourses(); }
    S.a = courses.length;
    if (!courses.length) { sub('No courses found'); setProg(false); msg('No active courses found on this page.', '#c0392b'); if (!manual) closeT = setTimeout(closeNow, 2500); return; }
    courses.forEach(card);
    sub(`${plural(courses.length, 'active course')} · checking files…`);
    courses.forEach(c => { c.folder = limitName(sanitize(c.title.replace(/^\d+\s*-\s*/, '')), 60); });

    // portal scan and Desktop-folder listing run at the same time
    const scanP = Promise.all(courses.map(c => scanL(async () => {
      setBd(c, 'Checking…', 'w');
      c.files = (await getFiles(c)).map(f => ({ ...f, name: limitName(f.name, 110) }));
    })));
    const haveMap = await getHave(courses.map(c => c.folder));
    await scanP;
    const helper = !!haveMap;

    await Promise.all(courses.map(async c => {
      c.todo = []; c.ok = 0; c.bad = 0;
      const have = helper ? new Set((haveMap[c.folder] || []).map(n => n.toLowerCase())) : null;
      for (const f of c.files) {
        let had = false;
        if (have) had = isHad(have, f.name);
        else { const r = await send({ cmd: 'has', folder: c.folder, name: f.name }); had = !!(r && r.have); }
        if (had) S.k++; else c.todo.push(f);
      }
      S.f += c.files.length; S.n += c.todo.length;
      if (!c.files.length) setBd(c, 'No files yet', '');
      else if (!c.todo.length) setBd(c, 'Up to date ✓', 'ok');
      else setBd(c, plural(c.todo.length, 'new file'), 'w');
    }));

    // download: all courses at once, 4 files at a time
    setProg(false);
    if (S.n) sub(`Downloading ${plural(S.n, 'new file')}…`);
    await Promise.all(courses.map(async c => {
      if (!c.todo.length) return;
      c.bar.style.display = 'block'; prog(c);
      await Promise.all(c.todo.map(f => dlL(async () => {
        const r = await send({ cmd: helper ? 'save' : 'dl', url: f.url, folder: c.folder, name: f.name });
        if (r && (r.status === 'done' || r.status === 'skip')) { c.ok++; S.d++; }
        else { c.bad++; S.e++; c.lastErr = (r && r.err) || 'failed'; }
        prog(c); setProg(false);
        sub(`Downloading… ${S.d + S.e} of ${S.n}`);
      })));
      if (c.bad) { setBd(c, `${c.bad} failed`, 'fl'); c.er.textContent = c.lastErr; c.er.style.display = 'block'; }
      else setBd(c, 'Done ✓', 'ok');
    }));

    // finish
    setProg(false);
    if (S.e) {
      sub('Some files failed'); msg(`${S.d} saved, ${S.e} failed.`, '#c0392b'); $('rt').style.display = 'block';
    } else {
      sub(helper ? 'Saved in Desktop → AIUB' : 'Saved in Downloads → AIUB');
      msg(S.d ? `All done! ${plural(S.d, 'new file')} saved ✓` : 'All files are up to date ✓', '#13703a');
      closeT = setTimeout(closeNow, 2000);   // closes by itself 2s after finishing
    }
  }
  $('rt').onclick = () => start().catch(fail).finally(() => { window.__aiubRunning = false; });
  const fail = e => { sub('Something went wrong'); setProg(false); msg('Error: ' + e.message, '#c0392b'); $('rt').style.display = 'block'; };
  start().catch(fail).finally(() => { window.__aiubRunning = false; });
})();
