/* ==========================================================================
   AIUB Smart Slide Downloader - shared helpers (pure functions, no browser APIs)
   Loaded by: panel.js (content script), background.js (service worker) and tests/lib.test.js (node).
   Everything that can be unit-tested lives here. All tunable numbers are in CFG.
   ========================================================================== */
(function (root) {
  'use strict';

  const CFG = {
    SP_HOST: 'aiubedu60714.sharepoint.com',      // AIUB's SharePoint (the "Shared" tab of every Teams class lives here)
    TEAMS_URL: 'https://teams.cloud.microsoft/', // opened when the person has to sign in
    PORTAL_UTC_OFFSET_MIN: 360,                  // portal upload times are Bangladesh time (UTC+6); Teams times are UTC
    FOLDER_MAX: 60,                              // max characters of a course / sub-folder name
    NAME_MAX: 104,                               // max characters of a file name (the "01 - " number is added on top)
    SIM_NAME_ONLY: 0.9,                          // two files count as the same if names are this similar and the size is unknown
    SIM_WITH_SIZE: 0.55,                         // ...or this similar when the sizes match
    COURSE_SIM: 0.85,
    COURSE_SIM_LOOSE: 0.6,                       // second chance for a course that found no class (same semester only)
    NUMBERING: true,                             // false = keep the original file names (no 01 - , 02 - )
    MAX_FILE_MB: 300,                            // Teams files bigger than this (meeting recordings...) are skipped
    DEV_AUTORELOAD: true,                        // reload the extension by itself when its files change (developer convenience)
    ORDER: 'content',                            // 'content' = lectures/modules/labs in their natural order; 'time' = pure upload time
    AUTO_UPDATE: true,                           // look for a newer version on GitHub (needs the helper to install it)
    ASK_BEFORE_UPDATE: true,                     // true = the person is asked first ("Update now" / "Later"); false = install by itself
    UPDATE_REPO: 'munshi-rishad/AIUB-Smart-Slide-Downloader',    // the GitHub repository the updates come from
    UPDATE_BRANCH: 'main',
    FILE_SCHEME: 1,                              // raise ONLY when a new version changes the CONTENT of saved files:
                                                 // every file saved with a lower scheme is then fetched again (the old copy goes to "_Old versions")
    OLD_DIR: '_Old versions',                    // replaced copies are moved here (inside Desktop/AIUB), never deleted
    UPPERCASE: true,                             // every saved file name in CAPITAL LETTERS
    UNZIP: true,                                 // zip files are unpacked: their contents are saved (and numbered) as normal files
    SOURCE_TAG: true,                            // add "(Portal)" / "(Teams)" at the end of every file name
    DL_PARALLEL: 6,                              // files downloaded at the same time
  };

  // is version a ("10.1") newer than b ("9.9")?
  function versionNewer(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    if ([...x, ...y].some(n => !Number.isFinite(n))) return false;
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
    return false;
  }

  /* ---------- file / folder names ---------- */
  const sanitize = s => s.replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  const hasExt = n => /\.[A-Za-z0-9]{1,6}$/.test(n);
  const extOf = n => { const m = n.match(/\.([A-Za-z0-9]{1,6})$/); return m ? m[1].toLowerCase() : ''; };
  const limitName = (n, max) => {
    if (n.length <= max) return n;
    const m = n.match(/(\.[A-Za-z0-9]{1,6})$/), ext = m ? m[1] : '';
    return n.slice(0, max - ext.length).trim() + ext;
  };
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const NUMRX = /^\d{1,4} - /;                       // "01 - " in front of numbered files
  const SUFRX = /\s\((?:Portal\+Teams|Portal|Teams)(?: ZIP)?\)(?=(?:\.[A-Za-z0-9]{1,6})?$)/i;   // " (Portal)" / " (Teams)" in front of the extension
  const strip = n => n.replace(NUMRX, '').replace(SUFRX, '');
  // "Lecture 1.pdf" + "Teams" -> "Lecture 1 (Teams).pdf"
  const withTag = (n, tag) => {
    if (!tag || CFG.SOURCE_TAG === false) return n;
    const m = n.match(/(\.[A-Za-z0-9]{1,6})$/);
    return m ? n.slice(0, -m[1].length) + ` (${tag})` + m[1] : `${n} (${tag})`;
  };
  const compose = (num, base, tag) => { const n = (num ? `${num} - ` : '') + withTag(base, tag); return CFG.UPPERCASE ? n.toUpperCase() : n; };
  function srcTag(it) {
    const s = new Set([it.src, ...(it.alts || []).map(a => a.src)].filter(Boolean));
    const z = it.zip || (it.alts || []).some(a => a.zip) ? ' ZIP' : '';   // came out of a zip file
    if (s.has('portal') && s.has('teams')) return 'Portal+Teams' + z;
    return (s.has('teams') ? 'Teams' : s.has('portal') ? 'Portal' : '') + (s.size ? z : '');
  }

  /* ---------- dates and sizes written by the portal ---------- */
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  // "07-Oct-26 16:24:35" (portal time) -> UTC milliseconds; unknown -> Infinity (sorted last)
  function parsePortalDate(t) {
    const m = String(t).match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return Infinity;
    const mo = MON[m[2].toLowerCase()]; if (mo === undefined) return Infinity;
    let y = +m[3]; if (y < 100) y += 2000;
    return Date.UTC(y, mo, +m[1], +m[4], +m[5], +(m[6] || 0)) - CFG.PORTAL_UTC_OFFSET_MIN * 60000;
  }
  // "0.378 Mb" -> { v: 0.378, unit: 'mb' }
  function parsePortalSize(t) {
    const m = String(t).match(/(\d+(?:\.\d+)?)\s*(bytes?|[KMG]b)\b/i);
    if (!m) return null;
    const u = m[2].toLowerCase();
    return { v: parseFloat(m[1]), unit: u.startsWith('byte') ? 'bytes' : u };
  }

  /* ---------- "is this the same file?" (portal vs Teams, slightly different names) ---------- */
  function normName(name) {
    let s = strip(name).replace(/\.[A-Za-z0-9]{1,6}$/, '').toLowerCase();
    s = s.replace(/[^\p{L}\p{N}]+/gu, ' ');
    s = s.replace(/\b(fall|spring|summer)\s+\d{2,4}(\s+\d{2,4})?\b/g, ' ');   // "(Fall_26_27)" is noise
    return s.replace(/\s+/g, ' ').trim();
  }
  function levenshtein(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  function similarity(a, b) {   // 0..1: best of "edit distance" and "shared words"
    if (!a || !b) return 0;
    if (a === b) return 1;
    const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
    const ta = new Set(a.split(' ')), tb = new Set(b.split(' '));
    let inter = 0; ta.forEach(t => { if (tb.has(t)) inter++; });
    return Math.max(lev, inter / (ta.size + tb.size - inter));
  }
  const digitsOf = s => (s.match(/\d+/g) || []).join(',');   // "lecture 1" and "lecture 2" must never be merged

  const K1024 = { bytes: 1, kb: 1024, mb: 1048576, gb: 1073741824 }, K1000 = { bytes: 1, kb: 1000, mb: 1e6, gb: 1e9 };
  const portalBytesMatch = (p, bytes) => [K1024, K1000].some(k => Math.abs(p.v * k[p.unit] - bytes) <= 0.001 * k[p.unit] + 1);
  function sizeRelation(a, b) {   // 'same' | 'diff' | 'unknown'
    const ea = a.bytes != null, eb = b.bytes != null;
    if (ea && eb) return a.bytes === b.bytes ? 'same' : 'diff';
    if (ea !== eb) {
      const ex = ea ? a : b, po = ea ? b : a;
      return po.psize ? (portalBytesMatch(po.psize, ex.bytes) ? 'same' : 'diff') : 'unknown';
    }
    if (a.psize && b.psize) {   // portal vs portal
      const x = a.psize.v * K1024[a.psize.unit], y = b.psize.v * K1024[b.psize.unit];
      return Math.abs(x - y) <= 0.001 * Math.max(x, y) + 1100 ? 'same' : 'diff';
    }
    return 'unknown';
  }
  function sameFile(a, b) {
    const ea = extOf(a.name), eb = extOf(b.name);
    if (ea && eb && ea !== eb) return false;
    const rel = sizeRelation(a, b);
    if (rel === 'diff') return false;                       // different size = different content
    const na = normName(a.name), nb = normName(b.name);
    if (!na || !nb || digitsOf(na) !== digitsOf(nb)) return false;
    if (na === nb) return true;
    const sim = similarity(na, nb);
    return rel === 'same' ? sim >= CFG.SIM_WITH_SIZE : sim >= CFG.SIM_NAME_ONLY;
  }
  // Keeps the first of every group of look-alike files (give portal files first). Merged ones go to .alts.
  function mergeSources(list) {
    const items = []; let dups = 0;
    for (const it of list) {
      const hit = items.find(k => sameFile(k, it));
      if (hit) { hit.alts.push(it); hit.ts = Math.min(hit.ts, it.ts); dups++; }
      else { it.alts = it.alts || []; items.push(it); }
    }
    return { items, dups };
  }

  /* ---------- order: course info -> lectures/modules -> labs -> assignments -> exams -> everything else ---------- */
  const RX_INFO = /\b(syllabus|outline|course\s*(instructions?|plan|info|information|description|policy|contents?)|class\s*(routine|schedule)|marks?\s*distribution|grading)\b|\b[a-z]{2,4}\s?\d{4}\b/;
  const RX_EXAM = /\b(mid\s*term|final|exam|quiz|revision|past\s*papers?|question\s*bank|solutions?)\b/;
  const RX_LAB = /\b(labs?|practical|tutorial|worksheet|exercises?)\b/;
  const RX_ASSIGN = /\b(assignments?|projects?|homework|case\s*study|presentation)\b/;
  const RX_OTHER = /\b(sample|memos?|emails?|template|application|reference|referencing|guide|guideline|style|form|rules?)\b/;
  const RX_KEYNUM = /\b(lecture|lec|module|chapter|ch|week|lab|topic|unit|part|session|lesson|slides?|assignment|project|quiz|experiment|exp)\s*0*(\d+)/;
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  function catOf(n) {
    if (RX_INFO.test(n)) return 0;
    if (RX_EXAM.test(n)) return 4;
    if (RX_LAB.test(n)) return 2;
    if (RX_ASSIGN.test(n)) return 3;
    if (RX_OTHER.test(n)) return 5;
    return 1;   // slides, lectures, modules, chapters: the main material
  }
  function seriesOf(n) {   // "module 6 10" -> { s: 'module', n: 6 };  "01 dotnet intro" -> { s: '#', n: 1 }
    const k = n.match(RX_KEYNUM);
    if (k) return { s: k[1].replace(/^slides$/, 'slide').replace(/^lec$/, 'lecture'), n: +k[2] };
    const m = n.match(/^(\D*?)\s*(\d+)/);
    if (m && m[1].length <= 20) return { s: m[1] || '#', n: +m[2] };
    return { s: n, n: Infinity };
  }
  function contentOrder(items) {
    const minTs = new Map();
    for (const f of items) {
      const n = normName(f.name), s = seriesOf(n);
      f._cat = catOf(n); f._ser = f._cat + '|' + s.s; f._num = s.n;
      minTs.set(f._ser, Math.min(minTs.has(f._ser) ? minTs.get(f._ser) : Infinity, f.ts));
    }
    items.sort((a, b) => (a._cat - b._cat) || cmp(minTs.get(a._ser), minTs.get(b._ser)) || cmp(a._ser, b._ser) || cmp(a._num, b._num) || cmp(a.ts, b.ts) || natural(a.name, b.name));
  }

  /* ---------- numbering: 01 - , 02 - ... in content order; "(Portal)" / "(Teams)" at the end ---------- */
  function prepareGroup(items, number) {
    if (CFG.ORDER === 'time') items.sort((a, b) => (a.ts - b.ts) || natural(a.name, b.name));   // same time -> by name (01_, 02_ ...)
    else contentOrder(items);
    const seen = new Map();
    for (const f of items) {   // two different files with the same name in one folder -> "name (2).ext"
      const key = f.name.toLowerCase(), n = (seen.get(key) || 0) + 1; seen.set(key, n);
      if (n > 1) f.name = hasExt(f.name) ? f.name.replace(/(\.[A-Za-z0-9]{1,6})$/, ` (${n})$1`) : `${f.name} (${n})`;
    }
    const w = Math.max(2, String(items.length).length);
    items.forEach((f, i) => { f.base = f.name; f.tag = srcTag(f); f.num = number === false ? '' : String(i + 1).padStart(w, '0'); f.name = compose(f.num, f.base, f.tag); });
    return items;
  }
  // map: lower-case name WITHOUT number -> real file name on disk
  function findLocal(map, base) {
    const n = base.toLowerCase();
    if (map.has(n)) return map.get(n);
    if (!hasExt(n)) for (const [k, v] of map) if (k.startsWith(n + '.') && hasExt(k) && k.length - n.length <= 7) return v;
    return null;
  }

  /* ---------- Teams folders -> local sub-folders ---------- */
  // library path "General/Lab/Week 1" -> "Lab/Week 1"; the General channel itself is the course folder
  function teamsDir(rel) {
    const seg = String(rel || '').split('/').filter(Boolean);
    if (seg.length && seg[0].toLowerCase() === 'general') seg.shift();
    return seg.map(s => limitName(sanitize(s), CFG.FOLDER_MAX)).filter(Boolean).join('/');
  }

  /* ---------- portal course <-> Teams class ---------- */
  const SEMRX = /^(FALL|SPRING|SUMMER)\s*\d{2}\s*-\s*\d{2}$/i;
  // portal "9876 - RESEARCH METHODOLOGY [P]"  and  Teams "01461 RESEARCH METHODOLOGY [P][FALL 26-27]"  -> "research methodology"
  const courseCore = t => t.replace(/\[[^\]]*\]/g, ' ').replace(/^\s*\d{2,6}\s*[-–]?\s*/, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const courseTags = t => [...t.matchAll(/\[([^\]]*)\]/g)].map(m => m[1].trim().toUpperCase()).filter(x => x && !SEMRX.test(x));
  function semTagOfTitle(t) {   // "...[FALL 26-27]" -> "FALL 26-27"
    const m = t.match(/\[\s*(FALL|SPRING|SUMMER)\s*(\d{2})\s*-\s*(\d{2})\s*\]/i);
    return m ? `${m[1].toUpperCase()} ${m[2]}-${m[3]}` : null;
  }
  function semTagFromOption(t) {   // portal "2026 - 2027, Fall" -> "FALL 26-27"
    const m = String(t).match(/(\d{4})\s*-\s*(\d{4})\s*,\s*(Spring|Summer|Fall)/i);
    return m ? `${m[3].toUpperCase()} ${m[1].slice(2)}-${m[2].slice(2)}` : null;
  }
  // Which of the person's portal courses does this Teams class belong to?  -> { course, score } | null
  const semRank = tag => { const m = String(tag || '').match(/^(FALL|SPRING|SUMMER)\s+(\d{2})-(\d{2})$/); return m ? (+m[2]) * 10 + { FALL: 1, SPRING: 2, SUMMER: 3 }[m[1]] : 0; };   // newer semester = bigger
  function matchCourse(siteTitle, courseTitles, semTag, minSim) {
    const min = minSim || CFG.COURSE_SIM, st = semTagOfTitle(siteTitle);
    if (semTag && st && st !== semTag) return null;           // a class from another semester
    if (min < CFG.COURSE_SIM && (!semTag || st !== semTag)) return null;   // the looser match is only allowed inside the right semester
    const core = courseCore(siteTitle), tags = courseTags(siteTitle);
    let best = null;
    for (const c of courseTitles) {
      const sim = similarity(core, courseCore(c));
      if (sim < min) continue;
      const ct = courseTags(c), overlap = ct.filter(t => tags.includes(t)).length;
      const score = sim * 10 + overlap + (ct.length && tags.length && !overlap ? -3 : 0);   // other section: unlikely
      if (!best || score > best.score) best = { course: c, score };
    }
    return best;
  }

  /* ---------- file identity: lets old files follow every change of names / folders in a new version ----------
     Every saved file is remembered by WHERE IT CAME FROM (portal link, Teams file id, entry inside a zip), not by its name.
     index: { id: { p: 'Course/Dir/NAME.PDF', s: signature, k: FILE_SCHEME, t: last seen (ms) } } (kept in chrome.storage) */
  const idsOf = f => [...new Set([f.id, ...(f.alts || []).map(a => a.id)].filter(Boolean))];
  const joinP = (folder, name) => (folder ? folder + '/' : '') + name;
  const splitP = p => { const i = p.lastIndexOf('/'); return i < 0 ? ['', p] : [p.slice(0, i), p.slice(i + 1)]; };
  function oldPath(p, stamp) {   // "Course/01 - A (PORTAL).PDF" -> "_Old versions/Course/01 - A (PORTAL) (OLD 2026-10-29).PDF"
    const [dir, name] = splitP(p), m = name.match(/(\.[A-Za-z0-9]{1,6})$/), ext = m ? m[1] : '';
    let tag = ` (OLD ${stamp})`; if (CFG.UPPERCASE) tag = tag.toUpperCase();
    return joinP(joinP(CFG.OLD_DIR, dir), name.slice(0, name.length - ext.length) + tag + ext);
  }
  // Decides, for every online file, what happens on disk. Pure function (unit-tested).
  //   groups: [{ folder, items }]   items already passed through prepareGroup (name, base, num, tag, alts, id, sig)
  //   have:   { folderPath: [file names on disk] }      index: see above
  //   opt:    { partial, stamp, superseded: [{ folder, base, ids }] }  (zips that were unpacked)
  // -> { moves: [{ f, t, ids, sig, keepSig }], todo: [{ item, folder }], kept: [{ ids, p, sig }], archived: n }
  function reconcile(groups, have, index, opt) {
    opt = opt || {};
    const lists = new Map(Object.entries(have || {}).map(([k, v]) => [k, v || []]));
    const claimed = new Set(), out = { moves: [], todo: [], kept: [], archived: 0 };
    const onDisk = p => {   // real path on disk (Windows names ignore capital letters) or null
      const [dir, name] = splitP(p), list = lists.get(dir); if (!list) return null;
      const hit = list.find(n => n.toLowerCase() === name.toLowerCase());
      return hit ? joinP(dir, hit) : null;
    };
    const claim = p => { if (!p || claimed.has(p.toLowerCase())) return null; claimed.add(p.toLowerCase()); return p; };
    for (const g of groups) {
      const map = new Map((lists.get(g.folder) || []).map(n => [strip(n).toLowerCase(), n]));
      for (const f of g.items) {
        const ids = idsOf(f), want = joinP(g.folder, f.name);
        let rec = null; for (const id of ids) if (index && index[id]) { rec = index[id]; break; }
        let cur = rec ? claim(onDisk(rec.p)) : null;
        if (!cur) {   // not in the index yet (file saved by an older version): find it by its name in the target folder
          let local = null;
          for (const nm of [f.base, ...(f.alts || []).map(x => x.name)]) { if (!nm) continue; local = findLocal(map, nm); if (local && !claimed.has(joinP(g.folder, local).toLowerCase())) break; local = null; }
          cur = local ? claim(joinP(g.folder, local)) : null;
          if (cur) rec = null;
        }
        if (!cur) { out.todo.push({ item: f, folder: g.folder }); continue; }
        const stale = rec && !opt.partial && ((rec.k || 1) < CFG.FILE_SCHEME || (rec.s && f.sig && rec.s !== f.sig));
        if (stale) {   // edited online, or a new version changes the file content: keep the old copy aside, fetch it again
          out.moves.push({ f: cur, t: oldPath(cur, opt.stamp || 'X'), ids: [], archive: true }); out.archived++;
          out.todo.push({ item: f, folder: g.folder });
        } else if (cur !== want && !opt.partial) out.moves.push({ f: cur, t: want, ids, sig: f.sig });
        else out.kept.push({ ids, p: cur, sig: f.sig });
      }
    }
    if (!opt.partial) for (const z of opt.superseded || []) {   // a .zip saved by an earlier version whose files are now unpacked next to it
      let cur = null;
      for (const id of z.ids || []) if (index && index[id]) { cur = claim(onDisk(index[id].p)); if (cur) break; }
      if (!cur && z.base) { const map = new Map((lists.get(z.folder) || []).map(n => [strip(n).toLowerCase(), n])), local = findLocal(map, z.base); if (local) cur = claim(joinP(z.folder, local)); }
      if (cur) { out.moves.push({ f: cur, t: oldPath(cur, opt.stamp || 'X'), ids: [], archive: true }); out.archived++; }
    }
    return out;
  }

  const AIUB = { CFG, versionNewer, idsOf, joinP, splitP, oldPath, reconcile, sanitize, hasExt, extOf, limitName, natural, strip, parsePortalDate, parsePortalSize, normName, similarity, sizeRelation, sameFile, mergeSources, prepareGroup, compose, withTag, srcTag, catOf, seriesOf, findLocal, teamsDir, courseCore, courseTags, semTagOfTitle, semTagFromOption, semRank, matchCourse };
  if (typeof module !== 'undefined' && module.exports) module.exports = AIUB; else root.AIUB = AIUB;
})(typeof self !== 'undefined' ? self : globalThis);
