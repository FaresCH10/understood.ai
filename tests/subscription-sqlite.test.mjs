import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {sqliteApp,TEST_PASSWORD} from './helpers/sqlite-app.mjs';

const env={UNDERSTOOD_PADDLE_MODE:'sandbox',PADDLE_API_KEY:'synthetic_sdbx',PADDLE_CLIENT_TOKEN:'test_synthetic',PADDLE_PRICE_STARTER:'pri_starter'};
const price={id:'pri_starter',status:'active',unit_price:{currency_code:'USD',amount:'8910'},billing_cycle:{interval:'month',frequency:1},trial_period:null};

test('local pending account can load checkout, reconcile a verified Paddle transaction, and enter a read-only dashboard without webhooks',async()=>{
  const db=openDatabase(':memory:');let payment,providerCalls=0;
  const server=sqliteApp(db,{paddleEnv:env,paddleFetch:async(url,init)=>{
    providerCalls++;
    if(url.endsWith('/prices/pri_starter'))return Response.json({data:price});
    if(url.endsWith('/transactions')&&init.method==='POST'){
      payment={id:'txn_local',status:'ready',collection_mode:'automatic',currency_code:'USD',subscription_id:'sub_local',
        custom_data:JSON.parse(init.body).custom_data,items:[{quantity:1,price}],billing_period:{starts_at:new Date(Date.now()-10000).toISOString(),ends_at:new Date(Date.now()+86400000).toISOString()}};
      return Response.json({data:payment});
    }
    assert(url.endsWith('/transactions/txn_local'));return Response.json({data:payment});
  }});
  db.prepare("INSERT INTO organization_entitlements(org_id,state,started_at,worker_limit,plan,terms_reference,revision,updated_by,updated_at) VALUES('cedar','read_only',?,1,'starter_pending',NULL,1,'registration',?)").run(new Date().toISOString(),new Date().toISOString());
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const login=await fetch(base+'/api/auth/staff/login',{method:'POST',headers:{origin:'http://127.0.0.1:3020','content-type':'application/json'},body:JSON.stringify({email:'maya@example.test',password:TEST_PASSWORD})});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const session=await fetch(base+'/api/session',{headers:{cookie}}).then(r=>r.json());
    assert.equal(session.sandboxSubscription,false);assert.equal(session.workspacePlan,'starter_pending');
    const headers={cookie,origin:'http://127.0.0.1:3020','content-type':'application/json','x-client-session-context':session.clientContext};
    const request=(path,body)=>fetch(base+path,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});
    const initial=await request('/api/subscriptions');assert.equal(initial.status,200);assert.equal((await initial.json()).checkoutAvailable,true);
    assert.equal((await request('/api/overview')).status,403);
    const checkout=await request('/api/subscriptions/checkout',{requestId:randomUUID(),plan:'starter'});assert.equal(checkout.status,200);assert.equal((await checkout.json()).transactionId,'txn_local');
    assert.equal((await request('/api/subscriptions').then(r=>r.json())).dashboardAvailable,false);
    // Data obtained from a browser event cannot unlock access. Paddle API proof must match the stored transaction and price.
    payment={...payment,status:'completed',currency_code:'EUR'};
    assert.equal((await request('/api/subscriptions').then(r=>r.json())).dashboardAvailable,false);
    assert.equal(db.prepare('SELECT count(*) n FROM subscription_allowance_grants').get().n,0);
    payment={...payment,currency_code:'USD'};
    const verified=await request('/api/subscriptions').then(r=>r.json());assert.equal(verified.dashboardAvailable,true);assert.equal(verified.checkoutAvailable,false);
    const after=await fetch(base+'/api/session',{headers:{cookie}}).then(r=>r.json());assert.equal(after.sandboxSubscription,true);
    assert.equal((await request('/api/overview')).status,200);
    for(const path of ['/api/instructions/send','/api/briefings'])assert.equal((await request(path,{})).status,403);
    for(const path of ['/api/processing','/api/source-audio','/api/instructions/sends/anything'])assert.equal((await request(path)).status,403);
    const calls=providerCalls;await request('/api/subscriptions');assert.equal(providerCalls,calls);
    assert.equal((await request('/api/subscriptions/checkout',{requestId:randomUUID(),plan:'starter'})).status,409);
    assert.equal(db.prepare('SELECT count(*) n FROM subscription_allowance_grants').get().n,1);
    assert.equal(db.prepare("SELECT state FROM organization_entitlements WHERE org_id='cedar'").get().state,'read_only');
    assert.throws(()=>db.exec('DELETE FROM subscription_allowance_grants'),/immutable/);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('unconfigured local checkout reports disabled instead of blocking subscription details as pending',async()=>{
  const db=openDatabase(':memory:'),server=sqliteApp(db,{paddleEnv:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const login=await fetch(base+'/api/auth/staff/login',{method:'POST',headers:{origin:'http://127.0.0.1:3020','content-type':'application/json'},body:JSON.stringify({email:'maya@example.test',password:TEST_PASSWORD})});
    const cookie=login.headers.get('set-cookie').split(';')[0],session=await fetch(base+'/api/session',{headers:{cookie}}).then(r=>r.json());
    const result=await fetch(base+'/api/subscriptions',{headers:{cookie,'x-client-session-context':session.clientContext}});assert.equal(result.status,200);assert.equal((await result.json()).checkoutAvailable,false);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
