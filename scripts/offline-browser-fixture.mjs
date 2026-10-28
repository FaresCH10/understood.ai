import {createServer as createViteServer} from 'vite';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {openDatabase} from '../server/db.mjs';
import {createAppServer} from '../server/index.mjs';
import {createSession,requireLocalRequest,sessionCookie} from '../server/auth.mjs';
import {encodeWav} from '../src/audio.ts';
import {sqliteApp,openPrincipalSession} from '../tests/helpers/sqlite-app.mjs';


// Disposable, loopback-only, generated tone. No real microphone/provider, main DB or cloud.
const port=Number(process.env.UNDERSTOOD_OFFLINE_QA_PORT ?? 3194);
if(!Number.isInteger(port) || port<3194 || port>3199)throw Error('Offline QA port must be between 3194 and 3199');
const origin=`http://127.0.0.1:${port}`,db=openDatabase(':memory:');
const api=sqliteApp(db,{publicOrigin:origin});
const handler=api.listeners('request')[0];
const vite=await createViteServer({configFile:false,server:{middlewareMode:true},appType:'custom'});
const samples=Float32Array.from({length:32000},(_,i)=>Math.sin(i/10)*.5),tone=encodeWav({duration:2,sampleRate:16000,numberOfChannels:1,getChannelData:()=>samples});
let outage=false,posts=0,reads=0,stopping=false;
function html(res,value,status=200,headers={}){res.writeHead(status,{'content-type':'text/html','cache-control':'no-store',...headers});res.end(value);}
function evidence(){return {outage,workerMutationPosts:posts,apiReads:reads,recordings:db.prepare('SELECT count(*) AS n FROM recordings').get().n,answerReceipts:db.prepare("SELECT count(*) AS n FROM submission_receipts WHERE assignment_id='assignment-30'").get().n};}
const ui=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,origin),path=url.pathname;
    if(path.startsWith('/qa/')){
      requireLocalRequest(req);
      if(path==='/qa/start' && req.method==='GET'){
        const session=openPrincipalSession(db,db.prepare("SELECT * FROM workers WHERE id='worker-30'").get());
        html(res,'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private offline synthetic check</title><h1>Private offline synthetic check</h1><p>Disposable worker, generated tone, native encrypted browser storage. No microphone, provider or real worker data.</p><button id="run">Prepare synthetic offline check</button><button id="clear">Remove previous synthetic fixture data</button><a id="open" href="/#worker/assignment-30" hidden>Open worker briefing</a><pre id="result" role="status">Not run.</pre><script type="module" src="/tests/browser/worker-offline.ts"></script></html>',200,{'set-cookie':sessionCookie(session.token,session.maxSeconds)});return;
      }
      if(path==='/qa/evidence'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(evidence()));return;}
      if(path==='/qa/control' && req.method==='GET'){html(res,`<!doctype html><html lang="en"><title>Offline fixture control</title><h1>Offline fixture control</h1><pre>${JSON.stringify(evidence(),null,2)}</pre><form method="post" action="/qa/outage"><button>Simulate origin outage</button></form><form method="post" action="/qa/online"><button>Restore origin</button></form><a href="/#device">Open app</a></html>`);return;}
      if(['/qa/outage','/qa/online'].includes(path) && req.method==='POST'){outage=path==='/qa/outage';req.resume();res.writeHead(303,{location:'/#device','cache-control':'no-store'});res.end();return;}
      res.writeHead(404);res.end();return;
    }
    if(outage){res.writeHead(503,{'content-type':'text/plain','cache-control':'no-store'});res.end('Synthetic origin outage');return;}
    if(path.startsWith('/api/')){
      if(req.method==='POST' && path.startsWith('/api/worker/'))posts++;else if(req.method==='GET')reads++;
      if(path=== '/api/worker/briefings/assignment-30' && req.method==='GET'){
        const end=res.end.bind(res);res.end=function(body,...args){if(res.statusCode===200){const value=JSON.parse(String(body));value.speechUrls={body:'/api/worker/briefings/assignment-30/speech/body',question:'/api/worker/briefings/assignment-30/speech/question'};return end(JSON.stringify(value),...args);}return end(body,...args);};
      }
      if(/^\/api\/worker\/briefings\/assignment-30\/speech\/(body|question)$/.test(path) && req.method==='GET'){
        // Synthetic fixture media only; real authorization is exercised by the adjacent detail/session reads.
        res.writeHead(200,{'content-type':'audio/wav','cache-control':'no-store'});res.end(tone);return;
      }
      handler(req,res);return;
    }
    if(path.startsWith('/tests/') || path.startsWith('/src/') || path.startsWith('/@') || path.startsWith('/node_modules/') || path==='/server/recording-notice-input.mjs'){vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});return;}
    const file=path==='/'?'index.html':path.slice(1),target=resolve('dist',file),root=resolve('dist');
    if(!target.startsWith(root+'\\') && target!==resolve(root,'index.html')){res.writeHead(404);res.end();return;}
    const bytes=await readFile(target),type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'}[extname(file)] || 'application/octet-stream';
    res.writeHead(200,{'content-type':type,'cache-control':'no-store',...(file==='sw.js'?{'service-worker-allowed':'/'}:{})});res.end(bytes);
  }catch(error){if(!res.headersSent)res.writeHead(500,{'content-type':'text/plain'});res.end(String(error.message));}
});
await new Promise((done,fail)=>{ui.once('error',fail);ui.listen(port,'127.0.0.1',done);});
async function stop(){if(stopping)return;stopping=true;console.log('Final synthetic offline counters:',JSON.stringify(evidence()));await new Promise(done=>ui.close(done));await vite.close();db.close();process.stdin.pause();}
process.stdin.setEncoding('utf8');process.stdin.on('data',value=>{if(value.trim()==='stop')void stop();});process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
console.log(`Synthetic private offline QA: ${origin}/qa/start`);
