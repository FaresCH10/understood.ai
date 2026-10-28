import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import {createSession,requireLocalRequest,sessionCookie,provisionStaffCredential,issueWorkerGrant,redeemWorkerGrant} from '../server/auth.mjs';
import {requestWorkerDeletion} from '../server/deletions.mjs';
import {processOneDeletionRedaction} from '../server/deletion-redactions.mjs';
import {processOneDeletionPseudonym} from '../server/deletion-pseudonyms.mjs';
import {processOneDeletionCompletion} from '../server/deletion-completions.mjs';
import {saveRecordingNotice,getRecordingNotice} from '../server/recording-notices.mjs';
import {processOneSchedule} from '../server/schedules.mjs';
import {processOneReminder} from '../server/reminders.mjs';
import {processOne} from '../server/worker.mjs';
import {processOneSourceAudio} from '../server/source-audio-worker.mjs';
import {processOneSourceAudioCleanup} from '../server/source-audio-cleanup.mjs';
import {saveRetention} from '../server/retention.mjs';
import {receiveSourceAudio} from '../server/source-audio.mjs';
import {ensureSourceRetrySchema} from '../server/source-audio-retry.mjs';
import {createCrew,moveWorkerToCrew} from '../server/people.mjs';
import {captureReportAudience} from '../server/report-scope.mjs';

