import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import {processOne} from '../server/worker.mjs';
import {provisionStaffCredential,createSession,sessionCookie,revokeSession,requireLocalRequest} from '../server/auth.mjs';
import {loadPublicBuild} from '../server/public-build.mjs';

// Disposable synthetic auth observation only. Controls never exist in the application server.
const port=Number(process.env.UNDERSTOOD_STAFF_SESSION_FIXTURE_PORT ?? 3220);
if(!Number.isInteger(port) || port<1024 || port>65535 || [3020,3021].includes(port))throw Error('Use a disposable fixture port');
const origin=`http://127.0.0.1:${port}`,db=openDatabase(':memory:');seed(db);
for(const staffId of ['maya','harbor-owner'])provisionStaffCredential(db,staffId,staffId+'@qa.example.test','Synthetic session QA '+randomUUID());
const api=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin,mail:{mode:'disabled'}}),handler=api.listeners('request')[0];
const build=await loadPublicBuild('dist');
const fingerprint=()=>Object.fromEntries(['organizations','sites','workers','briefings','publications','assignments','attempts','clarifications','audit'].map(table=>[table,createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM '+table+' ORDER BY id').all())).digest('hex')]));
const before=fingerprint();let sessionReads=0,appPosts=0,controls=0,failure='',language='en',held=false,heldReads=0,releasedReads=0;
const pending=new Set();
function issue(principal='maya',seconds=3600){
  db.prepare('UPDATE staff SET active=1 WHERE id=?').run(principal);
  return createSession(db,db.prepare('SELECT * FROM staff WHERE id=?').get(principal),'staff','credential',null,seconds);
}
const controlPage=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Disposable Session QA</title><h1>Disposable Session QA</h1><p id="result" role="status">Synthetic memory-only controls.</p>${['interrupt','restore','malformed','revoke','disable','rotate','archive','notify','hold','release','process'].map(action=>`<button type="button" data-action="${action}">${action}</button>`).join(' ')}<script>document.querySelectorAll('button').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{const response=await fetch('/api/qa-control/'+button.dataset.action,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!response.ok)throw Error();document.getElementById('result').textContent='Completed: '+button.dataset.action;if(!['hold','release'].includes(button.dataset.action)){const channel=new BroadcastChannel('understood:session-signal');channel.postMessage('changed');channel.close();}}catch{document.getElementById('result').textContent='Control unavailable.';}finally{button.disabled=false;}}));</script></html>`;
const server=createServer((req,res)=>{
  const url=new URL(req.url,origin);
  if(url.pathname==='/__qa/stop' && req.method==='POST'){requireLocalRequest(req);res.writeHead(200);res.end('Stopping disposable session fixture');setImmediate(stop);return;}
  if(url.pathname==='/api/qa-bootstrap' && req.method==='GET') {
    requireLocalRequest(req);language=url.searchParams.get('language') || 'en';if(!['en','ar','ur'].includes(language)){res.writeHead(400);return res.end();}
    failure='';db.prepare("DELETE FROM site_lifecycle WHERE site_id='beirut'").run();
    const session=issue('maya',url.searchParams.get('expiry')==='1'?30:3600);
    res.writeHead(302,{'set-cookie':sessionCookie(session.token,session.maxSeconds),location:'/#briefings/shelf','cache-control':'no-store'});return res.end();
  }
  if(url.pathname==='/qa-controls' && req.method==='GET') {requireLocalRequest(req);res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(controlPage);}
  const control=url.pathname.match(/^\/api\/qa-control\/(interrupt|restore|malformed|revoke|disable|rotate|archive|notify|hold|release|process)$/);
  if(control && req.method==='POST') {
    requireLocalRequest(req);if(req.headers.origin!==origin){res.writeHead(403);return res.end();}controls++;
    const action=control[1];let cookie;
    if(action==='process'){for(let i=0;i<20&&processOne(db);i++){} }
    if(action==='hold')held=true;
    if(action==='release'){held=false;for(const entry of pending){pending.delete(entry);if(!entry.res.destroyed){releasedReads++;handler(entry.req,entry.res);}}}
    if(action==='interrupt' || action==='malformed')failure=action;
    if(action==='restore')failure='';
    if(action==='revoke')revokeSession(db,req);
    if(action==='disable')db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();
    if(action==='rotate'){const session=issue('harbor-owner');cookie=sessionCookie(session.token,session.maxSeconds);}
    if(action==='archive')db.prepare("INSERT INTO site_lifecycle(site_id,org_id,revision,state,reason,updated_at) VALUES('beirut','cedar',1,'archived','pilot_closed',?) ON CONFLICT(site_id) DO UPDATE SET state='archived',revision=site_lifecycle.revision+1").run(new Date().toISOString());
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',...(cookie?{'set-cookie':cookie}:{})});return res.end('{"ok":true}');
  }
  if(url.pathname==='/api/session' && req.method==='GET') {
    sessionReads++;
    if(failure){res.writeHead(failure==='interrupt'?503:200,{'content-type':'application/json','cache-control':'no-store'});return res.end(failure==='interrupt'?'{"error":"Synthetic session interruption"}':'{"authenticated":true,"role":"staff","mode":"synthetic-credential","staffScope":"bad"}');}
    const end=res.end.bind(res);res.end=(body,...args)=>{
      if(body){try {const value=JSON.parse(body.toString());if(value.authenticated && value.role==='staff'){value.language=language;return end(JSON.stringify(value),...args);}}catch{}}
      return end(body,...args);
    };
    if(held){heldReads++;const entry={req,res};pending.add(entry);res.once('close',()=>pending.delete(entry));return;}
  }
  if(url.pathname.startsWith('/api/')){if(req.method==='POST')appPosts++;return handler(req,res);}
  return build(req,res,url);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
let stopping=false;function stop(){if(stopping)return;stopping=true;clearTimeout(timer);for(const entry of pending){if(!entry.res.destroyed){entry.res.writeHead(503);entry.res.end('Fixture stopped');}}pending.clear();server.close(()=>{console.log(JSON.stringify({terminal:true,sessionReads,appPosts,controls,heldReads,releasedReads,businessAndAuditUnchanged:JSON.stringify(before)===JSON.stringify(fingerprint()),externalCalls:0}));db.close();process.stdin.pause();});server.closeIdleConnections();}
const timer=setTimeout(stop,20*60_000);process.stdin.setEncoding('utf8');process.stdin.on('data',value=>{if(value.trim()==='stop')stop();});process.once('SIGINT',stop);process.once('SIGTERM',stop);
console.log('Disposable staff session QA: '+origin+'/api/qa-bootstrap (language=en/ar/ur, expiry=1). Controls: '+origin+'/qa-controls. Only synthetic session/policy fixture changes; no provider, mail or cloud calls.');
