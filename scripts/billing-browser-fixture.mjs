import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import {ensureBillingSchema,createInvoice,recordPayment} from '../server/billing.mjs';
import {sqliteApp} from '../tests/helpers/sqlite-app.mjs';

const db=openDatabase(':memory:');seed(db);ensureBillingSchema(db);
db.prepare("UPDATE organizations SET name='Disposable Billing QA' WHERE id='cedar'").run();
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
for(let i=0;i<25;i++) {
  const invoice=createInvoice(db,owner,{requestId:randomUUID(),number:`QA-${String(i+1).padStart(3,'0')}`,description:'Synthetic pilot service - disposable record only',issueDate:'2026-10-01',dueDate:'2026-10-10',amount:'25',confirmed:true});
  if(i<5) recordPayment(db,owner,invoice.id,{requestId:randomUUID(),reference:'Synthetic transfer',note:'Not a real payment',date:'2026-10-01',amount:'25',confirmed:true});
}
const api=sqliteApp(db,{publicOrigin:'http://127.0.0.1:3030'});
let loseAcknowledgment=true;
const handler=api.listeners('request')[0];api.removeAllListeners('request');
api.on('request',(req,res)=>{
  const faultAction=process.env.UNDERSTOOD_BILLING_ACTION==='void' ? 'void' : 'payments';
  const faultTarget=process.env.UNDERSTOOD_BILLING_ACTION==='settings' ? /^\/api\/settings\/(organization|site)$/.test(req.url) : new RegExp(`^/api/invoices/[^/]+/${faultAction}$`).test(req.url);
  if(!loseAcknowledgment || req.method!=='POST' || !faultTarget) return handler(req,res);
  if(process.env.UNDERSTOOD_BILLING_FAULT==='before') {loseAcknowledgment=false;req.resume();res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic request interrupted before acceptance.'}));return;}
  const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let committed=false;
  res.writeHead=(status,...args)=>{committed=status===(process.env.UNDERSTOOD_BILLING_ACTION==='settings' ? 200 : 201);if(committed) {loseAcknowledgment=false;return writeHead(500,...args);}return writeHead(status,...args);};
  res.end=(body,...args)=>end(committed ? JSON.stringify({error:'Synthetic lost acknowledgment. Retry the unchanged request.'}) : body,...args);
  return handler(req,res);
});
await new Promise(resolve=>api.listen(3031,'127.0.0.1',resolve));
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit',env:{...process.env,UNDERSTOOD_WEB_PORT:'3030',UNDERSTOOD_API_PORT:'3031'}});
function stop(){vite.kill();api.close(()=>{console.log('Disposable payment rows:',db.prepare('SELECT COUNT(*) n FROM invoice_payments').get().n,'void rows:',db.prepare('SELECT COUNT(*) n FROM invoice_voids').get().n);db.close();});}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
vite.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});
console.log('Memory-only billing QA at http://127.0.0.1:3030/; first selected billing action receipt is deliberately interrupted.');
