import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {processOne} from '../server/worker.mjs';
import {ensureTemplateSchema,changeTemplate} from '../server/templates.mjs';
import {sqliteApp} from '../tests/helpers/sqlite-app.mjs';

const db=openDatabase(':memory:');seed(db);ensureTemplateSchema(db);
db.prepare("UPDATE organizations SET name='Disposable Template QA' WHERE id='cedar'").run();
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
for(let n=1;n<=25;n++) changeTemplate(db,owner,'create',null,{requestId:randomUUID(),confirmed:true,title:`Shelf template ${String(n).padStart(2,'0')}`,description:'Synthetic shelf handover',source:CANONICAL_SOURCE,question:'',facts:[],askedFacts:[]});
const api=sqliteApp(db,{publicOrigin:'http://127.0.0.1:3030'});
let lose=true,loseUse=true;const handler=api.listeners('request')[0];api.removeAllListeners('request');
api.on('request',(req,res)=>{
  if(req.url.startsWith('/api/templates')) res.once('finish',()=>console.log(req.method,req.url,res.statusCode,'templates',db.prepare('SELECT COUNT(*) n FROM templates').get().n,'versions',db.prepare('SELECT COUNT(*) n FROM template_versions').get().n,'receipts',db.prepare('SELECT COUNT(*) n FROM template_requests').get().n));
  if(loseUse && req.method==='POST' && req.url.endsWith('/use')) {loseUse=false;res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({error:'Synthetic interruption before template use was accepted.'}));}
  if(!lose || req.method!=='POST' || !req.url.endsWith('/edit')) return handler(req,res);
  const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let committed=false;
  res.writeHead=(status,...args)=>{committed=status===200;if(committed) {lose=false;return writeHead(500,...args);}return writeHead(status,...args);};
  res.end=(body,...args)=>end(committed ? JSON.stringify({error:'Synthetic template acknowledgement interrupted. Retry the unchanged request.'}) : body,...args);
  return handler(req,res);
});
await new Promise(resolve=>api.listen(3031,'127.0.0.1',resolve));const timer=setInterval(()=>{while(processOne(db)) {}},250);
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit',env:{...process.env,UNDERSTOOD_WEB_PORT:'3030',UNDERSTOOD_API_PORT:'3031'}});
function stop(){clearInterval(timer);vite.kill();api.close(()=>db.close());}
process.once('SIGINT',stop);process.once('SIGTERM',stop);vite.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});
console.log('Memory-only template QA at http://127.0.0.1:3030/; first edit acknowledgement is interrupted after commit; first use is interrupted before commit.');
