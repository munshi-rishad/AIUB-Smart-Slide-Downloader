// Run:  node tests/teams.test.js   -- exercises extension/teams.js against a fake SharePoint (no network)
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const HOST = 'https://aiubedu60714.sharepoint.com', SITE = HOST + '/sites/msteams_593da4';
const files = {  // folder path -> { Files, Folders }
  '/sites/msteams_593da4/Shared Documents': { Files: [], Folders: [{ Name: 'General', ServerRelativeUrl: '/sites/msteams_593da4/Shared Documents/General' }, { Name: 'Forms', ServerRelativeUrl: '/sites/msteams_593da4/Shared Documents/Forms' }] },
  '/sites/msteams_593da4/Shared Documents/General': { Files: [
    { Name: 'Module 0-5.pdf', UniqueId: 'id-1', Length: '1000', TimeCreated: '2026-10-25T20:14:00Z', TimeLastModified: '2026-10-25T20:14:00Z' },
    { Name: '~$lock.pptx', UniqueId: 'id-x', Length: '10', TimeCreated: '2026-10-25T20:14:00Z' }],
    Folders: [{ Name: 'Lab', ServerRelativeUrl: '/sites/msteams_593da4/Shared Documents/General/Lab' }] },
  '/sites/msteams_593da4/Shared Documents/General/Lab': { Files: [{ Name: 'Lab 1.zip', UniqueId: 'id-2', Length: '2048', TimeCreated: '2026-10-26T01:00:00Z' }], Folders: [] },
};
let signedIn = false, tabsOpened = 0;
const json = (o, status = 200) => ({ ok: status < 400, status, type: 'basic', headers: { get: () => 'application/json;odata=nometadata' }, json: async () => o });
async function fakeFetch(url) {
  const u = decodeURIComponent(url);
  if (!signedIn) return { ok: false, status: 0, type: 'opaqueredirect', headers: { get: () => '' } };
  if (u.includes('/_api/search/query')) return json({ PrimaryQueryResult: { RelevantResults: { Table: { Rows: [
    { Cells: [{ Key: 'Title', Value: '00942 ADVANCED PROGRAMMING WITH .NET [A][FALL 26-27]' }, { Key: 'Path', Value: SITE }] },
    { Cells: [{ Key: 'Title', Value: 'Unrelated Public Team' }, { Key: 'Path', Value: HOST + '/sites/msteams_ffffff' }] }] } } } });
  if (u.includes('DefaultDocumentLibrary')) return json({ ServerRelativeUrl: '/sites/msteams_593da4/Shared Documents' });
  const m = u.match(/decodedurl='([^']*)'/); if (m) { const f = files[m[1]]; return f ? json(f) : json({}, 404); }
  if (u.includes('/_api/web?')) return json({ Title: 'x' });
  return json({}, 404);
}
const ctx = { console, AbortSignal, fetch: fakeFetch, setTimeout, clearTimeout, URL, Date, Map, Set, Promise, Number, Array, Object, Error, JSON,
  chrome: { tabs: { create: async () => { tabsOpened++; signedIn = ctx.willSignIn; return { id: 1 }; }, onUpdated: { addListener: f => setTimeout(() => f(1, { status: 'complete' }), 5), removeListener() {} }, remove: async () => {} },
    storage: { local: { get: async () => ({ spSites: [] }), set: async () => {} } } } };
