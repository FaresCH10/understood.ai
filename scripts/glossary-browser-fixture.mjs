import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import {processOne} from '../server/worker.mjs';
import {changeGlossary} from '../server/glossary.mjs';
import {CANONICAL_SOURCE,syntheticPrepare} from '../server/domain.mjs';
import {sqliteApp} from '../tests/helpers/sqlite-app.mjs';

const db=openDatabase(':memory:');seed(db);
db.prepare("UPDATE organizations SET name='Disposable Glossary QA' WHERE id='cedar'").run();
db.prepare("UPDATE briefings SET state='ready',prepared_json=? WHERE id='shelf'").run(JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)));
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
for(const [term,targetLanguage] of [['blue shelf','ar'],['yellow shelf','ar'],['blue shelf','ur']]) changeGlossary(db,owner,'create',null,{requestId:randomUUID(),confirmed:true,term,sourceLanguage:'en',targetLanguage,override:''});
for(let n=1;n<=23;n++) changeGlossary(db,owner,'create',null,{requestId:randomUUID(),confirmed:true,term:`QA terminology ${String(n).padStart(2,'0')}`,sourceLanguage:'en',targetLanguage:'ar',override:'Synthetic company terminology'});
while(processOne(db)) {}
const publication=db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json;
const api=sqliteApp(db,{publicOrigin:'http://127.0.0.1:3030'});
let lose=true,loseCreate=true;const handler=api.listeners('request')[0];api.removeAllListeners('request');
api.on('request',(req,res)=>{
  if(req.url.startsWith('/api/glossary')) res.once('finish',()=>console.log(req.method,req.url,res.statusCode,'terms',db.prepare('SELECT COUNT(*) n FROM glossary_terms').get().n,'receipts',db.prepare('SELECT COUNT(*) n FROM glossary_requests').get().n,'shelf',JSON.stringify(db.prepare("SELECT revision,state FROM briefings WHERE id='shelf'").get()),'published unchanged',publication===db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json));
  if(loseCreate && req.method==='POST' && req.url==='/api/glossary') {loseCreate=false;res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({error:'Synthetic interruption before the term was accepted.'}));}
  if(!lose || req.method!=='POST' || !req.url.endsWith('/edit')) return handler(req,res);
  const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let committed=false;
  res.writeHead=(status,...args)=>{committed=status===200;if(committed) {lose=false;return writeHead(500,...args);}return writeHead(status,...args);};
  res.end=(body,...args)=>end(committed ? JSON.stringify({error:'Synthetic glossary acknowledgement interrupted after acceptance.'}) : body,...args);return handler(req,res);
});
await new Promise(resolve=>api.listen(3031,'127.0.0.1',resolve));const timer=setInterval(()=>{while(processOne(db)) {}},250);
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit',env:{...process.env,UNDERSTOOD_WEB_PORT:'3030',UNDERSTOOD_API_PORT:'3031'}});
function stop(){clearInterval(timer);vite.kill();api.close(()=>db.close());}
process.once('SIGINT',stop);process.once('SIGTERM',stop);vite.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});
console.log('Memory-only glossary QA at http://127.0.0.1:3030/; first edit loses acknowledgement after commit; first create fails before commit.');
