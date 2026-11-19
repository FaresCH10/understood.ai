import {domainTransaction,requirePrincipal} from './domain.mjs';
import {paddleConfig,paddleRequest,checkPaddlePrice} from '../paddle.mjs';
import {SUBSCRIPTION_PLANS,subscriptionPlan,providerBudget,isAvailableSubscriptionPlan} from '../subscription-plans.mjs';
import {sandboxDashboardAccess} from './sandbox-subscription.mjs';

export async function subscriptionStatus(pool,session,{schema='public',env=process.env}={}){
  const config=paddleConfig(env);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner']);
    const grants=(await client.query(`SELECT transaction_id,plan,characters,transcription_minutes,funding_state,period_start,period_end
      FROM subscription_allowance_grants WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`,[session.org_id])).rows;
    const dashboardAvailable=await sandboxDashboardAccess(client,session.org_id);
    return {mode:config.mode,checkoutAvailable:config.available&&!dashboardAvailable,dashboardAvailable,plans:SUBSCRIPTION_PLANS,grant:grants[0]??null,
      providerFunding:'not_funded',liveCheckoutAvailable:false};
  });
}

export async function createSubscriptionCheckout(pool,session,input,{schema='public',env=process.env,fetchImpl=fetch}={}){
  if(!input||Object.keys(input).some(key=>!['plan','requestId'].includes(key))||!subscriptionPlan(input.plan)
    ||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId||''))throw Error('Invalid subscription request');
  if(!isAvailableSubscriptionPlan(input.plan))throw Error('This plan is coming soon. Choose Starter for now.');
  const config=paddleConfig(env);if(!config.available)throw Error('Paddle checkout is not configured');
  const previous=await domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner']);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`subscription:${session.org_id}`]);
    if(await sandboxDashboardAccess(client,session.org_id))throw Error('Sandbox payment is already confirmed. Open the dashboard instead.');
    const existing=(await client.query('SELECT * FROM subscription_checkouts WHERE request_id=$1',[input.requestId])).rows[0];
    if(existing){if(existing.org_id!==session.org_id||existing.plan!==input.plan)throw Error('Subscription request conflict');return existing;}
    const open=(await client.query("SELECT request_id FROM subscription_checkouts WHERE org_id=$1 AND state IN ('creating','ready','needs_review')",[session.org_id])).rows[0];
    if(open)throw Error('A subscription checkout already exists. Contact support to recover it.');
    await client.query("INSERT INTO subscription_checkouts(request_id,org_id,plan,environment,state) VALUES($1,$2,$3,'sandbox','creating')",[input.requestId,session.org_id,input.plan]);
    return null;
  });
  const result=transactionId=>({transactionId,mode:'sandbox',clientToken:config.clientToken});
  if(previous){if(previous.state==='ready')return result(previous.transaction_id);throw Error('Checkout outcome needs review. Contact support before starting again.');}
  try{
    const price=await paddleRequest(config,`/prices/${config.prices[input.plan]}`,{fetchImpl});checkPaddlePrice(price,input.plan);
    const transaction=await paddleRequest(config,'/transactions',{fetchImpl,body:{items:[{price_id:config.prices[input.plan],quantity:1}],
      collection_mode:'automatic',custom_data:{understood_checkout:input.requestId,understood_org:session.org_id,understood_plan:input.plan}}});
    if(!/^txn_[a-z0-9]+$/.test(transaction.id||''))throw Error('Invalid Paddle transaction');
    await domainTransaction(pool,schema,client=>client.query("UPDATE subscription_checkouts SET transaction_id=$2,state='ready' WHERE request_id=$1 AND state='creating'",[input.requestId,transaction.id]));
    return result(transaction.id);
  }catch(error){
    await domainTransaction(pool,schema,client=>client.query("UPDATE subscription_checkouts SET state='needs_review' WHERE request_id=$1 AND state='creating'",[input.requestId]));
    throw error;
  }
}

export async function recordSubscriptionEvent(pool,event,{schema='public',env=process.env}={}){
  const config=paddleConfig(env);if(!config.available)throw Error('Paddle checkout is not configured');
  return domainTransaction(pool,schema,async client=>{
    const inserted=await client.query(`INSERT INTO subscription_payment_events(event_id,event_type,occurred_at) VALUES($1,$2,$3)
      ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,[event.event_id,event.event_type,event.occurred_at]);
    if(!inserted.rows.length)return {duplicate:true};
    if(event.event_type!=='transaction.completed')return {ignored:true};
    const data=event.data,custom=data?.custom_data,plan=subscriptionPlan(custom?.understood_plan);
    if(!plan||!custom?.understood_checkout)return {ignored:true};
    const checkout=(await client.query('SELECT * FROM subscription_checkouts WHERE request_id=$1 FOR UPDATE',[custom.understood_checkout])).rows[0];
    if(!checkout||checkout.org_id!==custom.understood_org||checkout.plan!==plan.id||checkout.environment!=='sandbox')throw Error('Paddle checkout scope mismatch');
    if(checkout.transaction_id&&checkout.transaction_id!==data.id)throw Error('Paddle transaction mismatch');
    if(data.status!=='completed'||data.collection_mode!=='automatic'||data.discount_id!=null||data.currency_code!=='USD'||data.items?.length!==1
      ||data.items[0].quantity!==1||data.items[0].price?.id!==config.prices[plan.id]||!/^sub_[a-z0-9]+$/.test(data.subscription_id||''))throw Error('Paddle payment does not match checkout');
    checkPaddlePrice(data.items[0].price,plan.id);
    const start=data.billing_period?.starts_at,end=data.billing_period?.ends_at;
    if(!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start))throw Error('Invalid subscription period');
    await client.query(`INSERT INTO subscription_allowance_grants(transaction_id,request_id,org_id,plan,characters,transcription_minutes,
      provider_budget_json,period_start,period_end,event_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) ON CONFLICT(transaction_id) DO NOTHING`,
    [data.id,checkout.request_id,checkout.org_id,plan.id,plan.characters,plan.transcriptionMinutes,JSON.stringify(providerBudget(plan.id)),start,end,event.event_id]);
    await client.query("UPDATE subscription_checkouts SET state='completed',transaction_id=$2 WHERE request_id=$1",[checkout.request_id,data.id]);
    return {recorded:true,fundingState:'sandbox_only'};
  });
}
