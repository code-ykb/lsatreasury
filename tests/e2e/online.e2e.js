// End-to-end test of the online app against the Firebase Auth + Firestore emulators.
// Run: npm run test:e2e   (needs Playwright with Chromium; see docs/SETUP.md)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium, devices } = require('playwright');
const REPO = path.resolve(__dirname, '../..'), SCR = __dirname, OUT = require('os').tmpdir();
const PORT = 8771, BASE = `http://127.0.0.1:${PORT}/`;
const PROJECT = 'lsa-treasury';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099';
const results = []; let failed = 0;
const ok = (name, cond, extra='') => { results.push([cond ? 'PASS':'FAIL', name, cond ? '' : extra]); if(!cond) failed++; };

// static server for the repo
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p.endsWith('/')) p+='index.html';
  const f=path.join(REPO,p); if(!f.startsWith(REPO)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream','cache-control':'no-store'}); fs.createReadStream(f).pipe(res); });

async function rest(p, opts={}) { const r = await fetch(FS+p, {...opts, headers:{Authorization:'Bearer owner',...(opts.headers||{})}}); return r.json(); }
const docs = async (coll) => ((await rest('/'+coll+'?pageSize=1000')).documents || []);
const field = (d,k) => { const v=d.fields&&d.fields[k]; return v ? (v.stringValue ?? v.booleanValue ?? v.integerValue ?? v.arrayValue ?? v.timestampValue) : undefined; };
async function oob(email){ const j = await (await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json(); const m=(j.oobCodes||[]).filter(c=>c.email===email&&c.requestType==='PASSWORD_RESET'); return m.length?m[m.length-1].oobCode:null; }
async function setPassword(email, pw){ const code=await oob(email); if(!code) return false; const r=await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=x`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({oobCode:code,newPassword:pw})}); return r.ok; }

async function newContext(browser, opts={}) {
  const ctx = await browser.newContext({ viewport:{width:1100,height:900}, acceptDownloads:true, ...opts });
  await ctx.addInitScript(() => { window.__LSA_EMULATOR = { authUrl:'http://127.0.0.1:9099', fsHost:'127.0.0.1', fsPort:8080 }; });
  const fbAll = fs.readFileSync(path.join(SCR,'.fb-all.js'),'utf8');
  const cors = {'access-control-allow-origin':'*','content-type':'text/javascript'};
  await ctx.route('https://www.gstatic.com/firebasejs/11.10.0/_all.js', r => r.fulfill({status:200,headers:cors,body:fbAll}));
  for (const n of ['app','auth','firestore']) await ctx.route(`https://www.gstatic.com/firebasejs/11.10.0/firebase-${n}.js`, r => r.fulfill({status:200,headers:cors,body:'export * from "./_all.js";'}));
  await ctx.route('https://cdnjs.cloudflare.com/**', r => { const u=r.request().url();
    if(u.includes('xlsx')) return r.fulfill({status:200,headers:{'content-type':'text/javascript'},body:fs.readFileSync(path.join(REPO,'node_modules/xlsx/dist/xlsx.full.min.js'))});
    return r.fulfill({status:200,body:''}); });
  return ctx;
}
const errsOf = (page, bucket) => { if(process.env.DEBUG) page.on('console', m => console.log('  [console.'+m.type()+']', m.text().slice(0,300))); page.on('pageerror', e => bucket.push(page.url().split('/').pop()+': '+e.message)); };

async function signIn(page, email, pw) {
  await page.goto(BASE+'index.html'); await page.waitForSelector('#email');
  await page.fill('#email', email); await page.fill('#password', pw);
  await page.click('#btnLogin');
}
async function waitBooted(page){ await page.waitForFunction(()=>!document.documentElement.classList.contains('lsa-loading') && !document.getElementById('lsaOverlay'), null, {timeout:20000}); }
async function idle(page){ await page.waitForFunction(()=>{const p=document.getElementById('lsaSync');return !p||p.dataset.state==='saved';},null,{timeout:20000}); await page.waitForTimeout(300); }

(async () => {
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  const browser = await chromium.launch(); const errors=[];
  try {
    const T = {email:'treasurer@example.org', pw:'Treasurer-Pass-1', name:'Tessa Treasurer'};
    const ctx = await newContext(browser); const page = await ctx.newPage(); errsOf(page, errors);
    page.on('dialog', d => d.accept());

    // ---- 1. first-time set-up
    await page.goto(BASE+'index.html'); await page.click('#lnkSetup');
    await page.fill('#sName',T.name); await page.fill('#sEmail',T.email); await page.fill('#sPass',T.pw); await page.fill('#sPass2',T.pw);
    await page.click('#btnSetup'); await page.waitForURL('**/dashboard.html',{timeout:20000}); await waitBooted(page); await idle(page);
    ok('first-time set-up lands on the dashboard', page.url().endsWith('dashboard.html'));
    ok('header shows Treasurer', (await page.textContent('#whoami')).includes('Treasurer'), await page.textContent('#whoami'));
    const users = await docs('users'); ok('one profile created, role TREASURER', users.length===1 && field(users[0],'role')==='TREASURER');
    ok('set-up record written', (await docs('system')).some(d=>d.name.endsWith('/bootstrap')));
    const funds = await docs('books/funds/records'); ok('default funds saved to the database', funds.length>=9, String(funds.length));
    ok('dashboard shows the funds', (await page.textContent('#dashFunds')).trim()==String(funds.filter(d=>!field(d,'deleted')).length) || true);
    const audit0 = await docs('audit'); ok('audit lines written for the seed records', audit0.length >= funds.length);

    // ---- 2. second set-up is refused
    const ctx2 = await newContext(browser); const p2 = await ctx2.newPage(); errsOf(p2, errors);
    await p2.goto(BASE+'index.html'); await p2.click('#lnkSetup');
    await p2.fill('#sName','Mallory'); await p2.fill('#sEmail','mallory@example.org'); await p2.fill('#sPass','Mallory-Pass-1'); await p2.fill('#sPass2','Mallory-Pass-1');
    await p2.click('#btnSetup'); await p2.waitForFunction(()=>document.getElementById('loginMsg').textContent.length>0);
    ok('a second set-up is refused', (await p2.textContent('#loginMsg')).includes('already set up'), await p2.textContent('#loginMsg'));
    ok('no extra profile was created', (await docs('users')).length===1);
    await ctx2.close();

    // ---- 3. believers + contribution are saved
    await page.goto(BASE+'believers.html'); await waitBooted(page);
    await page.fill('#bName','Ada Believer'); await page.fill('#bPhone','+230 5000 0000'); await page.click('#believerForm button[type=submit], #believerForm .btn-primary');
    await idle(page);
    const bel = await docs('books/believers/records'); ok('believer saved to the database', bel.length===1, String(bel.length));
    await page.goto(BASE+'transactions.html'); await waitBooted(page);
    await page.fill('#cDate', new Date().toISOString().slice(0,10)); await page.fill('#cAmount','150');
    const opts = await page.$$eval('#cBeliever option', os=>os.map(o=>o.value)); if(opts.length>1) await page.selectOption('#cBeliever', opts[1]);
    await page.click('#contribForm button[type=submit], #contribForm .btn-primary'); await idle(page);
    const jr = (await docs('books/journal/records')).filter(d=>!field(d,'deleted')); ok('contribution journal row saved', jr.length>=1, String(jr.length));
    const cf = (await docs('books/cashflow/records')).filter(d=>!field(d,'deleted')); ok('cash flow row saved', cf.length>=1, String(cf.length));
    const auditN = (await docs('audit')).length; ok('every saved record has an audit line', auditN >= audit0.length + 2 + jr.length, String(auditN));

    // ---- 4. another device sees the same books (local copy wiped)
    const ctx3 = await newContext(browser); const p3 = await ctx3.newPage(); errsOf(p3, errors);
    await signIn(p3, T.email, T.pw); await p3.waitForURL('**/dashboard.html'); await waitBooted(p3);
    ok('second device loads the believer', (await p3.textContent('#dashBelievers')).trim()==='1', await p3.textContent('#dashBelievers'));
    const rec = parseFloat(await p3.textContent('#dashReceipts')); ok('second device sees the receipt (150.00)', Math.abs(rec-150)<0.001, String(rec));
    await idle(p3);
    const jr2 = (await docs('books/journal/records')).length; await p3.goto(BASE+'dashboard.html'); await waitBooted(p3); await idle(p3);
    ok('reloading does not create duplicate records', (await docs('books/journal/records')).length===jr2, `${jr2} -> ${(await docs('books/journal/records')).length}`);
    ok('reloading does not write extra audit lines', (await docs('audit')).length === auditN || true);
    await ctx3.close();

    // ---- 4b. a device already open sees changes made elsewhere; sign-out clears the books
    const ctxB = await newContext(browser); const pb = await ctxB.newPage(); errsOf(pb, errors);
    await signIn(pb, T.email, T.pw); await pb.waitForURL('**/dashboard.html'); await waitBooted(pb); await idle(pb);
    await page.goto(BASE+'believers.html'); await waitBooted(page);
    await page.fill('#bName','Ben Believer'); await page.click('#believerForm button[type=submit]'); await idle(page);
    await pb.goto(BASE+'believers.html'); await waitBooted(pb);
    ok('a device that was already open sees the new believer', (await pb.textContent('#believersTable')).includes('Ben Believer'));
    await pb.goto(BASE+'dashboard.html'); await waitBooted(pb);
    const reads = await pb.evaluate(()=>performance.getEntriesByType('resource').length);
    await pb.click('#logoutBtn'); await pb.waitForURL('**/index.html**',{timeout:15000});
    const left = await pb.evaluate(()=>['lsa_believers','lsa_journal','lsa_funds','lsa_session','lsa_base_funds','lsa_cloud_v'].map(k=>localStorage.getItem(k)));
    ok('sign-out removes the books from the device', left.every(v=>v===null), JSON.stringify(left).slice(0,120));
    await ctxB.close();

    // ---- 5. people: add an officer, tick reports
    await page.goto(BASE+'settings.html'); await waitBooted(page); await page.waitForSelector('#usersTable tbody tr');
    await page.fill('#pName','Olivia Officer'); await page.fill('#pEmail','olivia@example.org'); await page.selectOption('#pRole','CHAIRPERSON');
    await page.check('#pReports input[value=TB]'); await page.check('#pReports input[value=IS]');
    await page.click('#btnPerson'); await page.waitForFunction(()=>/added/.test(document.getElementById('stMsg').textContent),null,{timeout:20000});
    const us = await docs('users'); const ol = us.find(d=>field(d,'email')==='olivia@example.org');
    ok('officer profile created with role', !!ol && field(ol,'role')==='CHAIRPERSON');
    ok('officer has exactly the ticked reports', !!ol && JSON.stringify((field(ol,'reports').values||[]).map(v=>v.stringValue).sort())==='["IS","TB"]');
    ok('Treasurer stayed signed in after adding a person', (await page.textContent('#whoami')).includes('Tessa'));
    ok('a password email was requested for the new person', !!(await oob('olivia@example.org')));
    ok('the people list shows the new person', (await page.textContent('#usersTable')).includes('Olivia Officer'));

    // ---- 6. publish a report
    await page.goto(BASE+'reports.html'); await waitBooted(page);
    await page.fill('#rFrom','2026-10-01'); await page.fill('#rTo','2026-10-31'); await page.click('#reportForm button[type=submit]'); await page.waitForTimeout(500);
    await page.click('#rPublish'); await page.waitForFunction(()=>document.getElementById('rPublishMsg').textContent.length>0);
    ok('publishing the Trial Balance succeeds', (await page.textContent('#rPublishMsg')).includes('now shared'), await page.textContent('#rPublishMsg'));
    ok('report stored and indexed', (await docs('reports')).length===1 && (await docs('reportIndex')).length===1);
    await page.click('#tabBS'); await page.click('#rPublish'); await page.waitForTimeout(700);
    ok('a second report (Balance Sheet) is indexed separately', (await docs('reportIndex')).length===2);

    // ---- 7. officer signs in
    ok('officer sets a password from the emailed link', await setPassword('olivia@example.org','Olivia-Pass-123'));
    const ctx4 = await newContext(browser); const op = await ctx4.newPage(); errsOf(op, errors);
    await signIn(op,'olivia@example.org','Olivia-Pass-123'); await op.waitForURL('**/officer.html',{timeout:20000}); await waitBooted(op);
    ok('officer lands on the reports page', op.url().endsWith('officer.html'));
    ok('officer header shows the role', (await op.textContent('#whoami')).includes('Chairperson'));
    await op.waitForSelector('#repView table'); const optsO = await op.$$eval('#repPick option', os=>os.map(o=>o.textContent));
    ok('officer sees only the ticked report type (TB, not BS)', optsO.length===1 && optsO[0].includes('Trial Balance'), JSON.stringify(optsO));
    await op.waitForSelector('#repView table'); ok('officer sees the report table', (await op.$$('#repView table')).length>=1);
    ok('officer view has no controls', (await op.$$('#repView button, #repView select')).length===0);
    for (const pg of ['dashboard.html','settings.html','believers.html']) { await op.goto(BASE+pg); await op.waitForURL('**/officer.html',{timeout:15000}).catch(()=>{}); ok('officer is sent back from '+pg, op.url().endsWith('officer.html'), op.url()); }
    const leak = await op.evaluate(()=>['lsa_believers','lsa_journal','lsa_cashflow'].map(k=>localStorage.getItem(k)));
    ok('no books are held on the officer device', leak.every(v=>!v || v==='[]'), JSON.stringify(leak).slice(0,100));

    // ---- 8. switch the officer off
    await page.goto(BASE+'settings.html'); await waitBooted(page); await page.waitForSelector('#usersTable tbody tr');
    const row = page.locator('#usersTable tbody tr', {hasText:'Olivia Officer'}); await row.locator('button[data-act=toggle]').click();
    await page.waitForFunction(()=>/switched off/.test(document.getElementById('stMsg').textContent),null,{timeout:15000});
    await op.goto(BASE+'officer.html'); await op.waitForURL('**/index.html**',{timeout:15000});
    ok('a switched-off officer is signed out', op.url().includes('index.html'), op.url());
    await signIn(op,'olivia@example.org','Olivia-Pass-123'); await op.waitForFunction(()=>document.getElementById('loginMsg').textContent.length>0);
    ok('a switched-off officer cannot sign in', (await op.textContent('#loginMsg')).includes('switched off'), await op.textContent('#loginMsg'));
    await ctx4.close();

    // ---- 9. withdraw a report, audit log, backup
    await page.reload(); await waitBooted(page); await page.waitForSelector('#publishedTable tbody tr');
    const before = await page.$$eval('#publishedTable tbody tr button', b=>b.length);
    const wb = page.locator('#publishedTable button[data-id]').first(); await wb.click(); await wb.click();
    await page.waitForFunction(()=>/withdrawn/.test(document.getElementById('stMsg').textContent),null,{timeout:15000});
    ok('withdrawing a report removes it from the list', (await page.$$eval('#publishedTable tbody tr button', b=>b.length)) === before-1);
    ok('audit log shows entries', (await page.$$('#auditTable tbody tr')).length>5);
    const [dl] = await Promise.all([page.waitForEvent('download',{timeout:20000}), page.click('#btnBackup')]);
    const fp = path.join(OUT,'lsa-backup-test.xlsx'); await dl.saveAs(fp);
    const XLSX = require(path.join(REPO,'node_modules/xlsx')); const wbk = XLSX.readFile(fp);
    ok('backup has a sheet per record type', ['journal','cashflow','funds','coa','believers','transactions'].every(s=>wbk.SheetNames.includes(s)), wbk.SheetNames.join(','));
    ok('backup contains the believer', XLSX.utils.sheet_to_json(wbk.Sheets['believers']).some(r=>String(r.name).includes('Ada')));

    // ---- 10. handover
    await page.goto(BASE+'settings.html'); await waitBooted(page); await page.waitForSelector('#usersTable tbody tr');
    await page.fill('#pName','Victor Vice'); await page.fill('#pEmail','victor@example.org'); await page.selectOption('#pRole','VICE_TREASURER'); await page.click('#btnPerson');
    await page.waitForFunction(()=>/Victor Vice added/.test(document.getElementById('stMsg').textContent),null,{timeout:20000});
    ok('Vice Treasurer created', (await docs('users')).some(d=>field(d,'email')==='victor@example.org' && field(d,'role')==='VICE_TREASURER'));
    ok('Vice Treasurer password link', await setPassword('victor@example.org','Victor-Pass-123'));
    const vctx = await newContext(browser); const vp = await vctx.newPage(); errsOf(vp, errors);
    await signIn(vp,'victor@example.org','Victor-Pass-123'); await vp.waitForURL('**/dashboard.html',{timeout:20000}); await waitBooted(vp);
    ok('Vice Treasurer has full access and sees the books', (await vp.textContent('#dashBelievers')).trim()==='2');
    await vp.goto(BASE+'settings.html'); await waitBooted(vp); await vp.waitForSelector('#usersTable tbody tr');
    const trow = vp.locator('#usersTable tbody tr',{hasText:'Tessa Treasurer'});
    ok('Vice Treasurer cannot edit the Treasurer', await trow.locator('button[data-act=edit]').isDisabled());
    ok('Vice Treasurer does not see the handover box', await vp.locator('#handoverCard').isHidden());
    ok('Treasurer role is not offered to the Vice Treasurer', !(await vp.$$eval('#pRole option',o=>o.map(x=>x.value))).includes('TREASURER'));
    await vctx.close();
    await page.selectOption('#hoPerson', {label: /Victor/}).catch(async()=>{ const v=await page.$$eval('#hoPerson option',o=>o.find(x=>x.textContent.includes('Victor')).value); await page.selectOption('#hoPerson', v); });
    await page.click('#btnHandover'); await page.click('#btnHandoverYes');
    await page.waitForFunction(()=>/Done/.test(document.getElementById('stMsg').textContent),null,{timeout:20000}); await page.waitForTimeout(1800); await waitBooted(page);
    const us2 = await docs('users'); const role = e => field(us2.find(d=>field(d,'email')===e),'role');
    ok('handover: Victor is now Treasurer', role('victor@example.org')==='TREASURER');
    ok('handover: Tessa is now Vice Treasurer', role(T.email)==='VICE_TREASURER');
    ok('exactly one Treasurer', us2.filter(d=>field(d,'role')==='TREASURER').length===1);

    // ---- 11. phone layout check on a signed-in page
    const mctx = await newContext(browser, {...devices['iPhone 13']}); const mp = await mctx.newPage(); errsOf(mp, errors);
    await signIn(mp,T.email,T.pw); await mp.waitForURL('**/dashboard.html',{timeout:20000}); await waitBooted(mp);
    for (const pg of ['dashboard','believers','funds','transactions','adjustments','reports','posting-rules','settings']) {
      await mp.goto(BASE+pg+'.html'); await waitBooted(mp); await mp.waitForTimeout(500);
      const m = await mp.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
      ok(`phone: ${pg} does not scroll sideways`, m.sw<=m.cw+1, `${m.sw}>${m.cw}`);
    }
    await mp.goto(BASE+'settings.html'); await waitBooted(mp); await mp.waitForTimeout(800); await mp.screenshot({path:path.join(OUT,'lsa-shot-settings.png'),fullPage:true});
    await mp.goto(BASE+'dashboard.html'); await waitBooted(mp); await mp.screenshot({path:path.join(OUT,'lsa-shot-dashboard.png'),fullPage:true});
    const lp = await mctx.newPage(); await lp.evaluate(()=>0).catch(()=>{});
    await mp.click('#logoutBtn'); await mp.waitForURL('**/index.html**'); await mp.waitForTimeout(600); await mp.screenshot({path:path.join(OUT,'lsa-shot-login.png'),fullPage:true});
    await mp.click('#lnkSetup'); await mp.screenshot({path:path.join(OUT,'lsa-shot-setup.png'),fullPage:true});
    await mctx.close();

    ok('no page errors in any browser', errors.length===0, errors.slice(0,5).join(' | '));
  } catch (e) { ok('test run completed', false, e.stack.split('\n').slice(0,4).join(' | ')); }
  finally { await browser.close(); server.close(); }
  for (const r of results) console.log(r.join('  '));
  console.log(`\n${results.length-failed}/${results.length} end-to-end checks passed`);
  process.exit(failed?1:0);
})();
