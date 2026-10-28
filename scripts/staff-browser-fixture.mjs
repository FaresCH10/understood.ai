import {spawn} from 'node:child_process';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import {sqliteApp} from '../tests/helpers/sqlite-app.mjs';

const db=openDatabase(':memory:');seed(db);
db.prepare("UPDATE organizations SET name='Disposable Staff QA' WHERE id='cedar'").run();
for(const [id,name,role] of [['rami','Rami Synthetic','supervisor'],['lina','Lina Synthetic','administrator'],['aamir','Aamir Synthetic','auditor']]) db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run(id,'cedar','beirut',name,role);
for(let n=0;n<9;n++) db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run(`extra-${n}`,'cedar','beirut',`Synthetic staff ${n}`,'supervisor');
const original=db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json;
const api=sqliteApp(db,{publicOrigin:'http://127.0.0.1:3030'});
let lose=true,hideReceipt=false;const handler=api.listeners('request')[0];api.removeAllListeners('request');
api.on('request',(req,res)=>{
  if(req.url.startsWith('/api/settings/staff')) res.once('finish',()=>console.log(req.method,req.url,res.statusCode,'receipts',db.prepare('SELECT COUNT(*) n FROM staff_access_requests').get().n,'rami',JSON.stringify(db.prepare("SELECT role,active FROM staff WHERE id='rami'").get()),'published unchanged',original===db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json));
  if(hideReceipt && req.method==='GET' && req.url.startsWith('/api/settings/staff/receipts/')) {hideReceipt=false;res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({error:'Synthetic receipt lookup temporarily unavailable.'}));}
  if(!lose || req.method!=='POST' || !req.url.endsWith('/role')) return handler(req,res);
  const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let committed=false;
  res.writeHead=(status,...args)=>{committed=status===200;if(committed){lose=false;hideReceipt=true;return writeHead(500,...args);}return writeHead(status,...args);};
  res.end=(body,...args)=>end(committed ? JSON.stringify({error:'Synthetic acknowledgement interrupted after acceptance.'}) : body,...args);return handler(req,res);
});
await new Promise(resolve=>api.listen(3031,'127.0.0.1',resolve));
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit',env:{...process.env,UNDERSTOOD_WEB_PORT:'3030',UNDERSTOOD_API_PORT:'3031'}});
function stop(){vite.kill();api.close(()=>db.close());}
process.once('SIGINT',stop);process.once('SIGTERM',stop);vite.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});
console.log('Memory-only staff QA at http://127.0.0.1:3030/; first accepted role change loses its acknowledgement.');
