import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {SUBSCRIPTION_PLANS,providerBudget} from '../server/subscription-plans.mjs';
import {paddleConfig,verifyPaddleWebhook,checkPaddlePrice} from '../server/paddle.mjs';
import {createSubscriptionCheckout,recordSubscriptionEvent,subscriptionStatus} from '../server/postgres/subscriptions.mjs';
import {registrationRequestInput} from '../server/registration-input.mjs';
import {registrationEntitlement} from '../server/pilot-policy.mjs';

const env={UNDERSTOOD_PADDLE_MODE:'sandbox',PADDLE_API_KEY:'synthetic_sdbx',PADDLE_WEBHOOK_SECRET:'synthetic-secret',
  PADDLE_CLIENT_TOKEN:'test_synthetic',PADDLE_PRICE_STARTER:'pri_starter',PADDLE_PRICE_PRO:'pri_pro',PADDLE_PRICE_BUSINESS:'pri_business',PADDLE_PRICE_ENTERPRISE:'pri_enterprise'};
const price={id:'pri_starter',status:'active',unit_price:{currency_code:'USD',amount:'8910'},billing_cycle:{interval:'month',frequency:1},trial_period:null};

test('four fixed-cent discounted plans, paid-only signup, no real checkout fallback',()=>{
  assert.deepEqual(SUBSCRIPTION_PLANS.map(p=>p.monthlyCents),[8910,26910,71910,224910]);
  assert.equal(Object.values(providerBudget('starter')).reduce((a,b)=>a+b,0),1572);
  assert.equal(paddleConfig({}).available,false);
  assert.equal(paddleConfig({...env,UNDERSTOOD_PADDLE_MODE:'live'}).available,false);
  assert.equal(paddleConfig({...env,PADDLE_CLIENT_TOKEN:'live_synthetic'}).available,false);
  assert.throws(()=>checkPaddlePrice({...price,unit_price:{amount:'9900',currency_code:'USD'}},'starter'),/does not match/);
  assert.throws(()=>checkPaddlePrice({...price,trial_period:{interval:'day',frequency:14}},'starter'),/does not match/);
  assert.throws(()=>checkPaddlePrice({...price,unit_price_overrides:[{country_codes:['US'],unit_price:{amount:'1',currency_code:'USD'}}]},'starter'),/does not match/);
  const input={requestId:randomUUID(),ownerName:'Test owner',companyName:'Test company',country:'LB',email:'synthetic@example.com',password:'a synthetic password',acceptTerms:true,acceptPrivacy:true};
  assert.equal(registrationRequestInput(input,'127.0.0.1').plan,'starter');
  assert.deepEqual(SUBSCRIPTION_PLANS.filter(plan=>plan.available).map(plan=>plan.id),['starter']);
  for(const plan of ['pro','business','enterprise'])assert.throws(()=>registrationRequestInput({...input,plan},'127.0.0.1'),/Invalid/);
  assert.throws(()=>registrationRequestInput({...input,plan:'pilot'},'127.0.0.1'),/Invalid/);
  assert.equal(registrationEntitlement('starter').plan,'starter_pending');
  assert.equal(registrationEntitlement('pilot').plan,'starter_pending');
});

test('coming-soon plans cannot start checkout even through a direct API request',async()=>{
  let contacted=false;
  for(const plan of ['pro','business','enterprise'])await assert.rejects(createSubscriptionCheckout(null,null,{plan,requestId:randomUUID()},
    {env,fetchImpl:async()=>{contacted=true;throw Error('Provider should not be contacted');}}),/coming soon/);
  assert.equal(contacted,false);
});

test('Paddle verifies raw signed bytes, rotation signatures, expiry and tampering',()=>{
  const now=Date.now(),ts=Math.floor(now/1000),raw=Buffer.from(JSON.stringify({event_id:'evt_test',event_type:'transaction.completed',occurred_at:new Date(now).toISOString()}));
  const hash=createHmac('sha256','secret').update(`${ts}:`).update(raw).digest('hex');
  assert.equal(verifyPaddleWebhook(raw,`ts=${ts};h1=${'0'.repeat(64)};h1=${hash}`,'secret',{now}).event_id,'evt_test');
  assert.throws(()=>verifyPaddleWebhook(Buffer.concat([raw,Buffer.from(' ')]),`ts=${ts};h1=${hash}`,'secret',{now}),/signature/);
  assert.throws(()=>verifyPaddleWebhook(raw,`ts=${ts};h1=${hash}`,'secret',{now:now+301000}),/signature/);
});

