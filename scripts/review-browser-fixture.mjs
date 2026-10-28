import {spawn} from 'node:child_process';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import {syntheticPrepare,CANONICAL_SOURCE} from '../server/domain.mjs';
import {processOne} from '../server/worker.mjs';
import {sqliteApp} from '../tests/helpers/sqlite-app.mjs';

const db=openDatabase(':memory:');seed(db);
db.prepare("UPDATE organizations SET name='Disposable Review QA' WHERE id='cedar'").run();
db.prepare("UPDATE briefings SET state='ready',prepared_json=? WHERE id='shelf'").run(JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)));
const api=sqliteApp(db,{publicOrigin:'http://127.0.0.1:3030'});
let loseAcknowledgment=true,loseBeforeCommit=true;const handler=api.listeners('request')[0];api.removeAllListeners('request');
api.on('request',(req,res)=>{
  if(req.url.includes('/review') || req.url.startsWith('/api/briefing-review/')) res.once('finish',()=>console.log(req.method,req.url,res.statusCode,db.prepare("SELECT revision,state FROM briefings WHERE id='shelf'").get(),'receipts',db.prepare('SELECT COUNT(*) n FROM briefing_review_requests').get().n));
  if(!loseAcknowledgment && loseBeforeCommit && req.method==='POST' && req.url==='/api/briefings/shelf/review') {loseBeforeCommit=false;res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({error:'Synthetic interruption before review was accepted.'}));}
  if(!loseAcknowledgment || req.method!=='POST' || req.url!=='/api/briefings/shelf/review') return handler(req,res);
  const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let committed=false;
  res.writeHead=(status,...args)=>{committed=status===200;if(committed) {loseAcknowledgment=false;return writeHead(500,...args);}return writeHead(status,...args);};
  res.end=(body,...args)=>end(committed ? JSON.stringify({error:'Synthetic review acknowledgement interrupted. Retry the unchanged request.'}) : body,...args);
  return handler(req,res);
});
await new Promise(resolve=>api.listen(3031,'127.0.0.1',resolve));
const timer=setInterval(()=>{while(processOne(db)) {}},250);
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit',env:{...process.env,UNDERSTOOD_WEB_PORT:'3030',UNDERSTOOD_API_PORT:'3031'}});
function stop(){clearInterval(timer);vite.kill();api.close(()=>db.close());}
process.once('SIGINT',stop);process.once('SIGTERM',stop);vite.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});
console.log('Memory-only draft review QA at http://127.0.0.1:3030/; first review acknowledgement lost after commit; second request interrupted before commit.');
