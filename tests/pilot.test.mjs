import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import * as sqlite from '../server/pilot.mjs';
import * as postgres from '../server/postgres/pilot.mjs';
import {pilotInput,pilotDestination} from '../server/pilot-input.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {createAppServer} from '../server/index.mjs';
import {sqliteApp} from './helpers/sqlite-app.mjs';
import {createVercelNeonHandler} from '../server/vercel-neon.mjs';


const input=()=>({requestId:randomUUID(),receiptToken:randomBytes(32).toString('hex'),company:'Synthetic Works',email:'contact@example.test',teamSize:30,languages:['ar','en'],message:'Synthetic pilot inquiry.',consent:true});
const mail={available:true,apiKey:'re_synthetic',from:'sender@example.test'};
for(const backend of ['sqlite','postgres'])test(`${backend}: pilot persistence, replay, private receipts, bounded mail and contact expiry`,async()=>{
  let db,pool,query,api,options={destination:'owner@example.test',mail};
  if(backend==='sqlite') {db=openDatabase(':memory:');sqlite.ensurePilotSchema(db);query=async(sql,values=[])=>db.prepare(sql).all(...values);api={save:(value,address,config)=>sqlite.savePilot(db,value,address,config),read:(id,secret)=>sqlite.readPilot(db,id,secret),process:config=>sqlite.processOnePilot(db,mail,config)};}
  else {db=new PGlite();pool={async connect(){return {query:async(sql,values)=>values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};await runMigrations(pool);query=async(sql,values=[])=>(await db.query(sql.replaceAll('?',()=>`$${++query.index}`),values)).rows;query.index=0;
    api={save:(value,address,config)=>postgres.savePilot(pool,value,address,config),read:(id,secret)=>postgres.readPilot(pool,id,secret),process:config=>postgres.processOnePilot(pool,mail,config)};}
  try {
    const value=input(),saved=await api.save(value,'synthetic-ip',{});assert.equal(saved.delivery,'saved');assert.equal(saved.id,value.requestId);
    assert.equal((await api.save(value,'synthetic-ip',{})).delivery,'saved');
    await assert.rejects(async()=>api.save({...value,company:'Changed'},'synthetic-ip',{}),/conflict/);
    assert.deepEqual(await api.read(value.requestId,'a'.repeat(64)),{found:false});
    assert.deepEqual(await api.read(value.requestId,value.receiptToken),saved);
    assert.ok(!JSON.stringify(saved).includes('contact@example.test'));
    const queued=input();assert.equal((await api.save(queued,'second-ip',options)).delivery,'queued');
    let calls=0;const fetchImpl=async(url,request)=>{calls++;assert.equal(url,'https://api.resend.com/emails');assert.equal(request.headers['idempotency-key'],`pilot/${queued.requestId}`);const body=JSON.parse(request.body);assert.deepEqual(body.to,['owner@example.test']);assert.ok(body.text.includes('contact@example.test'));return new Response(JSON.stringify({id:'synthetic-mail-id'}));};
    assert.equal(await api.process({destination:'different@example.test',fetchImpl}),false);assert.equal(calls,0);
    assert.equal(await api.process({...options,fetchImpl}),true);assert.equal(calls,1);assert.equal((await api.read(queued.requestId,queued.receiptToken)).delivery,'sent');
    assert.equal(await api.process({...options,fetchImpl}),false);assert.equal(calls,1);
    const failures=input();await api.save(failures,'third-ip',options);
    const badFetch=async()=>{throw Error('Synthetic outage');};
    for(let attempt=0;attempt<3;attempt++){assert.equal(await api.process({...options,fetchImpl:badFetch}),true);if(backend==='sqlite')db.prepare("UPDATE pilot_inquiries SET next_at='2000-01-01T00:00:00Z' WHERE id=?").run(failures.requestId);else await db.query("UPDATE pilot_inquiries SET next_at='2000-01-01' WHERE id=$1",[failures.requestId]);}
    assert.equal((await api.read(failures.requestId,failures.receiptToken)).delivery,'failed');
    if(backend==='sqlite')db.prepare("UPDATE pilot_inquiries SET expires_at=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),value.requestId);
    else await db.query("UPDATE pilot_inquiries SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[value.requestId]);
    await api.process(options);assert.equal((await api.read(value.requestId,value.receiptToken)).delivery,'expired');
    query.index=0;const rows=await query('SELECT content_json,destination,receipt_hash FROM pilot_inquiries WHERE id=?',[value.requestId]);assert.equal(rows[0].content_json,null);assert.equal(rows[0].destination,null);assert.notEqual(rows[0].receipt_hash,value.receiptToken);
    for(let n=0;n<5;n++)await api.save({...input(),email:`synthetic-${n}@example.test`},'rate-ip',{});
    await assert.rejects(async()=>api.save(input(),'rate-ip',{}),/limit/);
  }finally{await db.close();}
});

test('the Vercel pilot route works without a socket and sends each Gmail notification at most once',async()=>{
  const db=new PGlite();
  const pool={async connect(){return {query:async(sql,values)=>values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  const host='app.understood.co';
  const env={VERCEL_PROJECT_PRODUCTION_URL:host,UNDERSTOOD_NEON_AUTH_URL:'https://ep-fixture.neonauth.c-8.eu-central-1.aws.neon.tech/neondb/auth',UNDERSTOOD_AUTH_MAIL_KEY:'a'.repeat(64),UNDERSTOOD_POSTGRES_SCHEMA:'public'};
  try {
    await runMigrations(pool);
    const {handler}=await createVercelNeonHandler({env,pool});
    const headers={host,'x-forwarded-proto':'https','x-vercel-forwarded-for':'203.0.113.10'};
    const submit=(value,address=headers['x-vercel-forwarded-for'])=>Object.assign(Readable.from([Buffer.from(JSON.stringify(value))]),{
      url:'/api/public/pilot',method:'POST',headers:{...headers,'x-vercel-forwarded-for':address,origin:`https://${host}`,'content-type':'application/json'},
    });
    const read=value=>({url:`/api/public/pilot/${value.requestId}`,method:'GET',headers:{...headers,'x-pilot-receipt':value.receiptToken}});
    async function invoke(handle,request) {
      let status,body;
      await handle(request,{setHeader(){},writeHead(code){status=code;},end(json){body=JSON.parse(json);}});
      return {status,body};
    }
    const value=input(),saved=await invoke(handler,submit(value));
    assert.equal(saved.status,202);
    assert.equal(saved.body.delivery,'saved');
    assert.deepEqual(await invoke(handler,read(value)),{status:200,body:saved.body});

    const recipient='recipient@example.test';
    const gmailEnv={...env,UNDERSTOOD_PILOT_TO:recipient,UNDERSTOOD_PILOT_GMAIL_USER:'sender@gmail.com',UNDERSTOOD_PILOT_GMAIL_APP_PASSWORD:'aaaa bbbb cccc dddd'};
    const started=Promise.withResolvers(),accept=Promise.withResolvers();
    const messages=[];
    const {handler:withGmail}=await createVercelNeonHandler({env:gmailEnv,pool,createPilotTransport(options){
      assert.equal(options.host,'smtp.gmail.com');assert.equal(options.secure,true);
      assert.deepEqual(options.auth,{user:'sender@gmail.com',pass:'aaaabbbbccccdddd'});
      return {async sendMail(message){
        messages.push(message);
        if(messages.length===1){started.resolve();await accept.promise;}
        if(messages.length>1)throw Object.assign(Error('Synthetic SMTP failure'),{code:'EAUTH'});
        return {accepted:[recipient],messageId:message.messageId};
      }};
    }});
    assert.deepEqual(await invoke(withGmail,submit(value)),saved);
    assert.equal(messages.length,0);
    const current=input();
    const inFlight=invoke(withGmail,submit(current));
    await Promise.race([started.promise,inFlight]);
    try {
      assert.equal((await invoke(withGmail,submit(current))).body.delivery,'processing');
      assert.equal((await invoke(withGmail,read(current))).body.delivery,'processing');
    } finally {accept.resolve();}
    const result=await inFlight;
    assert.equal(result.status,202);
    assert.equal(result.body.delivery,'sent');
    assert.deepEqual(await invoke(withGmail,submit(current)),result);
    assert.equal(messages.length,1);
    assert.deepEqual(messages[0].to,{address:recipient});
    assert.match(messages[0].text,/Synthetic pilot inquiry/);
    assert.equal(messages[0].subject,'New Understood pilot request');

    const failing={...input(),email:'failing@example.test'};
    const failure=await invoke(withGmail,submit(failing,'203.0.113.11'));
    assert.equal(failure.status,202);
    assert.equal(failure.body.delivery,'failed');
    assert.deepEqual(await invoke(withGmail,submit(failing,'203.0.113.11')),failure);
    assert.equal(messages.length,2);
  } finally {await db.close();}
});

test('pilot input is strict; public HTTP stores without a session and never claims disabled delivery',async()=>{
  const value=input();
  for(const change of [{consent:false},{teamSize:0},{teamSize:2.5},{languages:['xyz']},{languages:['en','en']},{languages:[...WORKER_LANGUAGE_CODES,'en']},{email:'x\r\n@example.test'},{company:'x\u0000'},{extra:true},{receiptToken:'abc'}])assert.throws(()=>pilotInput({...value,...change}),/Invalid/);
  assert.deepEqual(pilotInput({...value,languages:['hi','en']}).content.languages,['en','hi']);
  assert.equal(pilotInput({...value,languages:[...WORKER_LANGUAGE_CODES]}).content.languages.length,WORKER_LANGUAGE_CODES.length);
  assert.throws(()=>pilotDestination('User@Example.test'),/Invalid/);
  const db=openDatabase(':memory:'),server=sqliteApp(db,{mail:{mode:'disabled'}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    const response=await fetch(`${origin}/api/public/pilot`,{method:'POST',headers:{origin:'http://127.0.0.1:3020','content-type':'application/json'},body:JSON.stringify(value)});
    assert.equal(response.status,202);assert.equal((await response.json()).delivery,'saved');
    const receipt=await fetch(`${origin}/api/public/pilot/${value.requestId}`,{headers:{'x-pilot-receipt':value.receiptToken}});assert.equal(receipt.status,200);assert.equal((await receipt.json()).found,true);
    const forged=await fetch(`${origin}/api/public/pilot`,{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:JSON.stringify(input())});assert.equal(forged.status,403);
  }finally{await new Promise(done=>server.close(done));db.close();}
});
