import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {openDatabase} from '../server/db.mjs';
import {createAppServer} from '../server/index.mjs';
import {createSession,requireLocalRequest,sessionCookie} from '../server/auth.mjs';
import {sqliteApp,openPrincipalSession} from '../tests/helpers/sqlite-app.mjs';


// Native browser decoding only: synthetic tone, disposable DB/files, no microphone/provider.
const root=await mkdtemp(join(tmpdir(),'understood-audio-browser-'));
const db=openDatabase(':memory:');
const api=sqliteApp(db,{publicOrigin:'http://127.0.0.1:3188',audioRoot:root});
const handler=api.listeners('request')[0];api.removeAllListeners('request');
let posts=0,stopping=false;
api.on('request',(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/api/qa-audio-retry' && req.method==='GET'){
    requireLocalRequest(req);
    const session=openPrincipalSession(db,db.prepare("SELECT * FROM workers WHERE id='worker-30'").get());
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store','set-cookie':sessionCookie(session.token,session.maxSeconds)});
    res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic audio recovery check</title><body><h1>Synthetic audio recovery check</h1><p>Generated tone only. No microphone or provider call. This explicit check saves one encrypted synthetic recording in this browser. Acceptance acknowledgement is deliberately lost; the publication is then withdrawn.</p><button id="run">Run synthetic retry check</button><a id="open" href="/#worker/assignment-30" hidden>Open saved recording in worker view</a><button id="clear" hidden>Remove synthetic saved audio</button><pre id="result" role="status">Not run.</pre><script type="module" src="/tests/browser/worker-audio-retry.ts"></script></body></html>');return;
  }
  if(path==='/api/qa-audio-evidence' && req.method==='GET'){
    requireLocalRequest(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({posts,recordings:db.prepare('SELECT count(*) AS n FROM recordings').get().n,receipts:db.prepare("SELECT count(*) AS n FROM submission_receipts WHERE kind='audio'").get().n,state:db.prepare("SELECT state FROM publications WHERE id='shelf-v3'").get().state}));return;
  }
  if(path==='/api/worker/briefings/assignment-30/audio' && req.method==='POST'){
    posts++;
    const writeHead=res.writeHead.bind(res),end=res.end.bind(res);
    let accepted=false;
    res.writeHead=function(status,...args){accepted=status>=200 && status<300;return writeHead(accepted?503:status,...args);};
    res.end=function(body,...args){
      if(accepted){db.prepare("UPDATE publications SET state='withdrawn' WHERE id='shelf-v3'").run();return end(JSON.stringify({error:'Synthetic acknowledgement loss after acceptance'}),...args);}
      return end(body,...args);
    };
  }
  handler(req,res);
});
await new Promise((done,fail)=>{api.once('error',fail);api.listen(3189,'127.0.0.1',done);});
const ui=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit',env:{...process.env,UNDERSTOOD_WEB_PORT:'3188',UNDERSTOOD_API_PORT:'3189'}});
async function stop(){
  if(stopping)return;stopping=true;ui.kill();await new Promise(done=>api.close(done));db.close();
  if(resolve(dirname(root))!==resolve(tmpdir()) || !basename(root).startsWith('understood-audio-browser-'))throw Error('Unsafe fixture cleanup path');
  await rm(root,{recursive:true,force:true});
  process.stdin.pause();
}
process.stdin.setEncoding('utf8');process.stdin.on('data',value=>{if(value.trim()==='stop')void stop();});
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());ui.once('error',()=>void stop());ui.once('exit',()=>void stop());
console.log('Native synthetic audio QA: http://127.0.0.1:3188/api/qa-audio-retry');
console.log(`Disposable private audio root: ${root}`);
