import { appendFileSync } from 'node:fs';
const base='https://api.ai-solutions.io.vn';
const key=process.env.MAPSLIBVN_API_KEY;
if(!key) throw new Error('Missing MAPSLIBVN_API_KEY');
const out='docs/evidence/capacity/2026-09-15-results.jsonl';
const record=x=>{const row={at:new Date().toISOString(),...x};appendFileSync(out,JSON.stringify(row)+'\n');console.log(JSON.stringify(row));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const group=process.argv[2]||'places';
let used=0, windowStart=Date.now();
const budget=group==='places'?50:16;
const seed=Math.floor(Date.now()/1000)%10000;
function url(i){
 if(group==='places'){
 const queries=['highlands','cafe','nguyen hue','pharmacity','ben thanh'];
 const cell=seed+i; const lat=10.55+(cell%20)*0.05;const lng=106.3+(Math.floor(cell/20)%12)*0.05;
 return `${base}/v1/autocomplete?${new URLSearchParams({q:queries[i%5],near:`${lat.toFixed(4)},${lng.toFixed(4)}`})}`;
 }
 const offset=(seed%100+i)*0.00002;
 return `${base}/v1/directions?${new URLSearchParams({from:'10.7769,106.7009',to:`${(10.7900+offset).toFixed(5)},106.68000`,mode:'motorbike'})}`;
}
async function pace(n){
 const elapsed=Date.now()-windowStart;
 if(elapsed>=65000){used=0;windowStart=Date.now();}
 if(used+n>budget){const wait=65000-(Date.now()-windowStart);record({event:'cooldown',group,ms:Math.max(0,wait)});await sleep(Math.max(0,wait));used=0;windowStart=Date.now();}
 used+=n;
}
async function one(u){const t=performance.now();try{
 const r=await fetch(u,{headers:{'X-Api-Key':key},signal:AbortSignal.timeout(10000)});
 const body=await r.json();return {ms:Math.round(performance.now()-t),status:r.status,cache:r.headers.get('x-mlv-cache')||'none',colo:r.headers.get('cf-ray')?.split('-').pop(),error:body.error?.code||null,items:body.items?.length??body.routes?.length??null};
}catch(e){return {ms:Math.round(performance.now()-t),status:0,cache:'none',error:e.name,cause:e.cause?.code||null};}}
function summary(samples){const times=samples.map(s=>s.ms).sort((a,b)=>a-b);const pct=p=>times[Math.max(0,Math.ceil(times.length*p)-1)];return {ok:samples.filter(s=>s.status===200).length,p50:pct(.5),p95:pct(.95),p99:pct(.99),statuses:samples.reduce((a,s)=>(a[s.status]=(a[s.status]||0)+1,a),{}),cache:samples.reduce((a,s)=>(a[s.cache]=(a[s.cache]||0)+1,a),{}),colos:[...new Set(samples.map(s=>s.colo))]};}
record({event:'start',group,base,seed,note:'API end-to-end waves; no quota bypass; DO not implemented; timeout 10s; stop on non-200 or p95>5s'});
let previous=[], lastClean=[];
const levels=process.argv[3]?process.argv[3].split(',').map(Number):(group==='places'?[5,10,20,40]:[1,4,8,16]);
if(levels.some(n=>!Number.isInteger(n)||n<1||n>budget))throw new Error('Levels exceed guarded budget');
for(const n of levels){
 await pace(n);const urls=Array.from({length:n},(_,i)=>url(n*101+i));const start=performance.now();const samples=await Promise.all(urls.map(one));const stats=summary(samples);
 record({event:'wave',group,cohort:'varied',concurrency:n,elapsedMs:Math.round(performance.now()-start),...stats,samples});previous=urls;
 if(stats.ok!==n||stats.p95>5000){record({event:'ramp_stopped',group,reason:stats.ok!==n?'non-200':'p95>5000ms'});break;}
 lastClean=urls;await sleep(3000);
}
if(lastClean.length && !process.argv.includes('--no-repeat')){const urls=lastClean.slice(0,group==='places'?20:8);await pace(urls.length);const samples=await Promise.all(urls.map(one));record({event:'wave',group,cohort:'repeat-cache-observed',concurrency:urls.length,...summary(samples),samples});}
record({event:'end',group});
