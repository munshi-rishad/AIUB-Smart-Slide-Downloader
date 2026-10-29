// Run:  node tests/lib.test.js        (no packages needed)
const assert = require('assert');
const A = require('../extension/lib.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('portal date is Bangladesh time (UTC+6) -> UTC', () => {
  assert.strictEqual(A.parsePortalDate('07-Oct-26 16:24:35'), Date.UTC(2026, 9, 7, 10, 24, 35));
  assert.strictEqual(A.parsePortalDate('nothing'), Infinity);
});
t('portal size', () => {
  assert.deepStrictEqual(A.parsePortalSize('0.378 Mb'), { v: 0.378, unit: 'mb' });
  assert.deepStrictEqual(A.parsePortalSize('12 bytes'), { v: 12, unit: 'bytes' });
});
t('file names: semester tags and numbers are ignored when comparing', () => {
  assert.strictEqual(A.normName('(Fall_26_27) RM - APA Referencing Style.pdf'), 'rm apa referencing style');
  assert.strictEqual(A.normName('01 - Course Instruction (Fall 26-27).pdf'), 'course instruction');
});
const portal = (name, mb) => ({ name, psize: { v: mb, unit: 'mb' }, ts: 1, src: 'portal' });
const teams = (name, bytes) => ({ name, bytes, ts: 2, src: 'teams' });
t('same file, different names, same size -> duplicate', () => {
  const bytes = Math.round(0.378 * 1048576);
  assert(A.sameFile(portal('(Fall_26_27) RM - APA Referencing Style.pdf', 0.378), teams('APA Referencing Style.pdf', bytes)));
});
t('same name, different size -> NOT a duplicate (different content)', () => {
  assert(!A.sameFile(portal('Lecture 3.pdf', 0.378), teams('Lecture 3.pdf', 5 * 1048576)));
});
t('different numbers are never merged', () => {
  assert(!A.sameFile(teams('Lecture 1.pdf', 1000), teams('Lecture 2.pdf', 1000)));
  assert(!A.sameFile(teams('Module 6-10.pdf', 1000), teams('Module 11-15.pdf', 1000)));
});
t('unknown size needs a very similar name', () => {
  assert(A.sameFile({ name: 'Course Instruction.pdf' }, { name: 'course_instruction.pdf' }));
  assert(!A.sameFile({ name: 'Chapter Slides.pdf' }, { name: 'Totally Different Notes.pdf' }));
});
t('different extensions are different files', () => {
  assert(!A.sameFile(teams('Report.pdf', 100), teams('Report.docx', 100)));
});
t('merge keeps the portal copy and the earliest time', () => {
  const p = portal('Course Instruction (Fall 26-27).pdf', 0.268); p.ts = 500;
  const tm = teams('Course Instruction.pdf', Math.round(0.268 * 1048576)); tm.ts = 100;
  const r = A.mergeSources([p, tm, teams('Extra.pptx', 5)]);
  assert.strictEqual(r.items.length, 2); assert.strictEqual(r.dups, 1);
  assert.strictEqual(r.items[0].src, 'portal'); assert.strictEqual(r.items[0].ts, 100); assert.strictEqual(r.items[0].alts.length, 1);
});
t('numbering: oldest = 01, equal times by name, duplicate names get (2)', () => {
  const g = A.prepareGroup([{ name: 'b.pdf', ts: 30 }, { name: '02_x.pptx', ts: 10 }, { name: '01_x.pptx', ts: 10 }, { name: 'b.pdf', ts: 40 }]);
  
});
t('local files are found with or without a number', () => {
  const m = new Map([['a.pdf', '03 - a.pdf'], ['notes.docx', 'Notes.docx']].map(([k, v]) => [k, v]));
  assert.strictEqual(A.findLocal(m, 'A.pdf'), '03 - a.pdf');
  assert.strictEqual(A.strip('03 - A (TEAMS).PDF'), 'A.PDF'); assert.strictEqual(A.strip('03 - A (Teams ZIP).pdf'), 'A.pdf'); assert.strictEqual(A.strip('A (Portal+Teams).pdf'), 'A.pdf');
  assert.strictEqual(A.findLocal(m, 'Notes'), 'Notes.docx');
  assert.strictEqual(A.findLocal(m, 'zzz.pdf'), null);
});
t('Teams folders -> local sub-folders (General is the course folder itself)', () => {
  assert.strictEqual(A.teamsDir(''), ''); assert.strictEqual(A.teamsDir('General'), '');
  assert.strictEqual(A.teamsDir('General/Lab 1/Week: 2'), 'Lab 1/Week 2');
  assert.strictEqual(A.teamsDir('Class Materials'), 'Class Materials');
});
t('Teams class <-> portal course', () => {
  const portalTitles = ['9001 - DATA WAREHOUSING AND DATA MINING [B]', '9002 - OPERATING SYSTEM [D]', '9003 - RESEARCH METHODOLOGY [P]', '9004 - ADVANCED PROGRAMMING WITH .NET [A]'];
  const m = (title, sem) => { const r = A.matchCourse(title, portalTitles, sem); return r && r.course; };
  assert.strictEqual(m('01263 DATA WAREHOUSING AND DATA MINING [CS][B][FALL 26-27]', 'FALL 26-27'), portalTitles[0]);
  assert.strictEqual(m('01416 OPERATING SYSTEM [D][FALL 26-27]', 'FALL 26-27'), portalTitles[1]);
  assert.strictEqual(m('01461 RESEARCH METHODOLOGY [P][FALL 26-27]', 'FALL 26-27'), portalTitles[2]);
  assert.strictEqual(m('00942 ADVANCED PROGRAMMING WITH .NET [A][FALL 26-27]', 'FALL 26-27'), portalTitles[3]);
  assert.strictEqual(m('01461 RESEARCH METHODOLOGY [P][SPRING 25-26]', 'FALL 26-27'), null);   // old semester
  assert.strictEqual(m('00001 SOMETHING ELSE ENTIRELY [A][FALL 26-27]', 'FALL 26-27'), null);
  assert.strictEqual(A.semTagFromOption('2026 - 2027, Fall'), 'FALL 26-27');
});
t('looser second-chance match only inside the right semester', () => {
  const courses = ['9004 - ADVANCED PROGRAMMING WITH .NET [A]'];
  const title = '00942 ADVANCED PROGRAMMING WITH ASP.NET CORE [A][FALL 26-27]';
  assert.strictEqual(A.matchCourse(title, courses, 'FALL 26-27'), null);                          // normal rule: too different
  assert.strictEqual(A.matchCourse(title, courses, 'FALL 26-27', A.CFG.COURSE_SIM_LOOSE).course, courses[0]);
  assert.strictEqual(A.matchCourse(title, courses, null, A.CFG.COURSE_SIM_LOOSE), null);         // semester unknown: no guessing
  assert.strictEqual(A.matchCourse(title.replace('FALL', 'SPRING'), courses, 'FALL 26-27', A.CFG.COURSE_SIM_LOOSE), null);
});
t('semester order: newer is bigger', () => {
  assert(A.semRank('FALL 26-27') > A.semRank('SUMMER 25-26'));
  assert(A.semRank('SPRING 26-27') > A.semRank('FALL 26-27'));
  assert.strictEqual(A.semRank('nonsense'), 0);
});
t('numbering can be switched off (names stay original, duplicates still get (2))', () => {
  const g = A.prepareGroup([{ name: 'b.pdf', ts: 2 }, { name: 'a.pdf', ts: 1 }, { name: 'b.pdf', ts: 3 }], false);
  assert.deepStrictEqual(g.map(f => f.name), ['A.PDF', 'B.PDF', 'B (2).PDF']);
});
const names = (arr) => A.prepareGroup(arr.map((x, i) => ({ name: x[0], ts: x[1] === undefined ? i : x[1], src: x[2] || 'teams' }))).map(f => f.name);
t('content order: modules by number (0-5 first), numbered slides after, labs, then exams, then other', () => {
  const r = names([['Module 6-10.pdf'], ['Module 11-15.pdf'], ['Module 0-5.pdf'], ['Module 16-20.pdf'], ['Module 21-25.pdf'], ['01_DotNet_Intro.pptx'], ['02_Routing.pptx']]);
  assert.deepStrictEqual(r, ['01 - MODULE 0-5 (TEAMS).PDF', '02 - MODULE 6-10 (TEAMS).PDF', '03 - MODULE 11-15 (TEAMS).PDF', '04 - MODULE 16-20 (TEAMS).PDF', '05 - MODULE 21-25 (TEAMS).PDF', '06 - 01_DOTNET_INTRO (TEAMS).PPTX', '07 - 02_ROUTING (TEAMS).PPTX']);
});
t('content order: outline first, chapters in order, labs, exam material, samples last', () => {
  const r = names([['LAB 2.pdf'], ['Ch3 - Processes.pdf'], ['Midterm Materials.zip'], ['Five_Sample_Memos.pdf'], ['ch4 - Threads.pdf'], ['LAB 1.pdf'], ['Ch1 - Intro.pdf'], ['Summer 25-26 CSC 3214 Operating System_Updated.pdf'], ['Course Instruction (Fall 26-27).pdf']]);
  assert.deepStrictEqual(r.map(x => x.replace(/^\d+ - /, '').replace(/ \(TEAMS\)/, '')), ['SUMMER 25-26 CSC 3214 OPERATING SYSTEM_UPDATED.PDF', 'COURSE INSTRUCTION (FALL 26-27).PDF', 'CH1 - INTRO.PDF', 'CH3 - PROCESSES.PDF', 'CH4 - THREADS.PDF', 'LAB 1.PDF', 'LAB 2.PDF', 'MIDTERM MATERIALS.ZIP', 'FIVE_SAMPLE_MEMOS.PDF']);
});
t('unnumbered slides keep upload order', () => {
  const r = names([['Intro to Data Mining.pptx', 5], ['Classification KNN.pptx', 9], ['Naive Bayes.ppt', 7]]);
  assert.deepStrictEqual(r.map(x => x.slice(5)), ['INTRO TO DATA MINING (TEAMS).PPTX', 'NAIVE BAYES (TEAMS).PPT', 'CLASSIFICATION KNN (TEAMS).PPTX']);
});
t('source tags: portal, teams, both, zip', () => {
  assert.strictEqual(A.srcTag({ src: 'portal', alts: [] }), 'Portal');
  assert.strictEqual(A.srcTag({ src: 'portal', alts: [{ src: 'teams' }] }), 'Portal+Teams');
  assert.strictEqual(A.srcTag({ src: 'teams', zip: {}, alts: [] }), 'Teams ZIP');
  assert.strictEqual(A.compose('03', 'Lecture 1.pdf', 'Teams ZIP'), '03 - LECTURE 1 (TEAMS ZIP).PDF');
});
t('version compare', () => {
  assert(A.versionNewer('10.1', '9.9')); assert(A.versionNewer('9.10', '9.9')); assert(!A.versionNewer('9.9', '9.9')); assert(!A.versionNewer('9.8', '9.9')); assert(!A.versionNewer('abc', '9.9')); assert(A.versionNewer('9.9.1', '9.9'));
});

