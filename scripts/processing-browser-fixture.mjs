import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import {createDraft,queuePreparation} from '../server/preparation.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {processOne} from '../server/worker.mjs';
import {sqliteApp} from '../tests/helpers/sqlite-app.mjs';


const db=openDatabase(':memory:');seed(db);
db.prepare("UPDATE organizations SET name='Disposable Processing QA' WHERE id='cedar'").run();
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
for(let index=0;index<45;index++) {
  const id=randomUUID(),now=new Date().toISOString();
  db.prepare("INSERT INTO briefings VALUES(?,?,?,?,?,1,1,'ready',NULL,?,?)").run(id,'cedar','beirut',`Historical preparation ${String(index).padStart(2,'0')}`,CANONICAL_SOURCE,now,now);
  db.prepare("INSERT INTO jobs VALUES(?,?,?,?,1,'prepare','ready',1,?,NULL,NULL,?)").run(randomUUID(),'cedar','beirut',id,'2099-10-01T00:00:00.000Z',now);
}
const draft=createDraft(db,owner,{requestId:randomUUID(),title:'Retry shelf preparation',source:CANONICAL_SOURCE});
const job=queuePreparation(db,owner,draft.id,1);
db.prepare("UPDATE jobs SET status='failed',attempts=1,error='Disposable provider-secret failure' WHERE id=?").run(job.id);
db.prepare("UPDATE briefings SET state='failed' WHERE id=?").run(draft.id);
const api=sqliteApp(db,{publicOrigin:'http://127.0.0.1:3030'});
await new Promise(resolve=>api.listen(3031,'127.0.0.1',resolve));
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit',env:{...process.env,UNDERSTOOD_WEB_PORT:'3030',UNDERSTOOD_API_PORT:'3031'}});
const worker=setInterval(()=>{while(processOne(db)) {}},750);
function stop() {clearInterval(worker);vite.kill();api.close(()=>db.close());}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
vite.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});
console.log('Memory-only processing QA at http://127.0.0.1:3030/');