// Disposable UI evidence: all state lives in memory; no existing local data is changed.
const db=openDatabase(':memory:');
const accessMode='credential';
const uiPort=Number(process.env.UNDERSTOOD_QA_WEB_PORT || 3168),apiPort=Number(process.env.UNDERSTOOD_QA_API_PORT || 3169);
if(![uiPort,apiPort].every(port=>Number.isInteger(port) && port>=1024 && port<=65535) || uiPort===apiPort)throw Error('Invalid fixture ports');
seed(db);
const sourceAudioRoot=process.argv.includes('--source-audio')?await mkdtemp(join(tmpdir(),'understood-source-ui-')):undefined;
const api=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode,publicOrigin:`http://127.0.0.1:${uiPort}`,mail:{mode:'disabled'},...(sourceAudioRoot?{audioRoot:sourceAudioRoot}:{})});
if(process.argv.includes('--civil-time'))db.prepare("UPDATE sites SET timezone='America/New_York' WHERE id='beirut'").run();
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
if(sourceAudioRoot && process.argv.includes('--source-cleanup-history')) {
  const bytes=await readFile('artifacts/source-audio-synthetic.wav');
  const adapter={transcribe:async()=>({text:'Synthetic fixture transcript only. Put finished items on the blue shelf and unfinished items on the yellow shelf.'})};
  for(const [title,completed] of [['Synthetic completed source after cleanup',true],['Synthetic pending source after cleanup',false]]) {
    await receiveSourceAudio(db,owner,{requestId:randomUUID(),title,originalType:'audio/wav',generationLanguages:['en','ar']},bytes,bytes,sourceAudioRoot);
    if(completed)await processOneSourceAudio(db,adapter,sourceAudioRoot);
  }
  saveRetention(db,owner,{requestId:randomUUID(),revision:0,audioDays:7,confirmed:true});
  const now=new Date(Date.now()+8*86400000).toISOString();
  for(let n=0;n<20 && await processOneSourceAudioCleanup(db,sourceAudioRoot,{now});n++) {}
}
if(process.argv.includes('--publish-crews') || process.argv.includes('--schedules')) {
  const snapshot=JSON.parse(db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json),now=new Date().toISOString();
  db.prepare('INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('qa-publish','cedar','beirut','Crew recipient rehearsal',snapshot.source,'ready',JSON.stringify(snapshot),now,now);
  db.prepare('INSERT INTO crews VALUES(?,?,?,?,?)').run('qa-crew','cedar','beirut','ZZ Warehouse crew with a deliberately long name for mobile review',1);
  for(let n=0;n<25;n++)db.prepare('INSERT INTO crews VALUES(?,?,?,?,?)').run(`qa-catalog-${n}`,'cedar','beirut',`Crew catalog ${String(n).padStart(2,'0')}`,1);
  for(let n=0;n<126;n++) {
    db.prepare('INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES(?,?,?,?,?,?)').run(`qa-member-${n}`,'cedar','beirut',`QA Member ${String(n).padStart(3,'0')}`,'en',n===125?0:1);
    db.prepare('INSERT INTO crew_memberships VALUES(?,?,?,?,?)').run(`qa-member-${n}`,'cedar','beirut','qa-crew',now);
  }
}
if(process.argv.includes('--report-history')) {
  const snapshot=JSON.parse(db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json);
  for(let n=0;n<125;n++)db.prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?,?)').run(`qa-report-${String(n).padStart(3,'0')}`,'cedar','beirut','shelf',100+n,JSON.stringify({...snapshot,title:`Archived handover ${n} for shelf colour changes across the Beirut production team`}),new Date(Date.UTC(2026,0,1,0,0,n)).toISOString(),'superseded');
  for(const n of [1,2])db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES(?,?,?,?,?,?,?,?)').run(`qa-report-assignment-${n}`,'cedar','beirut','qa-report-000',`worker-${n}`,null,new Date().toISOString(),'en');
}
if(process.argv.includes('--notifications')) {
  const actions=['briefing.prepared','briefing.published','help.requested','export.ready','export.failed'];
  for(let n=0;n<25;n++)db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(`qa-notification-${String(n).padStart(2,'0')}`,'cedar','beirut','system','qa',actions[n%actions.length],'qa-private-source',new Date(Date.now()-1000-n*1000).toISOString());
}
if(accessMode==='credential')provisionStaffCredential(db,'maya','fixture@example.test','Disposable synthetic password only');
if(sourceAudioRoot && process.argv.includes('--source-retry-history')) {
  const bytes=await readFile('artifacts/source-audio-synthetic.wav');
  await receiveSourceAudio(db,owner,{requestId:randomUUID(),title:'Synthetic blocked source with a deliberately long handover title for mobile receipt recovery',originalType:'audio/wav',generationLanguages:['en','ar']},bytes,bytes,sourceAudioRoot);
  await processOneSourceAudio(db,undefined,sourceAudioRoot);
}
saveRecordingNotice(db,owner,{requestId:randomUUID(),revision:0,confirmed:true,scope:JSON.stringify(['cedar','beirut','maya']),notices:{
  en:'Synthetic site notice: ask Maya about access and retention. Literal text <script> is not executed.\nOnly send after reviewing your answer.',
  ar:'إشعار الموقع التجريبي: اسأل مايا عن الوصول والاحتفاظ بالتسجيلات.\nأرسل إجابتك بعد مراجعتها فقط.',
  ur:'آزمائشی سائٹ کی اطلاع: رسائی اور ریکارڈنگ محفوظ رکھنے کے بارے میں مایا سے پوچھیں۔\nاپنا جواب دیکھنے کے بعد ہی بھیجیں۔'
}});
db.prepare("INSERT INTO staff VALUES('qa-admin','cedar','beirut','QA administrator','administrator',1)").run();
if(accessMode==='credential' && process.argv.includes('--site-contacts'))provisionStaffCredential(db,'qa-admin','administrator@example.test','Disposable synthetic password only');
if(process.argv.includes('--site-contacts'))for(let n=0;n<18;n++)db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run(`qa-contact-${n}`,'cedar','beirut',`Site contact ${String(n).padStart(2,'0')}${n===17?' with a deliberately long mixed-direction name - مسؤول الموقع':''}`,'supervisor');
db.prepare("INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES('qa-new','cedar','beirut','QA Worker New','en',1)").run();
db.prepare("INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES('qa-ar','cedar','beirut','QA Worker Arabic','ar',1)").run();
db.prepare("INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES('qa-ur','cedar','beirut','QA Worker Urdu','ur',1)").run();
for(const [id,worker,language] of process.argv.includes('--site-crews')?[]:[['qa-answer-new','qa-new','en'],['qa-answer-ar','qa-ar','ar'],['qa-answer-ur','qa-ur','ur']]){
  db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,'cedar','beirut','shelf-v3',worker,null,new Date().toISOString(),language);
}
db.prepare("INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES('qa-complete','cedar','beirut','QA Worker Complete','en',1)").run();
db.prepare("INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES('qa-pending','cedar','beirut','QA Worker Pending','en',1)").run();
requestWorkerDeletion(db,owner,'qa-complete',{requestId:randomUUID(),expectedCode:'QA Worker Complete',reason:'worker_request',confirmed:true});
processOneDeletionRedaction(db);processOneDeletionPseudonym(db);await processOneDeletionCompletion(db,{});
requestWorkerDeletion(db,owner,'qa-pending',{requestId:randomUUID(),expectedCode:'QA Worker Pending',reason:'customer_policy',confirmed:true});
if(process.argv.includes('--site-crews')){
  // This disposable fixture explicitly constructs a synthetic publication audience, not a legacy migration.
  for(const [name,from,through] of [['الفريق الصباحي',1,18],['الفريق المسائي QA',19,26],['فريق المكتب',27,30]]){
    const crew=createCrew(db,owner,{name});for(let n=from;n<=through;n++)moveWorkerToCrew(db,owner,`worker-${n}`,crew.id);
  }
  captureReportAudience(db,'shelf-v3');
  db.prepare("INSERT INTO staff VALUES('qa-crew-deputy','cedar','beirut','Rami QA','supervisor',1)").run();
  db.prepare("INSERT INTO site_settings(site_id,org_id,revision,primary_contact_id,deputy_contact_id) VALUES('beirut','cedar',0,'maya','qa-crew-deputy')").run();
}
const handler=api.listeners('request')[0];api.removeAllListeners('request');
let rejectSubmissions=false,submittedBodies=[],rejectNotice=false,noticeBodies=[],noticeReadFailures=0,rejectRecorderChunk=false,blockedChunks=0;
let sessionFailure=false,sessionReads=0,workerPosts=0;
let initialSessionFailure=false;
let holdWorker=false,rejectAuditChunk=false,rejectLogout=false,logoutPosts=0;
let detailFailure=0,detailReads=0;
let shellOutage=false;
let rejectDeviceChunk=false;
let rejectContactRead=false;
let rejectAudioDraftChunk=false;
let denyBrowserStorage=false,signInPosts=0;
let workerBodies=[];
let malformedWorkerReceipt=false;
let mismatchedWorkerReceipt=false;
let rejectBillingChunk=false;
let loseWorkerReceipt=false,receiptReads=0,rejectReceiptRead=false;
let pendingQaGrant=null;
let loseNotificationRead=false,notificationPosts=0;
let rejectReportHistory=false,rejectReportChunk=false;
let crewReadFailures=0,crewReads=0,publicationPosts=0;
let loseScheduleAck=false,schedulePosts=0,scheduleCancelPosts=0;
let losePublicationAck=false,publicationReceiptFailure=false,publicationReceiptReads=0,rejectPublicationOnce=false;
let publicationRequestIds=[];
let loseCreationAck=false,rejectCreationOnce=false,creationReceiptFailure=false,creationPosts=0,creationReads=0,creationRequests=[];
let sourceBeforeSave=false,sourceLostAck=false,sourceReadFailure=false,sourcePosts=0,sourceReads=0,sourceBodies=[];
let sourceRetryLostAck=process.argv.includes('--source-retry-ack-lost'),sourceRetryBeforeSave=process.argv.includes('--source-retry-before-save'),sourceRetryPosts=0,sourceRetryReads=0;
api.on('request',(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/api/qa-worker-link' && req.method==='GET' && accessMode==='credential'){
    requireLocalRequest(req);pendingQaGrant=issueWorkerGrant(db,owner,'qa-new',60);
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});
    res.end(`<p>Disposable synthetic worker switch; no real access is granted.</p><a href="/#worker-access/${pendingQaGrant.token}">Open synthetic worker access link</a>`);return;
  }
  if(url.pathname==='/api/qa-storage-recover' && req.method==='GET'){
    requireLocalRequest(req);denyBrowserStorage=false;
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end('{}');return;
  }
  if(['/api/qa-shell-outage','/api/qa-shell-recover'].includes(url.pathname) && req.method==='GET'){
    requireLocalRequest(req);shellOutage=url.pathname.endsWith('outage');
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<a href="/">Open app</a>');return;
  }
  if(shellOutage){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic outage'}));return;}
  if(url.pathname==='/api/qa-bootstrap' && req.method==='GET'){
    try{
      requireLocalRequest(req);
      rejectNotice=url.searchParams.get('scenario')==='notice-reject';noticeBodies=[];
      rejectReportHistory=url.searchParams.get('scenario')==='report-history-fail';rejectReportChunk=url.searchParams.get('scenario')==='report-chunk-fail';
      crewReadFailures=url.searchParams.get('scenario')==='crew-read-fail'?1:0;crewReads=0;publicationPosts=0;
      loseScheduleAck=url.searchParams.get('scenario')==='schedule-ack-lost';schedulePosts=0;scheduleCancelPosts=0;
      losePublicationAck=url.searchParams.get('scenario')==='publication-ack-lost';
      publicationReceiptFailure=losePublicationAck || loseScheduleAck;publicationReceiptReads=0;
      rejectPublicationOnce=url.searchParams.get('scenario')==='publication-before-save';
      publicationRequestIds=[];
      loseCreationAck=url.searchParams.get('scenario')==='draft-ack-lost';rejectCreationOnce=url.searchParams.get('scenario')==='draft-before-save';
      sourceBeforeSave=url.searchParams.get('scenario')==='source-before-save';sourceLostAck=url.searchParams.get('scenario')==='source-ack-lost';sourceReadFailure=sourceLostAck;
      sourcePosts=0;sourceReads=0;sourceBodies=[];
      creationReceiptFailure=loseCreationAck;creationPosts=0;creationReads=0;creationRequests=[];
      loseNotificationRead=url.searchParams.get('scenario')==='notification-lost';notificationPosts=0;
      noticeReadFailures=url.searchParams.get('scenario')==='notice-fail'?1:0;
      rejectRecorderChunk=url.searchParams.get('scenario')==='recorder-fail';blockedChunks=0;
      rejectDeviceChunk=url.searchParams.get('scenario')==='device-fail';
      rejectContactRead=url.searchParams.get('scenario')==='contact-read-fail';
      rejectAudioDraftChunk=url.searchParams.get('scenario')==='audio-draft-fail';
      denyBrowserStorage=url.searchParams.get('scenario')==='storage-denied';signInPosts=0;
      malformedWorkerReceipt=url.searchParams.get('scenario')==='request-receipt';
      mismatchedWorkerReceipt=['request-mismatch','request-read-fail'].includes(url.searchParams.get('scenario'));
      rejectBillingChunk=url.searchParams.get('scenario')==='billing-fail';
      loseWorkerReceipt=url.searchParams.get('scenario')==='request-lost-receipt';receiptReads=0;
      rejectReceiptRead=url.searchParams.get('scenario')==='request-read-fail';
      sessionFailure=url.searchParams.get('scenario')==='session-fail';sessionReads=0;
      initialSessionFailure=url.searchParams.get('scenario')==='session-initial-fail';
      holdWorker=url.searchParams.get('scenario')==='worker-hold';workerBodies=[];rejectAuditChunk=url.searchParams.get('scenario')==='audit-fail';
      rejectLogout=url.searchParams.get('scenario')==='logout-reject';
      detailFailure=url.searchParams.get('scenario')==='detail-fail'?503:url.searchParams.get('scenario')==='detail-deny'?403:0;detailReads=0;
      const worker=url.searchParams.get('worker');
      if(worker){
        const assignment={'qa-new':'qa-answer-new','qa-ar':'qa-answer-ar','qa-ur':'qa-answer-ur','worker-29':'assignment-29'}[worker];
        if(!assignment)throw Error('Invalid synthetic worker');
        const principal=db.prepare('SELECT * FROM workers WHERE id=?').get(worker);
        const session=redeemWorkerGrant(db,issueWorkerGrant(db,owner,worker,480).token);
        if(url.searchParams.get('scenario')==='request-corrupt'){
          res.writeHead(200,{'set-cookie':sessionCookie(session.token,session.maxSeconds),'content-type':'text/html','cache-control':'no-store'});
          res.end(`<p>Disposable synthetic request-ledger test</p><button id="prepare">Prepare corrupt request record</button><p id="state">Not prepared</p><a href="/#worker/${assignment}">Open worker briefing</a><script>document.getElementById('prepare').addEventListener('click',()=>{sessionStorage.setItem('understood:worker-requests:v1','{');document.getElementById('state').textContent='Synthetic corrupt record prepared';document.getElementById('prepare').disabled=true;});</script>`);return;
        }
        res.writeHead(302,{'set-cookie':sessionCookie(session.token,session.maxSeconds),'location':`/#worker/${assignment}`,'cache-control':'no-store'});res.end();return;
      }
      const staff=url.searchParams.get('staff') || 'maya';
      if(!['maya','qa-admin'].includes(staff))throw Error('Invalid synthetic principal');
      rejectSubmissions=url.searchParams.get('scenario')==='reject';submittedBodies=[];
      const session=createSession(db,db.prepare('SELECT * FROM staff WHERE id=?').get(staff),'staff',accessMode);
      res.writeHead(302,{'set-cookie':sessionCookie(session.token,session.maxSeconds),'location':rejectAuditChunk?'/#reports/activity':staff==='qa-admin'?'/#settings/retention':'/#people','cache-control':'no-store'});res.end();
    }catch{res.writeHead(503);res.end('Fixture unavailable');}
    return;
  }
  if(url.pathname==='/api/session' && req.method==='GET'){
    sessionReads++;
    if((sessionFailure && sessionReads>1) || (initialSessionFailure && sessionReads===1)){
      requireLocalRequest(req);res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({error:'Synthetic session verification unavailable'}));return;
    }
  }
  if(req.method==='POST' && url.pathname.startsWith('/api/worker/'))workerPosts++;
  if(sourceAudioRoot && req.method==='GET' && url.pathname==='/api/qa-source-recover') {
    requireLocalRequest(req);sourceReadFailure=false;res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});
    res.end('<a href="/#briefings/new">Open source receipt</a>');return;
  }
  if(sourceAudioRoot && req.method==='GET' && url.pathname==='/api/qa-source-process') {
    requireLocalRequest(req);
    const adapter=url.searchParams.get('provider')==='missing'?undefined:{transcribe:async()=>({text:'Synthetic fixture transcript only. Put finished items on the blue shelf and unfinished items on the yellow shelf.'})};
    processOneSourceAudio(db,adapter,sourceAudioRoot).then(()=>{
      res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<p>Disposable synthetic transcription checkpoint processed.</p><a href="/#briefings/new">Open source receipt</a>');
    }).catch(()=>{res.writeHead(503);res.end();});return;
  }
  if(sourceAudioRoot && req.method==='GET' && url.pathname==='/api/qa-source-cleanup') {
    requireLocalRequest(req);
    const revision=db.prepare("SELECT revision FROM retention_policies WHERE org_id='cedar' AND site_id='beirut'").get()?.revision || 0;
    saveRetention(db,owner,{requestId:randomUUID(),revision,audioDays:7,confirmed:true});
    const now=new Date(Date.now()+8*86400000).toISOString();
    (async()=>{for(let n=0;n<20 && await processOneSourceAudioCleanup(db,sourceAudioRoot,{now});n++) {}})().then(()=>{
      res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<p>Disposable synthetic source cleanup processed with a future QA clock.</p><a href="/#briefings/new">Open source receipt</a>');
    }).catch(()=>{res.writeHead(503);res.end();});return;
  }
  if(sourceAudioRoot && req.method==='GET' && url.pathname==='/api/qa-source-evidence') {
    ensureSourceRetrySchema(db);
    requireLocalRequest(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({sourcePosts,sourceReads,sourceBodies,sourceRetryPosts,sourceRetryReads,retries:db.prepare('SELECT retry_id,source_request_id FROM source_audio_retries').all(),receipts:db.prepare('SELECT request_id,status,briefing_id,attempts FROM source_audio_requests ORDER BY created_at').all(),
      purges:db.prepare('SELECT request_id,status,completed_at FROM source_audio_purges').all(),
      acceptedAudit:db.prepare("SELECT count(*) n FROM audit WHERE action='briefing.source_audio_received'").get().n,transcribedAudit:db.prepare("SELECT count(*) n FROM audit WHERE action='briefing.source_audio_transcribed'").get().n}));return;
  }
  if(sourceAudioRoot && /^\/api\/source-audio\/[^/]+\/retries(?:\/[^/]+)?$/.test(url.pathname)) {
    if(req.method==='GET')sourceRetryReads++;
    if(req.method==='POST') {
      sourceRetryPosts++;
      if(sourceRetryBeforeSave){sourceRetryBeforeSave=false;req.resume();res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic interruption before retry acceptance'}));return;}
      if(sourceRetryLostAck){sourceRetryLostAck=false;const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let accepted=false;
        res.writeHead=(status,...args)=>{accepted=status>=200 && status<300;return writeHead(accepted?503:status,...args);};
        res.end=(body,...args)=>end(accepted?JSON.stringify({error:'Synthetic retry acknowledgement lost'}):body,...args);
      }
    }
  }
  if(sourceAudioRoot && req.method==='GET' && /^\/api\/source-audio\/[^/]+$/.test(url.pathname)) {
    sourceReads++;if(sourceReadFailure){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic source receipt outage'}));return;}
  }
  if(sourceAudioRoot && req.method==='POST' && url.pathname==='/api/source-audio') {
    sourcePosts++;const hash=createHash('sha256'),emit=req.emit.bind(req);
    req.emit=(event,...args)=>{if(event==='data')hash.update(args[0]);if(event==='end' && sourceBodies.length<20)sourceBodies.push(hash.digest('hex'));return emit(event,...args);};
    if(sourceBeforeSave){sourceBeforeSave=false;req.resume();res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic interruption before source acceptance'}));return;}
    if(sourceLostAck){sourceLostAck=false;const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let accepted=false;
      res.writeHead=(status,...args)=>{accepted=status>=200 && status<300;return writeHead(accepted?503:status,...args);};
      res.end=(body,...args)=>end(accepted?JSON.stringify({error:'Synthetic source acknowledgement lost'}):body,...args);
    }
  }
  if(req.method==='GET' && url.pathname==='/api/settings/contacts' && rejectContactRead){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic site contact read unavailable'}));return;}
  if(req.method==='GET' && url.pathname==='/api/qa-draft-receipt-recover') {
    requireLocalRequest(req);creationReceiptFailure=false;
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<a href="/#briefings/new">Open draft recovery</a>');return;
  }
  if(req.method==='GET' && url.pathname==='/api/qa-draft-evidence') {
    requireLocalRequest(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({creationPosts,creationReads,creationRequests,receipts:db.prepare('SELECT request_id,request_hash,generation_languages_json FROM draft_creations ORDER BY request_id').all(),createdAudit:db.prepare("SELECT count(*) n FROM audit WHERE action='briefing.created'").get().n,prepared:db.prepare('SELECT b.id,b.state,b.prepared_json FROM briefings b JOIN draft_creations c ON c.briefing_id=b.id ORDER BY b.id').all().map(row=>({id:row.id,state:row.state,languages:row.prepared_json?Object.keys(JSON.parse(row.prepared_json).languages):null}))}));return;
  }
  if(req.method==='GET' && url.pathname.startsWith('/api/draft-creation-receipts/')) {
    creationReads++;if(creationReceiptFailure){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic creation receipt outage'}));return;}
  }
  if(req.method==='POST' && url.pathname==='/api/briefings') {
    creationPosts++;let bytes='';const emit=req.emit.bind(req);
    req.emit=(event,...args)=>{
      if(event==='data' && bytes.length<=30000)bytes+=args[0];
      if(event==='end'){try {const id=JSON.parse(bytes).requestId;if(typeof id==='string' && id.length===36 && creationRequests.length<20)creationRequests.push({id,bodyHash:createHash('sha256').update(bytes).digest('hex')});}catch {}}
      return emit(event,...args);
    };
    if(rejectCreationOnce){rejectCreationOnce=false;req.resume();res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic interruption before draft acceptance'}));return;}
    if(loseCreationAck) {
      loseCreationAck=false;const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let accepted=false;
      res.writeHead=(status,...args)=>{accepted=status>=200 && status<300;return writeHead(accepted?503:status,...args);};
      res.end=(body,...args)=>end(accepted?JSON.stringify({error:'Synthetic draft acknowledgement lost'}):body,...args);
    }
  }
  if(req.method==='GET' && url.pathname==='/api/qa-publication-receipt-recover') {
    requireLocalRequest(req);publicationReceiptFailure=false;
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<a href="/#briefings/qa-publish">Open saved briefing</a>');return;
  }
  if(req.method==='GET' && /\/publication-receipts\//.test(url.pathname)) {
    publicationReceiptReads++;
    if(publicationReceiptFailure){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic publication receipt outage'}));return;}
  }
  if(req.method==='POST' && /^\/api\/briefings\/[^/]+\/publish$/.test(url.pathname)) {
    publicationPosts++;
    // Observe existing stream events without putting the request into flowing mode.
    let bytes='';const emit=req.emit.bind(req);
    req.emit=(event,...args)=>{
      if(event==='data' && bytes.length<=600000)bytes+=args[0];
      if(event==='end'){try {const id=JSON.parse(bytes).requestId;if(typeof id==='string' && id.length===36 && publicationRequestIds.length<20)publicationRequestIds.push(id);}catch {}}
      return emit(event,...args);
    };
    if(rejectPublicationOnce){rejectPublicationOnce=false;req.resume();res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic connection interruption before acceptance'}));return;}
    if(losePublicationAck) {
      losePublicationAck=false;const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let accepted=false;
      res.writeHead=(status,...args)=>{accepted=status>=200 && status<300;return writeHead(accepted?503:status,...args);};
      res.end=(body,...args)=>end(accepted?JSON.stringify({error:'Synthetic publication acknowledgement lost'}):body,...args);
    }
  }
  if(req.method==='POST' && /^\/api\/briefings\/[^/]+\/schedules$/.test(url.pathname)) {
    schedulePosts++;
    if(loseScheduleAck) {
      loseScheduleAck=false;const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let accepted=false;
      res.writeHead=(status,...args)=>{accepted=status>=200 && status<300;return writeHead(accepted?503:status,...args);};
      res.end=(body,...args)=>end(accepted?JSON.stringify({error:'Synthetic schedule acknowledgement lost'}):body,...args);
    }
  }
  if(req.method==='POST' && /^\/api\/briefings\/[^/]+\/schedules\/[^/]+\/cancel$/.test(url.pathname))scheduleCancelPosts++;
  if(req.method==='GET' && process.argv.includes('--schedules') && url.pathname==='/api/qa-run-schedules') {
    requireLocalRequest(req);for(let n=0;n<10 && processOneSchedule(db);n++) {}
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<p>Due synthetic schedules processed.</p><a href="/#briefings/qa-publish">Open saved schedule history</a>');return;
  }
  if(req.method==='GET' && (process.argv.includes('--publish-crews') || process.argv.includes('--draft-languages')) && url.pathname==='/api/qa-run-preparation') {
    const id=process.argv.includes('--draft-languages')?url.searchParams.get('id'):'qa-publish';
    if(!id || !db.prepare("SELECT id FROM briefings WHERE id=? AND org_id='cedar' AND site_id='beirut'").get(id)){res.writeHead(400);res.end('Invalid disposable draft');return;}
    requireLocalRequest(req);for(let n=0;n<10 && processOne(db);n++) {}
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end(`<p>Queued synthetic preparation processed.</p><a href="/#briefings/${encodeURIComponent(id)}">Open current draft</a>`);return;
  }
  if(req.method==='GET' && process.argv.includes('--reminders') && url.pathname==='/api/qa-run-reminders') {
    requireLocalRequest(req);for(let n=0;n<100 && processOneReminder(db);n++) {}
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<p>Due synthetic in-app reminders processed.</p><a href="/">Open current inbox</a>');return;
  }
  if(req.method==='GET' && process.argv.includes('--schedules') && url.pathname==='/api/qa-schedule-evidence') {
    requireLocalRequest(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({schedulePosts,scheduleCancelPosts,publicationPosts,schedules:db.prepare("SELECT state,count(*) n FROM publication_schedules WHERE briefing_id='qa-publish' GROUP BY state").all(),publications:db.prepare("SELECT count(*) n FROM publications WHERE briefing_id='qa-publish'").get().n,assignments:db.prepare("SELECT count(*) n FROM assignments a JOIN publications p ON p.id=a.publication_id WHERE p.briefing_id='qa-publish'").get().n,reminders:db.prepare("SELECT r.state,count(*) n FROM assignment_reminders r JOIN publications p ON p.id=r.publication_id WHERE p.briefing_id='qa-publish' GROUP BY r.state").all()}));return;
  }
  if(req.method==='GET' && process.argv.includes('--civil-time') && url.pathname==='/api/qa-civil-evidence') {
    requireLocalRequest(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({schedulePosts,publicationPosts,times:db.prepare("SELECT request_json FROM publication_schedules WHERE briefing_id='qa-publish' ORDER BY created_at,id").all().map(row=>{const request=JSON.parse(row.request_json);return {publishAt:request.publishAt,dueAt:request.dueAt};})}));return;
  }
  if(req.method==='GET' && /^\/api\/people\/crews\/[^/]+\/recipients$/.test(url.pathname)) {
    crewReads++;
    if(crewReadFailures>0) {
      requireLocalRequest(req);crewReadFailures--;
      setTimeout(()=>{res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic crew preview unavailable'}));},8000);return;
    }
  }
  if(req.method==='GET' && url.pathname==='/api/qa-crew-failure') {
    requireLocalRequest(req);crewReadFailures=1;res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<p>One held synthetic crew read will fail without publishing.</p>');return;
  }
  if(req.method==='GET' && url.pathname==='/api/qa-crew-evidence') {
    requireLocalRequest(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({crewReads,publicationPosts,publicationRequestIds,publicationReceiptReads,schedulePosts,publications:db.prepare("SELECT count(*) n FROM publications WHERE briefing_id='qa-publish'").get().n,assignments:db.prepare("SELECT count(*) n FROM assignments a JOIN publications p ON p.id=a.publication_id WHERE p.briefing_id='qa-publish'").get().n}));return;
  }
  if(req.method==='POST' && /^\/api\/notifications\/[^/]+\/read$/.test(url.pathname)) {
    notificationPosts++;
    if(loseNotificationRead) {
      const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let accepted=false;
      res.writeHead=(status,...args)=>{accepted=status>=200 && status<300;return writeHead(accepted?503:status,...args);};
      res.end=(body,...args)=>end(accepted?JSON.stringify({error:'Synthetic read acknowledgement lost'}):body,...args);
    }
  }
  if(req.method==='GET' && url.pathname==='/api/qa-notification-evidence') {
    requireLocalRequest(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({notificationPosts,reads:db.prepare('SELECT COUNT(*) n FROM notification_reads').get().n,workerPosts}));return;
  }
  if(req.method==='POST' && ['/api/auth/staff/login','/api/auth/worker/login','/api/auth/worker/redeem'].includes(url.pathname))signInPosts++;
  if(req.method==='GET' && /^\/api\/worker\/briefings\/[^/]+\/receipts\//.test(url.pathname)){
    receiptReads++;
    if(rejectReceiptRead){requireLocalRequest(req);res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic receipt read unavailable'}));return;}
  }
  if(loseWorkerReceipt && req.method==='POST' && /^\/api\/worker\/briefings\/[^/]+\/(answers|help)$/.test(url.pathname)){
    const writeHead=res.writeHead.bind(res),end=res.end.bind(res);let accepted=false;
    res.writeHead=(status,...args)=>{accepted=status>=200 && status<300;return writeHead(accepted?503:status,...args);};
    res.end=(body,...args)=>end(accepted?JSON.stringify({error:'Synthetic acknowledgement lost after acceptance'}):body,...args);
  }
  if(req.method==='GET' && /^\/api\/worker\/briefings\/qa-answer-(new|ar|ur)$/.test(url.pathname)){
    detailReads++;
    if(detailFailure && detailReads===2){
      requireLocalRequest(req);res.writeHead(detailFailure,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({error:detailFailure===403?'Forbidden':'Synthetic detail refresh unavailable'}));return;
    }
  }
  if(req.method==='POST' && url.pathname==='/api/logout'){
    logoutPosts++;
    if(rejectLogout){
      requireLocalRequest(req);res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({error:'Synthetic logout rejected without session changes'}));return;
    }
  }
  if(holdWorker && req.method==='POST' && /^\/api\/worker\/briefings\/[^/]+\/answers$/.test(url.pathname)){
    (async()=>{
      requireLocalRequest(req);const chunks=[];for await(const chunk of req)chunks.push(chunk);workerBodies.push(Buffer.concat(chunks).toString());
      setTimeout(()=>{res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic held submission rejected without writes'}));},8000);
    })().catch(()=>{res.writeHead(503);res.end();});return;
  }
  if((malformedWorkerReceipt || mismatchedWorkerReceipt) && req.method==='POST' && /^\/api\/worker\/briefings\/[^/]+\/(answers|help)$/.test(url.pathname)){
    (async()=>{
      requireLocalRequest(req);const chunks=[];for await(const chunk of req)chunks.push(chunk);workerBodies.push(Buffer.concat(chunks).toString());
      const body=JSON.parse(workerBodies.at(-1)),help=url.pathname.endsWith('/help');
      const result=mismatchedWorkerReceipt?{id:help?body.requestId:randomUUID(),...(help?{status:'open'}:{outcome:'matched'}),duplicate:false,requestId:body.submissionId || body.requestId,assignmentId:'other-assignment',clientContext:req.headers['x-client-session-context']}:{id:'invalid',outcome:'matched',duplicate:false};
      res.writeHead(201,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));
    })().catch(()=>{res.writeHead(503);res.end();});return;
  }
  if(url.pathname==='/api/qa-session-evidence' && req.method==='GET'){
    requireLocalRequest(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({workerPosts,logoutPosts,signInPosts,pendingGrantRedeemed:pendingQaGrant ? Boolean(db.prepare('SELECT redeemed_at FROM worker_grants WHERE id=?').get(pendingQaGrant.id)?.redeemed_at) : null,sessionReads,detailReads,receiptReads,heldPosts:workerBodies.length,exactHeldRequest:workerBodies.length>1 && workerBodies.every(body=>body===workerBodies[0]),
      attempts:db.prepare("SELECT count(*) AS n FROM attempts WHERE assignment_id IN ('qa-answer-new','qa-answer-ar','qa-answer-ur')").get().n,
      recordings:db.prepare("SELECT count(*) AS n FROM recordings WHERE assignment_id IN ('qa-answer-new','qa-answer-ar','qa-answer-ur')").get().n}));return;
  }
  if(url.pathname==='/api/privacy/recording-notice' && req.method==='GET' && noticeReadFailures>0){
    requireLocalRequest(req);noticeReadFailures--;
    res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic notice read unavailable'}));return;
  }
  if(rejectNotice && url.pathname==='/api/privacy/recording-notice' && req.method==='POST'){
    (async()=>{
      requireLocalRequest(req);const chunks=[];for await(const chunk of req)chunks.push(chunk);
      noticeBodies.push(Buffer.concat(chunks).toString());
      res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({error:'Synthetic rejected notice submission; no policy write performed'}));
    })().catch(()=>{res.writeHead(503);res.end();});return;
  }
  if(rejectSubmissions && req.method==='POST' && /^\/api\/people\/workers\/[^/]+\/deletion$/.test(url.pathname)){
    (async()=>{
      requireLocalRequest(req);const chunks=[];for await(const chunk of req)chunks.push(chunk);
      submittedBodies.push(Buffer.concat(chunks).toString());
      res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({error:'Synthetic rejected submission; no deletion write performed'}));
    })().catch(()=>{res.writeHead(503);res.end();});return;
  }
  if(url.pathname==='/api/qa-recovery-evidence' && req.method==='GET'){
    requireLocalRequest(req);
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({postCount:submittedBodies.length,exactSameRequest:submittedBodies.every(body=>body===submittedBodies[0]),
      deletionRequests:db.prepare('SELECT count(*) AS count FROM worker_deletion_requests').get().count,
      untouchedTarget:db.prepare("SELECT active FROM workers WHERE id='qa-new'").get().active===1}));return;
  }
  if(url.pathname==='/api/qa-notice-evidence' && req.method==='GET'){
    requireLocalRequest(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({postCount:noticeBodies.length,exactSameRequest:noticeBodies.every(body=>body===noticeBodies[0]),revision:getRecordingNotice(db,owner).revision,blockedChunks}));return;
  }
  if(rejectReportHistory && url.pathname==='/api/reports/publications' && req.method==='GET'){
    requireLocalRequest(req);res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic publication history unavailable'}));return;
  }
  return handler(req,res);
});
await new Promise((resolve,reject)=>{api.once('error',reject);api.listen(apiPort,'127.0.0.1',resolve);});
let ui;
if(process.argv.includes('--built')){
  // Serve the real build; named synthetic scenarios reject individual lazy downloads.
  ui=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    if(path.startsWith('/api/')){api.emit('request',req,res);return;}
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    if(shellOutage && path==='/'){res.writeHead(503,{'cache-control':'no-store'});res.end('Synthetic shell outage');return;}
    if(rejectRecorderChunk && /^\/assets\/WorkerRecorder-[A-Za-z0-9_-]+\.js$/.test(path)){
      blockedChunks++;res.writeHead(503,{'cache-control':'no-store'});res.end('Synthetic recorder download unavailable');return;
    }
    if(rejectAuditChunk && /^\/assets\/Audit-[A-Za-z0-9_-]+\.js$/.test(path)){
      res.writeHead(503,{'cache-control':'no-store'});res.end('Synthetic activity download unavailable');return;
    }
    if(rejectReportChunk && /^\/assets\/Reports-[A-Za-z0-9_-]+\.js$/.test(path)){
      res.writeHead(503,{'cache-control':'no-store'});res.end('Synthetic report download unavailable');return;
    }
    if(rejectDeviceChunk && /^\/assets\/WorkerDevice-[A-Za-z0-9_-]+\.js$/.test(path)){
      res.writeHead(503,{'cache-control':'no-store'});res.end('Synthetic device download unavailable');return;
    }
    if(rejectAudioDraftChunk && /^\/assets\/WorkerAudioDraft-[A-Za-z0-9_-]+\.js$/.test(path)){
      blockedChunks++;res.writeHead(503,{'cache-control':'no-store'});res.end('Synthetic saved-audio controls unavailable');return;
    }
    if(rejectBillingChunk && /^\/assets\/Billing-[A-Za-z0-9_-]+\.js$/.test(path)){
      res.writeHead(503,{'cache-control':'no-store'});res.end('Synthetic invoice download unavailable');return;
    }
    const asset=/^\/assets\/([A-Za-z0-9_.-]+)$/.exec(path);
    const publicFiles={'/sw.js':'application/javascript','/manifest.webmanifest':'application/manifest+json','/favicon.svg':'image/svg+xml','/icon-192.png':'image/png','/icon-512.png':'image/png','/index.html':'text/html','/':'text/html'};
    if(!asset && !publicFiles[path]){res.writeHead(404);res.end();return;}
    try{
      const file=asset?join('dist','assets',asset[1]):join('dist',path==='/'?'index.html':path.slice(1));
      const type=asset?asset[1].endsWith('.css')?'text/css':asset[1].endsWith('.js')?'application/javascript':'application/octet-stream':publicFiles[path];
      let bytes=await readFile(file);
      if(denyBrowserStorage && type==='text/html'){
        const fault=`<script>const nativeOpen=indexedDB.open.bind(indexedDB);indexedDB.open=()=>{throw new DOMException('Synthetic browser storage denied','SecurityError');};addEventListener('DOMContentLoaded',()=>{const button=document.createElement('button');button.textContent='QA: allow browser storage';button.addEventListener('click',async()=>{await fetch('/api/qa-storage-recover');indexedDB.open=nativeOpen;button.remove();});document.body.prepend(button);});</script>`;
        bytes=Buffer.from(bytes.toString().replace('<head>','<head>'+fault));
      }
      res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(bytes);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{ui.once('error',reject);ui.listen(uiPort,'127.0.0.1',resolve);});
}else ui=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit',env:{...process.env,UNDERSTOOD_WEB_PORT:String(uiPort),UNDERSTOOD_API_PORT:String(apiPort)}});
let stopping=false;
function stop(){if(stopping)return;stopping=true;if(ui.close)ui.close();else ui.kill();api.close(()=>{
  db.close();if(sourceAudioRoot && sourceAudioRoot.startsWith(join(tmpdir(),'understood-source-ui-')))void rm(sourceAudioRoot,{recursive:true,force:true});
});}
process.once('SIGINT',stop);process.once('SIGTERM',stop);ui.once('error',stop);ui.once('exit',stop);
console.log(`Disposable deletion UI QA: http://127.0.0.1:${uiPort}/api/qa-bootstrap?staff=qa-admin&scenario=reject. This scenario rejects every deletion POST without writes. In-memory synthetic records only; no worker loop or provider calls.`);
