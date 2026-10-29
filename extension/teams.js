/* ==========================================================================
   Microsoft Teams files (service worker only; loaded with importScripts from background.js)

   Teams keeps every class's "Shared" files in a SharePoint document library, so no Teams
   password, token or Microsoft Graph app is needed: the extension simply reads SharePoint's
   REST API with the cookies of the Chrome profile that is already signed in to Teams.
   Read-only: this file never changes anything on SharePoint.
   ========================================================================== */
class SpAuthError extends Error {}

const Teams = (() => {
  const ORIGIN = () => 'https://' + AIUB.CFG.SP_HOST;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const enc = s => encodeURIComponent(String(s).replace(/'/g, "''")).replace(/%2F/gi, '/');   // value inside OData '...'

  async function spJson(url, rootCheck) {
    let r;
    for (let attempt = 0; ; attempt++) {
      try { r = await fetch(url, { credentials: 'include', redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json;odata=nometadata' } }); }
      catch (e) {
        if (attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }   // internet blip: try again
        throw new Error('cannot reach SharePoint (' + e.message + ')');
      }
      if ((r.status === 429 || r.status === 503) && attempt < 3) {          // SharePoint asks us to slow down
        const ra = Number(r.headers.get('retry-after'));
        await sleep((ra > 0 ? Math.min(ra, 20) : 2 + attempt * 2) * 1000); continue;
      }
      break;
    }
    // not signed in: SharePoint redirects to the Microsoft login page (or answers 401)
    if (r.type === 'opaqueredirect' || r.status === 0 || r.status === 401 || (rootCheck && r.status === 403)) throw new SpAuthError('not signed in');
    if (!r.ok) throw new Error('SharePoint answered ' + r.status);
    if (!/json/i.test(r.headers.get('content-type') || '')) throw new SpAuthError('not signed in');
    return r.json();
  }

  // Visiting SharePoint once (in a background tab) lets Microsoft's single sign-on set its cookies.
  async function warmUp() {
    let tab;
    try { tab = await chrome.tabs.create({ url: ORIGIN() + '/_layouts/15/sharepoint.aspx', active: false }); } catch (e) { return; }
    await new Promise(res => {
      const done = () => { clearTimeout(to); chrome.tabs.onUpdated.removeListener(on); res(); };
      const on = (id, info) => { if (id === tab.id && info.status === 'complete') done(); };
      const to = setTimeout(done, 20000);
      chrome.tabs.onUpdated.addListener(on);
    });
    await sleep(2500);   // let the sign-in redirects finish
    try { await chrome.tabs.remove(tab.id); } catch (e) {}
  }
  async function ensureSession() {
    const probe = () => spJson(ORIGIN() + '/_api/web?$select=Title', true);
    try { await probe(); return; } catch (e) { if (!(e instanceof SpAuthError)) throw e; }
    await warmUp();
    await probe();   // still not signed in -> SpAuthError reaches the caller
  }

  function searchRows(j) {
    const t = j && j.PrimaryQueryResult && j.PrimaryQueryResult.RelevantResults && j.PrimaryQueryResult.RelevantResults.Table;
    let rows = (t && t.Rows) || []; rows = rows.results || rows;
    return rows.map(r => { const o = {}; for (const c of (r.Cells.results || r.Cells)) o[c.Key] = c.Value; return o; });
  }
  // every Teams class site this person can open: SharePoint search + sites the person opened in Teams before
  async function discoverSites() {
    const found = new Map();
    const add = (url, title) => { const k = url.replace(/\/+$/, '').toLowerCase(); if (!found.has(k) || (title && !found.get(k).title)) found.set(k, { url: url.replace(/\/+$/, ''), title: title || '' }); };
    try {
      const j = await spJson(`${ORIGIN()}/_api/search/query?querytext='${encodeURIComponent('contentclass:STS_Site')}'&selectproperties='Title,Path'&rowlimit=500&trimduplicates=false`);
      for (const r of searchRows(j)) if (r.Path && /\/sites\/msteams_/i.test(r.Path) && r.Path.toLowerCase().startsWith(ORIGIN().toLowerCase())) add(r.Path, r.Title);
    } catch (e) { if (e instanceof SpAuthError) throw e; }
    try {
      const { spSites = [] } = await chrome.storage.local.get('spSites');
      for (const u of spSites) add(u, '');
    } catch (e) {}
    await pool([...found.values()].filter(s => !s.title), 6, async s => {
      try { s.title = (await spJson(s.url + '/_api/web?$select=Title')).Title || ''; } catch (e) { if (e instanceof SpAuthError) throw e; }
    });
    return [...found.values()].filter(s => s.title);
  }

  // every visible document library of a class site: "Shared Documents" (the Shared tab), "Class Files" (files the teacher
  // attaches to Assignments) and any other library. "Student Work" (your own submissions) and system libraries are skipped.
  const SKIP_LIBS = /^(student work|site assets|style library|form templates|site pages|teams wiki data|preservation hold library|documents?\s*-\s*archived?)$/i;
  const LIB_DIR = { 'class files': 'Assignment files' };   // local sub-folder name for a library (the Shared tab library has none)
  async function libraries(site) {
    try {
      const j = await spJson(`${site.url}/_api/web/lists?$filter=BaseTemplate eq 101 and Hidden eq false&$select=Title,RootFolder/ServerRelativeUrl&$expand=RootFolder`);
      return (j.value || []).filter(l => l.RootFolder && l.RootFolder.ServerRelativeUrl && !SKIP_LIBS.test(String(l.Title || '').trim()))
        .map(l => ({ title: String(l.Title).trim(), root: l.RootFolder.ServerRelativeUrl }));
    } catch (e) { if (e instanceof SpAuthError) throw e; return []; }
  }

  // every file of the site's libraries, folders included
  async function listFiles(site) {
    const out = [];
    let rootUrl;
    try { rootUrl = (await spJson(`${site.url}/_api/web/DefaultDocumentLibrary/RootFolder?$select=ServerRelativeUrl`)).ServerRelativeUrl; }
    catch (e) { if (e instanceof SpAuthError) throw e; }
    if (!rootUrl) rootUrl = new URL(site.url).pathname.replace(/\/+$/, '') + '/Shared Documents';
    const sel = '$select=Files/Name,Files/UniqueId,Files/Length,Files/TimeCreated,Files/TimeLastModified,Files/ServerRelativeUrl,Folders/Name,Folders/ServerRelativeUrl&$expand=Files,Folders';
    async function walk(path, rel, depth) {
      let j;
      try { j = await spJson(`${site.url}/_api/web/GetFolderByServerRelativePath(decodedurl='${enc(path)}')?${sel}`); }
      catch (e) { if (e instanceof SpAuthError) throw e; j = await spJson(`${site.url}/_api/web/GetFolderByServerRelativeUrl('${enc(path)}')?${sel}`); }
      for (const f of j.Files || []) {
        if (/^~\$|\.tmp$/i.test(f.Name) || out.length >= 3000) continue;
        out.push({ name: f.Name, rel, bytes: Number(f.Length), ts: Date.parse(f.TimeCreated) || Date.parse(f.TimeLastModified) || Infinity,
          uid: String(f.UniqueId || '').toLowerCase(), mod: Date.parse(f.TimeLastModified) || 0,   // uid: stays the same when the file is renamed or moved
          url: `${site.url}/_api/web/GetFileById('${f.UniqueId}')/$value` });
      }
      if (depth >= 8) return;
      await Promise.all((j.Folders || []).filter(d => !(d.Name.startsWith('_') || (depth === 0 && d.Name === 'Forms')))   // not SharePoint's own system folders
        .map(d => walk(d.ServerRelativeUrl, rel ? rel + '/' + d.Name : d.Name, depth + 1)));   // all sub-folders at the same time
    }
    const pre = site.channel ? site.channel : '';   // a private channel has its own site: its files go into a folder named like the channel
    await walk(rootUrl, pre, 0);   // the Shared tab: a failure here is a real error (reported, nothing is renumbered)
    const done = new Set([rootUrl.toLowerCase()]);
    for (const lib of await libraries(site)) {
      if (done.has(lib.root.toLowerCase())) continue; done.add(lib.root.toLowerCase());
      const dir = LIB_DIR[lib.title.toLowerCase()] || lib.title;
      try { await walk(lib.root, pre ? pre + '/' + dir : dir, 0); }
      catch (e) { if (e instanceof SpAuthError) throw e; if (!/answered (401|403|404)/.test(e.message)) throw e; }   // a library you may not open is simply skipped
    }
    return out;
  }

  async function pool(list, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const x = list[i++]; await fn(x); } }));
  }

  // msg: { courses: [portal course titles], semTag: "FALL 26-27" | null }
  async function fetchForCourses(msg) {
    try {
      await ensureSession();
      const sites = await discoverSites();
      const courses = msg.courses || [];
      let wanted = [];
      // a private channel has its own site titled "<class> - <channel>": matched by the class part, files go into a <channel> folder
      const match = (s, list, min) => {
        let m = AIUB.matchCourse(s.title, list, msg.semTag, min);
        if (m) return m;
        const i = s.title.lastIndexOf(' - ');
        if (i > 0 && /\/sites\/msteams_[^/]*-[^/]+$/i.test(s.url)) { m = AIUB.matchCourse(s.title.slice(0, i), list, msg.semTag, min); if (m) s.channel = AIUB.sanitize(s.title.slice(i + 3)).slice(0, 60); }
        return m;
      };
      for (const s of sites) { const m = match(s, courses); if (m) wanted.push({ site: s, course: m.course }); }
      // second chance: a course that found no class + a class that matched nothing -> looser name match (same semester only)
      const need = courses.filter(c => !wanted.some(w => w.course === c));
      for (const s of sites) {
        if (!need.length || wanted.some(w => w.site === s)) continue;
        const m = match(s, need, AIUB.CFG.COURSE_SIM_LOOSE);
        if (m) { wanted.push({ site: s, course: m.course }); need.splice(need.indexOf(m.course), 1); }
      }
      if (!msg.semTag) {   // semester unknown: when a course has classes from several semesters, only the newest one counts
        const best = {};
        for (const w of wanted) best[w.course] = Math.max(best[w.course] || 0, AIUB.semRank(AIUB.semTagOfTitle(w.site.title)));
        wanted = wanted.filter(w => AIUB.semRank(AIUB.semTagOfTitle(w.site.title)) === best[w.course]);
      }
      const unmatched = sites.filter(s => !wanted.some(w => w.site === s)).map(s => s.title).slice(0, 20);
      const results = [];
      await pool(wanted, 6, async w => {
        try { results.push({ course: w.course, siteTitle: w.site.title, files: await listFiles(w.site) }); }
        catch (e) { if (e instanceof SpAuthError) throw e; results.push({ course: w.course, siteTitle: w.site.title, files: [], err: e.message }); }
      });
      return { status: 'ok', results, sites: sites.length, unmatched };
    } catch (e) {
      return e instanceof SpAuthError ? { status: 'noauth' } : { status: 'error', err: e.message };
    }
  }

  // remember classes the person opens in Teams (extra safety net if SharePoint search misses one)
  async function learnSite(url) {
    try {
      if (!/^https:\/\/[^/]+\/sites\/msteams_[^/]+$/i.test(url) || !url.toLowerCase().startsWith(ORIGIN().toLowerCase())) return;
      const { spSites = [] } = await chrome.storage.local.get('spSites');
      if (!spSites.some(u => u.toLowerCase() === url.toLowerCase())) await chrome.storage.local.set({ spSites: [...spSites, url].slice(-60) });
    } catch (e) {}
  }

  return { fetchForCourses, learnSite, listFiles, discoverSites };
})();
