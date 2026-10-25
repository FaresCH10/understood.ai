import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {withPostgresClient,withTransaction} from '../server/postgres/db.mjs';
import {bootstrapWorkspace} from '../server/postgres/workspace-bootstrap.mjs';
import {authenticateStaff,requireSession,issueWorkerGrant} from '../server/postgres/auth.mjs';
import {createWorker} from '../server/postgres/people.mjs';
import {readGlossarySnapshot} from '../server/postgres/glossary.mjs';
import {readGenerationLanguages} from '../server/postgres/settings.mjs';
import {rehearsalConfig,startRehearsalApi} from '../server/postgres/runtime.mjs';
import {processOneSourceAudio} from '../server/postgres/source-audio-worker.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {processOneRecording} from '../server/postgres/recording-worker.mjs';
import {resolveSourceTranscription} from '../server/ai/source-transcription-config.mjs';
import {resolvePreparationAdapter,preparationInputHash} from '../server/ai/preparation-config.mjs';
import {resolveRecordingAdapter} from '../server/ai/recording-config.mjs';
import {createGeminiAdapter} from '../server/ai/gemini.mjs';
import {localAudioStore} from '../server/private-storage.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';

const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const ARTIFACTS=join(ROOT,'artifacts','ui-demo');
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const runDir=join(ARTIFACTS,runId);
const schema='understood_test_ui_demo';
const apiPort=3031,webPort=3243,fixturePort=3032;
const events=[];
function record(stage,detail='') {
  const event={at:new Date().toISOString(),stage,...(detail?{detail}:{})};
  events.push(event);
  appendFileSync(join(runDir,'events.jsonl'),JSON.stringify(event)+'\n');
  console.log(`[ui-demo] ${stage}${detail?': '+detail:''}`);
}
function envFile(path) {
  try {return parseEnv(readFileSync(path,'utf8'));} catch {return {};}
}
function required(value,name) {
  if(typeof value!=='string' || !value.trim())throw Error(`${name} is unavailable`);
  return value;
}

mkdirSync(runDir,{recursive:true,mode:0o700});
const repoEnv=envFile(join(ROOT,'.env')),localEnv=envFile(join(ROOT,'.env.production.local'));
const geminiKey=required(repoEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY,'GEMINI_API_KEY');
const openrouterKey=required(localEnv.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY,'OPENROUTER_API_KEY');
const openrouterModel=localEnv.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || 'minimax/minimax-m3.1-flash:free';

const env={...process.env,
  UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_DATA_CLASS:'synthetic',
  UNDERSTOOD_PUBLIC_ORIGIN:`http://127.0.0.1:${webPort}`,UNDERSTOOD_REHEARSAL_PORT:String(apiPort),
  UNDERSTOOD_POSTGRES_SCHEMA:schema,UNDERSTOOD_REHEARSAL_AUDIO_ROOT:join(runDir,'audio'),
  UNDERSTOOD_SOURCE_TRANSCRIPTION:'gemini-free',UNDERSTOOD_PREPARATION_ADAPTER:'openrouter-gemini',
  UNDERSTOOD_RECORDING_ADAPTER:'openrouter-gemini',
  UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:JSON.stringify(['0'.repeat(64)]),
  UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify(['0'.repeat(64)]),
  GEMINI_API_KEY:geminiKey,OPENROUTER_API_KEY:openrouterKey,OPENROUTER_MODEL:openrouterModel};

// PGlite exposes one session. Serializing whole leases keeps nested API transactions from interleaving.
function serialPool(db) {
  let tail=Promise.resolve();
  return {async connect() {
    let release;
    const held=new Promise(resolve=>{release=resolve;});
    const previous=tail;tail=held;
    await previous;
    let open=true;
    return {
      async query(sql,args) {
        if(!open)throw Error('PostgreSQL lease already released');
        return Array.isArray(args)&&args.length ? db.query(sql,args) : (await db.exec(sql)).at(-1) ?? {rows:[]};
      },
      release() {if(open){open=false;release();}},
    };
  }};
}
async function fixtureSpeech(text,label) {
  let used=false;
  const adapter=createGeminiAdapter({apiKey:geminiKey,dataClass:'synthetic',requestJournal:{
    async beforeRequest(){if(used)throw Error('Fixture speech budget exhausted');used=true;return randomUUID();},
    async afterRequest(){},
  }});
  const bytes=await adapter.speech(text,'en');
  if(!bytes?.length)throw Error(`Gemini speech returned no audio for ${label}`);
  return bytes;
}