ctx.self = ctx; vm.createContext(ctx);
for (const f of ['lib.js', 'teams.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension', f), 'utf8') + (f === 'teams.js' ? '\nthis.Teams = Teams;' : ''), ctx);
(async () => {
  const msg = { courses: ['9004 - ADVANCED PROGRAMMING WITH .NET [A]'], semTag: 'FALL 26-27' };
  ctx.willSignIn = false;
  let r = await ctx.Teams.fetchForCourses(msg);
  assert.strictEqual(r.status, 'noauth'); console.log('ok  not signed in -> noauth (after one silent sign-in attempt, tabs opened: ' + tabsOpened + ')');
  ctx.willSignIn = true; tabsOpened = 0;
  r = await ctx.Teams.fetchForCourses(msg);
  assert.strictEqual(r.status, 'ok'); assert.strictEqual(tabsOpened, 1); console.log('ok  silent sign-in through a background tab works');
  assert.strictEqual(r.results.length, 1, 'only the matching class is read');
  const f = r.results[0].files;
  assert.strictEqual(JSON.stringify(f.map(x => [x.name, x.rel])), JSON.stringify([['Module 0-5.pdf', 'General'], ['Lab 1.zip', 'General/Lab']]));
  assert.strictEqual(f[0].bytes, 1000); assert(f[0].url.endsWith("/_api/web/GetFileById('id-1')/$value"));
  console.log('ok  files listed recursively, lock files and Forms skipped, other classes ignored');
    // semester unknown + same course in two semesters -> only the newest; loose match; unmatched titles reported
  const rows = [
    ['00942 ADVANCED PROGRAMMING WITH .NET [A][SPRING 25-26]', HOST + '/sites/msteams_old001'],
    ['00942 ADVANCED PROGRAMMING WITH .NET [A][FALL 26-27]', SITE],
    ['01461 RESEARCH METHODOLOGY AND ETHICS [P][FALL 26-27]', HOST + '/sites/msteams_rm0001'],
    ['00001 SOMETHING UNRELATED [A][FALL 26-27]', HOST + '/sites/msteams_zz0001']];
  const origFetch = ctx.fetch;
  ctx.fetch = async (url, o) => {
    const u = decodeURIComponent(url);
    if (u.includes('/_api/search/query')) return json({ PrimaryQueryResult: { RelevantResults: { Table: { Rows: rows.map(r => ({ Cells: [{ Key: 'Title', Value: r[0] }, { Key: 'Path', Value: r[1] }] })) } } } });
    if (/msteams_(old001|rm0001)\//.test(u) && u.includes('DefaultDocumentLibrary')) return json({ ServerRelativeUrl: u.match(/\/sites\/[^/]+/)[0] + '/Shared Documents' });
    if (/msteams_(old001|rm0001)\//.test(u) && u.includes('decodedurl')) return json({ Files: [], Folders: [] });
    return origFetch(url, o);
  };
  r = await ctx.Teams.fetchForCourses({ courses: ['9004 - ADVANCED PROGRAMMING WITH .NET [A]', '9003 - RESEARCH METHODOLOGY [P]'], semTag: null });
  assert.strictEqual(r.results.length, 1);   // the 2025-26 class is dropped; the looser name match needs a known semester
  assert.strictEqual(r.results[0].siteTitle, '00942 ADVANCED PROGRAMMING WITH .NET [A][FALL 26-27]');
  console.log('ok  newest semester wins when the semester is unknown');
  r = await ctx.Teams.fetchForCourses({ courses: ['9003 - RESEARCH METHODOLOGY [P]'], semTag: 'FALL 26-27' });
  assert.strictEqual(r.results.length, 1); assert(r.unmatched.some(t => /UNRELATED/.test(t)));
  console.log('ok  looser match inside the semester; unrelated classes are listed as unmatched');
  // Assignments ("Class Files" library) and a private channel (its own site "<class> - <channel>")
  const CH = HOST + '/sites/msteams_593da4-LabGroup';
  const lib = (t, root) => ({ Title: t, RootFolder: { ServerRelativeUrl: root } });
  const extra = {
    '/sites/msteams_593da4/Class Files': { Files: [], Folders: [{ Name: 'Assignment 1', ServerRelativeUrl: '/sites/msteams_593da4/Class Files/Assignment 1' }] },
    '/sites/msteams_593da4/Class Files/Assignment 1': { Files: [{ Name: 'Brief.pdf', UniqueId: 'id-a1', Length: '300', TimeCreated: '2026-10-27T01:00:00Z' }], Folders: [] },
    '/sites/msteams_593da4/Student Work': { Files: [{ Name: 'my-answer.docx', UniqueId: 'id-sw', Length: '5', TimeCreated: '2026-10-27T01:00:00Z' }], Folders: [] },
    '/sites/msteams_593da4-LabGroup/Shared Documents': { Files: [{ Name: 'Lab sheet.pdf', UniqueId: 'id-ch', Length: '77', TimeCreated: '2026-10-27T02:00:00Z' }], Folders: [] },
  };
  ctx.fetch = async (url, o) => {
    const u = decodeURIComponent(url);
    if (u.includes('/_api/search/query')) return json({ PrimaryQueryResult: { RelevantResults: { Table: { Rows: [
      { Cells: [{ Key: 'Title', Value: '00942 ADVANCED PROGRAMMING WITH .NET [A][FALL 26-27]' }, { Key: 'Path', Value: SITE }] },
      { Cells: [{ Key: 'Title', Value: '00942 ADVANCED PROGRAMMING WITH .NET [A][FALL 26-27] - Lab Group' }, { Key: 'Path', Value: CH }] }] } } } });
    if (u.startsWith(SITE + '/_api/web/lists')) return json({ value: [lib('Documents', '/sites/msteams_593da4/Shared Documents'), lib('Class Files', '/sites/msteams_593da4/Class Files'), lib('Student Work', '/sites/msteams_593da4/Student Work')] });
    if (u.startsWith(CH + '/_api/web/lists')) return json({ value: [] });
    if (u.startsWith(CH) && u.includes('DefaultDocumentLibrary')) return json({ ServerRelativeUrl: '/sites/msteams_593da4-LabGroup/Shared Documents' });
    const m = u.match(/decodedurl='([^']*)'/); if (m && extra[m[1]]) return json(extra[m[1]]);
    return origFetch(url, o);
  };
  r = await ctx.Teams.fetchForCourses(msg);
  assert.strictEqual(r.status, 'ok'); assert.strictEqual(r.results.length, 2, 'class site + private channel site');
  const all = r.results.flatMap(x => x.files.map(f => [f.name, f.rel]));
  assert(all.some(([n, rel]) => n === 'Brief.pdf' && rel === 'Assignment files/Assignment 1'), 'assignment files are read: ' + JSON.stringify(all));
  assert(!all.some(([n]) => n === 'my-answer.docx'), 'Student Work (own submissions) is skipped');
  assert(all.some(([n, rel]) => n === 'Lab sheet.pdf' && rel === 'Lab Group'), 'private channel files go into a channel folder: ' + JSON.stringify(all));
  assert.strictEqual(all.filter(([n]) => n === 'Module 0-5.pdf').length, 1, 'the Shared tab library is read once');
  console.log('ok  Assignments files ("Class Files") and private channels are read; Student Work is skipped');
  console.log('\n6 checks passed');
})().catch(e => { console.error(e); process.exit(1); });
