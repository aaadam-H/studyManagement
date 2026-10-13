import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, ''), source=fs.readFileSync(repo+'/web/app.js','utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const fixture=`
import DOMPurify from '/vendor/purify.es.mjs';
import {prettyGroup} from '/parsers.js';
import {loadPlannedTimetable,combinePlannedTimetable} from '/planned-timetable.js';
import {mountSubjectPlanner} from '/subject-planner.js';
const esc=(x)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CFG={}, me={id:'admin'}, DAYN=['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const users=[{id:'alice',student_id:'231000001',name:'Alice Student',email:'s231000001@studentmail.unimap.edu.my',phone:'0190000001',program:'Computer Engineering',subgroup:'Y4G1',role:'student',courses:1,created_at:'2026-10-01'}, {id:'bob',student_id:'231000002',name:'Bob Student',email:'s231000002@studentmail.unimap.edu.my',phone:'0190000002',program:'Keju'.repeat(30),role:'student',courses:0,created_at:'2026-10-01'}];
const plans=new Map([['alice',[{code:'IMJ47403',section:'Y4G1'},{code:'IMJ21303',section:'Y2G1'}]],['bob',[{code:'IMJ47403',section:'Y4G1'},{code:'IMJ21303',section:'Y2G1'}]]]);
const courses=[{code:'IMJ47403',name:'Computer Network Security',credit:3},{code:'IMJ21303',name:'Signals and Systems',credit:3}];
const classes=[{id:1,course_code:'IMJ47403',course_name:courses[0].name,section:'Y4G1',day:2,start_time:'10:00',end_time:'11:50',start:'10:00',end:'11:50',kind:'LECTURE'}, {id:2,course_code:'IMJ21303',course_name:courses[1].name,section:'Y2G1',day:3,start_time:'10:00',end_time:'11:50',start:'10:00',end:'11:50',kind:'LECTURE'}];
const sb={from(table){let filters={}; const rows=()=>table==='profiles'?users.filter(u=>!filters.id||u.id===filters.id):table==='courses'?courses.filter(c=>!filters.code||c.code===filters.code):classes.filter(c=>Object.entries(filters).every(([k,v])=>c[k]===v)); return {select(){return this},eq(k,v){filters[k]=v;return this},order(){return this},then(resolve,reject){return Promise.resolve({data:rows(),error:null}).then(resolve,reject)},async maybeSingle(){return {data:table==='subject_plans'?(plans.has(filters.user_id)?{subjects:plans.get(filters.user_id)}:null):rows()[0],error:null}},async range(from,to){return {data:rows().slice(from,to+1),error:null}},async upsert(row){plans.set(row.user_id,row.subjects);return {error:null}},async insert(row){plans.set(row.user_id,row.subjects);return {error:null}}}},async rpc(name,args){if(name==='admin_update_profile'){window.savedProfile=args;Object.assign(users.find(u=>u.id===args.target),args.data);return {data:null,error:null}}return {data:users,error:null}}};
const q=async p=>{const r=await p;if(r.error)throw Error(r.error.message);return r.data}, formatLastAccess=()=> '12 Oct 2026 at 01:23', wireUserActions=()=>{};
const myCourses=async uid=>uid==='alice'?[{...courses[0],grp:'UR6523002',section:'Y4G1'}]:[];
const getTimetable=async uid=>({classes:uid==='alice'?[classes[0]]:[],courses:uid==='alice'?[{...courses[0],chosen:'Y4G1'}]:[],custom:[],main:uid==='alice'?'Y4G1':null,myCourseCount:uid==='alice'?1:0});
${source.match(/^const fd = .*$/m)[0]}
${source.match(/^const flash = .*$/m)[0]}
const matches=(value,query)=>value.toLowerCase().includes(query.toLowerCase());
${section('const STUDENT_MAIL =','/* ---------------- auth screens')}
${section('const qSelect =','/* ---------------- dashboard')}
${section('const kindKey =','async function pgDashboard') .split('\n').slice(0,4).join('\n')}
${section('const groupLabel =','async function pgTimetable')}
${section('async function mountAdminStudentTimetable','async function pgAdminSettings')}
${section('const userButtons =','boot();')}
const native=CanvasRenderingContext2D.prototype.fillText;
CanvasRenderingContext2D.prototype.fillText=function(text,...args){(this.canvas.drawnText??=[]).push(text);return native.call(this,text,...args)};
window.showAccount=()=>pgAdminUser(document.querySelector('main'),'alice');
window.showUsers=()=>pgAdminUsers(document.querySelector('main'));
window.showOverview=()=>pgAdminTimetables(document.querySelector('main'));
window.showPlanner=()=>{document.querySelector('main').innerHTML='<section id="planner"></section>';mountSubjectPlanner(document.querySelector('#planner'),{client:sb,userId:'bob',storage:localStorage})};
window.plans=plans;
await window.showAccount(); window.ready=true;
`;
const server=http.createServer((req,res)=>{
 let url=new URL(req.url,'http://localhost');if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fixture);return}
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><main id="main"></main><script type="module" src="/fixture.js"></script>');return}
 const path=repo+'/web'+url.pathname;if(!path.startsWith(repo+'/web/')||!fs.existsSync(path)){res.statusCode=404;res.end();return}res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path));
});
await new Promise(resolve=>server.listen(18765,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],env:{...process.env,XDG_CACHE_HOME:'/tmp/studyhub-browser-cache',XDG_CONFIG_HOME:'/tmp/studyhub-browser-config'}});
 const page=await browser.newPage({viewport:{width:1280,height:960},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:18765');await page.waitForFunction(()=>window.ready);
 await page.locator('[name="profile_name"]').fill('Updated Student');await page.locator('#ef button').click();await page.waitForFunction(()=>window.savedProfile);
 assert.equal(await page.evaluate(()=>window.savedProfile.data.name),'Updated Student');
 assert.equal(await page.evaluate(()=>window.savedProfile.data.email),'s231000001@studentmail.unimap.edu.my');
 await page.locator('#em .ok').waitFor();
 await page.locator('[data-student-week] .cls').getByText('Signals and Systems',{exact:false}).waitFor();
 assert.equal(await page.locator('[data-student-week] .cls').count(),2,'registered/planned duplicates are suppressed');
 assert.equal(await page.locator('[data-student-week] .cls .planned-badge').count(),2);
 await page.locator('[data-show-plans]').uncheck();assert.equal(await page.locator('[data-student-week] .cls').count(),1);
 await page.locator('[data-show-plans]').check();
 const download=page.waitForEvent('download');await page.locator('[data-download-student]').click();await(await download).saveAs('/tmp/studyhub-admin-timetable.png');
 await page.evaluate(()=>window.showUsers());
 for(const width of [1280,768,390]){await page.setViewportSize({width,height:960});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'account cards fit '+width);assert.equal(await page.locator('.admin-user-card .acts').count(),2)}
 await page.screenshot({path:'/tmp/studyhub-admin-accounts-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:960});await page.evaluate(()=>window.showOverview());
 await page.locator('[data-generate-all]').click();await page.getByText('2 timetables loaded.',{exact:false}).waitFor();
 assert.equal(await page.locator('[data-student-week] .cls').count(),4,'every student including plan-only student gets both subjects');
 assert.equal(await page.locator('[data-download-student]:disabled').count(),0);
 await page.locator('input[type="search"]').fill('231000002');assert.equal(await page.locator('.admin-timetable-entry:not([hidden])').count(),1);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overview fits phone');
 await page.locator('input[type="search"]').fill('');await page.screenshot({path:'/tmp/studyhub-admin-timetables-mobile.png',fullPage:true});
 await page.evaluate(()=>window.showPlanner());await page.getByRole('button',{name:'Browse subjects'}).click();
 await page.getByText('Planned subjects (2)',{exact:true}).waitFor();await page.locator('[data-remove-plan="IMJ21303"]').click();await page.getByText('Planned subjects (1)',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.plans.get('bob').length),1);
 assert.deepEqual(errors,[]);
 console.log('PASS: sanitized profile save, responsive account cards, all student timetable generation, planned-only timetable, toggle, PNG export, filtering and account plan edits.');
}finally{await browser?.close();server.close()}