const db=new PGlite(join(runDir,'database')),pool=serialPool(db),storage=localAudioStore(env.UNDERSTOOD_REHEARSAL_AUDIO_ROOT);
let server,vite,fixtureServer,workerFixture=null,supervisorFixture=null,stopping=false;
const demo={runId,runDir,status:'starting',schema,apiOrigin:`http://127.0.0.1:${apiPort}`,webOrigin:`http://127.0.0.1:${webPort}`};
try {
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);
  await runMigrations(pool,{schema});
  await db.exec(`SET search_path TO ${schema},pg_catalog`);
  record('database','isolated PGlite schema migrated');

  const password='Synthetic-'+randomBytes(18).toString('hex');
  const bootstrap={requestId:randomUUID(),synthetic:true,confirmed:true,organizationName:'Synthetic Harbour Logistics',
    siteName:'Synthetic Beirut Depot',timezone:'Asia/Beirut',generationLanguages:['en'],supportEmail:'support@example.test',
    owner:{name:'Synthetic Supervisor',email:'supervisor@example.test',password}};
  const config={...rehearsalConfig(env),schema,integrationMode:'synthetic',dataClass:'synthetic'};
  const scope=await bootstrapWorkspace(pool,bootstrap,config);
  const login=await authenticateStaff(pool,bootstrap.owner.email,password,'127.0.0.1',{schema});
  const owner=await requireSession(pool,{headers:{cookie:`understood_pg_rehearsal=${login.session.token}`}},{schema,cookieName:'understood_pg_rehearsal'});
  const worker=await createWorker(pool,owner,{code:'Synthetic W-001',language:'en'},{schema});
  const grant=await issueWorkerGrant(pool,owner,worker.id,1440,{schema});
  await withPostgresClient(pool,client=>client.query(`INSERT INTO ${schema}.provider_policies(scope_key,org_id,revision,enabled,max_daily_requests)
    VALUES('global',NULL,1,true,200),($1,$2,1,true,200)`,['tenant:'+scope.orgId,scope.orgId]));
  Object.assign(demo,{status:'seeded',organization:scope,worker:{id:worker.id,code:worker.code,language:worker.language},
    owner:{email:bootstrap.owner.email,password},workerToken:grant.token,workerGrantExpiresAt:grant.expiresAt});
  writeFileSync(join(ARTIFACTS,'current.json'),JSON.stringify({runId,runDir},null,2)+'\n');
  record('workspace','synthetic owner, worker and provider policy seeded');

  const supervisorBytes=await fixtureSpeech(CANONICAL_SOURCE,'supervisor source');
  writeFileSync(join(runDir,'supervisor.wav'),supervisorBytes);
  supervisorFixture={path:join(runDir,'supervisor.wav'),bytes:supervisorBytes.length,text:CANONICAL_SOURCE};
  demo.supervisorFixture={ready:true,bytes:supervisorBytes.length};
  record('fixture','supervisor voice fixture generated');

  fixtureServer=createServer((req,res)=>{
    res.setHeader('access-control-allow-origin','*');
    res.setHeader('cache-control','no-store');
    if(req.url==='/status'){res.setHeader('content-type','application/json');res.end(JSON.stringify(demo));return;}
    const file=req.url==='/supervisor.wav'?supervisorFixture?.path:req.url==='/worker.wav'?workerFixture?.path:null;
    if(!file){res.statusCode=404;res.end('not found');return;}
    res.setHeader('content-type','audio/wav');res.setHeader('content-length',readFileSync(file).length);res.end(readFileSync(file));
  });
  await new Promise((done,reject)=>{fixtureServer.once('error',reject);fixtureServer.listen(fixturePort,'127.0.0.1',()=>{fixtureServer.off('error',reject);done();});});
  record('fixture-server','ready');

  async function read(sql,args=[]) {
    return withPostgresClient(pool,client=>client.query(sql,args));
  }
  async function pending(where,order='created_at') {
    return (await read(`SELECT * FROM ${schema}.${where} ORDER BY ${order} LIMIT 1`)).rows[0];
  }
  async function preparationFor(job) {
    return withTransaction(pool,async tx=>{
      await tx.query(`SELECT set_config('search_path',quote_ident($1)||',pg_catalog',true)`,[schema]);
      const briefing=(await tx.query('SELECT source,state,revision FROM briefings WHERE id=$1',[job.briefing_id])).rows[0];
      const review=(await tx.query('SELECT content_json FROM draft_reviews WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[job.briefing_id,job.org_id,job.site_id])).rows[0]?.content_json ?? null;
      const glossary=await readGlossarySnapshot(tx,job.org_id,job.site_id);
      const languages=await readGenerationLanguages(tx,job.org_id,job.site_id,['en'],job.briefing_id);
      const input={source:briefing.source,revision:job.revision,languages,review,glossary};
      return {input,hash:preparationInputHash(input)};
    });
  }
  async function generateWorkerFixture() {
    if(workerFixture)return;
    const publication=(await read(`SELECT id,snapshot_json FROM ${schema}.publications WHERE state='published' ORDER BY published_at DESC LIMIT 1`)).rows[0];
    if(!publication)return;
    const snapshot=publication.snapshot_json,askedFacts=snapshot?.rubric?.askedFacts;
    if(!Array.isArray(askedFacts)||!askedFacts.length)return;
    const answerText=askedFacts.map(fact=>String(fact).trim().replace(/[.?!]+$/,'')).join('. ')+'.';
    const bytes=await fixtureSpeech(answerText,'worker answer');
    const path=join(runDir,'worker.wav');
    writeFileSync(path,bytes);
    writeFileSync(join(runDir,'worker-answer.json'),JSON.stringify({publicationId:publication.id,answerText,bytes:bytes.length},null,2)+'\n');
    workerFixture={path,bytes:bytes.length,text:answerText,publicationId:publication.id};
    demo.workerFixture={ready:true,bytes:bytes.length,answerText,publicationId:publication.id};
    record('fixture','worker voice fixture generated from frozen asked facts');
  }
  async function cycle() {
    const source=(await pending(`source_audio_requests WHERE status='received' OR (status='processing' AND lease_until<=clock_timestamp())`));
    if(source) {
      const adapter=resolveSourceTranscription({...env,UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:JSON.stringify([source.sha256])});
      if(await processOneSourceAudio(pool,adapter,storage,{schema,integrationMode:'synthetic'}))
        record('source','source audio processed');
    }
    const job=(await pending(`jobs WHERE kind='prepare' AND status='queued' AND due_at<=clock_timestamp()`));
    if(job) {
      const prepared=await preparationFor(job);
      const adapter=resolvePreparationAdapter({...env,UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([prepared.hash])});
      if(await processOnePreparation(pool,{schema,integrationMode:'synthetic',adapter,storage,languages:['en']}))
        record('preparation','preparation job processed');
    }
    const recording=(await pending(`recordings WHERE (status='received' AND (retry_at IS NULL OR retry_at<=clock_timestamp())) OR (status='processing' AND lease_until<=clock_timestamp())`));
    if(recording) {
      const adapter=resolveRecordingAdapter({...env,UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:JSON.stringify([recording.sha256])});
      if(await processOneRecording(pool,adapter,storage,{schema,integrationMode:'synthetic'}))
        record('recording','worker recording processed');
    }
    await generateWorkerFixture();
    const published=(await read(`SELECT id FROM ${schema}.publications WHERE state='published' ORDER BY published_at DESC LIMIT 1`)).rows[0];
    if(published)demo.publicationId=published.id;
    const attempt=(await read(`SELECT outcome FROM ${schema}.attempts ORDER BY received_at DESC LIMIT 1`)).rows[0];
    if(attempt)demo.lastOutcome=attempt.outcome;
    demo.status=published?'published':'seeded';
  }
  async function loop() {
    while(!stopping) {
      try {await cycle();} catch(error) {record('cycle-error',error.message);}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
  server=await startRehearsalApi(pool,storage,config);
  record('api',`listening on ${demo.apiOrigin}`);
  void loop();

  vite=spawn(process.execPath,[join(ROOT,'node_modules','vite','bin','vite.js')],{cwd:ROOT,stdio:'inherit',
    env:{...process.env,UNDERSTOOD_WEB_PORT:String(webPort),UNDERSTOOD_API_PORT:String(apiPort)}});
  for(let attempt=0;attempt<60;attempt++) {
    try {const response=await fetch(`http://127.0.0.1:${webPort}/`);if(response.ok)break;} catch {}
    await new Promise(resolve=>setTimeout(resolve,500));
    if(attempt===59)throw Error('Web server did not start');
  }
  demo.status='ready';
  writeFileSync(join(runDir,'demo.json'),JSON.stringify(demo,null,2)+'\n');
  writeFileSync(join(ARTIFACTS,'current.json'),JSON.stringify({runId,runDir,statusPath:`http://127.0.0.1:${fixturePort}/status`},null,2)+'\n');
  record('ready','open the UI and use the synthetic workspace');
  console.log(JSON.stringify({webOrigin:demo.webOrigin,apiOrigin:demo.apiOrigin,fixtureStatus:`http://127.0.0.1:${fixturePort}/status`,artifacts:runDir,credentials:'artifacts/ui-demo/current.json'}));
  const shutdown=async()=>{
    if(stopping)return;stopping=true;record('shutdown');
    try {await new Promise(resolve=>server.close(resolve));}catch {}
    try {await new Promise(resolve=>fixtureServer.close(resolve));}catch {}
    try {vite?.kill();}catch {}
    try {await db.close();}catch {}
  };
  process.on('SIGINT',()=>void shutdown().then(()=>process.exit(0)));
  process.on('SIGTERM',()=>void shutdown().then(()=>process.exit(0)));
  await new Promise(resolve=>server.once('close',resolve));
  await shutdown();
} catch(error) {
  demo.status='failed';demo.error=error.message;
  try {writeFileSync(join(runDir,'demo.json'),JSON.stringify(demo,null,2)+'\n');} catch {}
  record('failed',error.message);
  try {vite?.kill();}catch {}
  try {await db.close();}catch {}
  process.exitCode=1;
}