test('durable checkout, tenant authorization and signed-payment grant are replay safe without real access',async()=>{
  const db=new PGlite(),schema='subscription_test';
  const pool={async connect(){return {async query(sql,args){return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};}};
  try{
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog;`);
    await runMigrations(pool,{schema});
    await db.exec("INSERT INTO organizations VALUES('a','Test A'),('b','Test B');INSERT INTO sites VALUES('a','a','Test','UTC'),('b','b','Other','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner'),('other','b','b','Other','owner'),('supervisor','a','a','Supervisor','supervisor');");
    const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'},options={schema,env};
    let calls=0;
    const fetchImpl=async(url,init)=>{calls++;if(url.includes('/prices/'))return Response.json({data:price});
      assert.equal(JSON.parse(init.body).items[0].price_id,'pri_starter');return Response.json({data:{id:'txn_synthetic'}});};
    const input={plan:'starter',requestId:randomUUID()};
    await assert.rejects(createSubscriptionCheckout(pool,{...owner,principal_id:'supervisor',role:'supervisor'},input,{...options,fetchImpl}),/Forbidden/);
    const result=await createSubscriptionCheckout(pool,owner,input,{...options,fetchImpl});assert.equal(result.transactionId,'txn_synthetic');assert.equal(calls,2);
    await createSubscriptionCheckout(pool,owner,input,{...options,fetchImpl});assert.equal(calls,2);
    await assert.rejects(createSubscriptionCheckout(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},input,{...options,fetchImpl}),/conflict/);
    await assert.rejects(createSubscriptionCheckout(pool,owner,{...input,requestId:randomUUID()},{...options,fetchImpl}),/already exists/);
    const event={event_id:'evt_payment',event_type:'transaction.completed',occurred_at:new Date().toISOString(),data:{id:'txn_synthetic',status:'completed',collection_mode:'automatic',currency_code:'USD',subscription_id:'sub_synthetic',
      custom_data:{understood_checkout:input.requestId,understood_org:'a',understood_plan:'starter'},items:[{price,quantity:1}],billing_period:{starts_at:'2026-11-18T00:00:00Z',ends_at:'2026-12-18T00:00:00Z'}}};
    await assert.rejects(recordSubscriptionEvent(pool,{...event,data:{...event.data,currency_code:'EUR'}},options),/does not match/);
    assert.equal((await db.query('SELECT count(*)::int n FROM subscription_payment_events')).rows[0].n,0);
    assert.equal((await recordSubscriptionEvent(pool,event,options)).fundingState,'sandbox_only');
    assert.equal((await recordSubscriptionEvent(pool,event,options)).duplicate,true);
    await recordSubscriptionEvent(pool,{...event,event_id:'evt_second_notification'},options);
    assert.equal((await db.query('SELECT count(*)::int n FROM subscription_allowance_grants')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int n FROM organization_entitlements')).rows[0].n,0);
    assert.equal((await subscriptionStatus(pool,owner,options)).providerFunding,'not_funded');
    await assert.rejects(db.exec('DELETE FROM subscription_allowance_grants'),/immutable/);
    await assert.rejects(db.exec("UPDATE subscription_checkouts SET org_id='b'"),/immutable/);
    // An unknown network outcome must not create another bill on retry.
    const other={...owner,principal_id:'other',org_id:'b',site_id:'b'},unknown={plan:'starter',requestId:randomUUID()};let attempts=0;
    const lost=async url=>{attempts++;if(url.includes('/prices/'))return Response.json({data:price});throw Error('Connection lost');};
    await assert.rejects(createSubscriptionCheckout(pool,other,unknown,{...options,fetchImpl:lost}),/Connection lost/);
    await assert.rejects(createSubscriptionCheckout(pool,other,unknown,{...options,fetchImpl:lost}),/needs review/);assert.equal(attempts,2);
  }finally{await db.close();}
});