/* ---------- saved files follow a new version (identity index) ---------- */
const item = (name, id, sig, extra) => Object.assign({ name, id, sig, ts: 1, src: 'portal', alts: [] }, extra || {});
const prep = items => A.prepareGroup(items, true);
t('a file saved by an older version is found by its name and renamed to the new style', () => {
  const g = [{ folder: 'Course', items: prep([item('Lecture 1.pdf', 'p:1', 's1')]) }];
  const r = A.reconcile(g, { Course: ['01 - Lecture 1 (Portal).pdf'] }, {}, { stamp: 'D' });
  assert.strictEqual(r.moves.length, 1); assert.strictEqual(r.moves[0].f, 'Course/01 - Lecture 1 (Portal).pdf'); assert.strictEqual(r.moves[0].t, 'Course/01 - LECTURE 1 (PORTAL).PDF');
  assert.strictEqual(r.todo.length, 0);
});
t('with the index a file follows ANY change: other folder, other name scheme', () => {
  const g = [{ folder: 'Research Methodology/Week 1', items: prep([item('Slides.pdf', 't:abc', 'b10', { src: 'teams' })]) }];
  const idx = { 't:abc': { p: 'RM [P]/[PORTAL] slides v9 style.pdf', s: 'b10', k: 1 } };
  const r = A.reconcile(g, { 'Research Methodology/Week 1': [], 'RM [P]': ['[PORTAL] slides v9 style.pdf'] }, idx, { stamp: 'D' });
  assert.strictEqual(r.moves.length, 1); assert.strictEqual(r.moves[0].f, 'RM [P]/[PORTAL] slides v9 style.pdf'); assert.strictEqual(r.moves[0].t, 'Research Methodology/Week 1/01 - SLIDES (TEAMS).PDF');
  assert.strictEqual(r.todo.length, 0, 'never downloaded twice');
});
t('already right: nothing moves; deleted by the person: downloaded again', () => {
  const g = [{ folder: 'C', items: prep([item('A.pdf', 'p:a', 's'), item('B.pdf', 'p:b', 's')]) }];
  const r = A.reconcile(g, { C: ['01 - A (PORTAL).PDF'] }, { 'p:b': { p: 'C/02 - B (PORTAL).PDF', s: 's', k: 1 } }, {});
  assert.strictEqual(r.moves.length, 0); assert.strictEqual(r.kept.length, 1); assert.strictEqual(r.todo.length, 1); assert.strictEqual(r.todo[0].item.base, 'B.pdf');
});
t('edited online (other size): old copy goes to "_Old versions", the new one is downloaded', () => {
  const g = [{ folder: 'C', items: prep([item('A.pdf', 'p:a', 'p2mb')]) }];
  const r = A.reconcile(g, { C: ['01 - A (PORTAL).PDF'] }, { 'p:a': { p: 'C/01 - A (PORTAL).PDF', s: 'p1mb', k: 1 } }, { stamp: '2026-10-29' });
  assert.strictEqual(r.archived, 1); assert.strictEqual(r.moves[0].t, '_Old versions/C/01 - A (PORTAL) (OLD 2026-10-29).PDF'); assert.strictEqual(r.todo.length, 1);
});
t('FILE_SCHEME raised by a new version: every file is fetched again once', () => {
  const g = [{ folder: 'C', items: prep([item('A.pdf', 'p:a', 's')]) }];
  A.CFG.FILE_SCHEME = 2;
  const r = A.reconcile(g, { C: ['01 - A (PORTAL).PDF'] }, { 'p:a': { p: 'C/01 - A (PORTAL).PDF', s: 's', k: 1 } }, { stamp: 'D' });
  A.CFG.FILE_SCHEME = 1;
  assert.strictEqual(r.archived, 1); assert.strictEqual(r.todo.length, 1);
});
t('incomplete data (Teams error): nothing is moved or replaced, missing files still download', () => {
  const g = [{ folder: 'C', items: prep([item('A.pdf', 'p:a', 'new'), item('B.pdf', 'p:b', 's')]) }];
  const r = A.reconcile(g, { C: ['07 - A (PORTAL).PDF'] }, { 'p:a': { p: 'C/07 - A (PORTAL).PDF', s: 'old', k: 1 } }, { partial: true });
  assert.strictEqual(r.moves.length, 0); assert.strictEqual(r.todo.length, 1); assert.strictEqual(r.todo[0].item.base, 'B.pdf');
});
t('an unpacked .zip saved earlier moves to "_Old versions"', () => {
  const g = [{ folder: 'C/Midterm', items: prep([item('Q1.pdf', 'z:p:zip#Q1.pdf', 'u1')]) }];
  const r = A.reconcile(g, { C: ['03 - MIDTERM (PORTAL).ZIP'], 'C/Midterm': [] }, {}, { stamp: 'D', superseded: [{ folder: 'C', base: 'Midterm.zip', ids: ['p:zip'] }] });
  assert.strictEqual(r.archived, 1); assert.strictEqual(r.moves[0].f, 'C/03 - MIDTERM (PORTAL).ZIP'); assert(r.moves[0].t.startsWith('_Old versions/C/'));
});
t('two online files never claim the same local file', () => {
  const g = [{ folder: 'C', items: prep([item('A.pdf', 'p:1', 's'), item('A.pdf', 'p:2', 's')]) }];
  const r = A.reconcile(g, { C: ['01 - A (PORTAL).PDF'] }, {}, {});
  assert.strictEqual(r.kept.length + r.moves.length, 1); assert.strictEqual(r.todo.length, 1);
});
console.log(`\n${n} tests passed`);
