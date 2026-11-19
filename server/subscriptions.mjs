import {NOW,transaction} from './db.mjs';
import {paddleConfig,paddleRequest,checkPaddlePrice} from './paddle.mjs';
import {SUBSCRIPTION_PLANS,subscriptionPlan,isAvailableSubscriptionPlan,providerBudget} from './subscription-plans.mjs';
export {ensureSubscriptionSchema} from './subscription-schema.mjs';

function owner(db,session){
  if(session?.principal_type!=='staff'||session.role!=='owner'||!db.prepare("SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND role='owner' AND active=1").get(session.principal_id,session.org_id,session.site_id))throw Error('Forbidden');
}
export function sqliteSandboxDashboard(db,orgId){
  return !!db.prepare(`SELECT 1 FROM subscription_allowance_grants g JOIN subscription_checkouts c ON c.request_id=g.request_id AND c.org_id=g.org_id
    JOIN organization_entitlements e ON e.org_id=g.org_id WHERE g.org_id=? AND g.funding_state='sandbox_only' AND c.environment='sandbox'
    AND c.state='completed' AND c.transaction_id=g.transaction_id AND e.state='read_only' AND e.plan=g.plan||'_pending'
    AND (e.ends_at IS NULL OR julianday(e.ends_at)>julianday('now')) AND julianday(g.period_start)<=julianday('now') AND julianday(g.period_end)>julianday('now')
    AND NOT EXISTS(SELECT 1 FROM organization_activation_requests a WHERE a.org_id=e.org_id AND a.entitlement_revision=e.revision AND a.state='declined')`).get(orgId);
}

export function recordSqliteSubscriptionEvent(db,event,{env=process.env}={}){
  const config=paddleConfig(env,{localReconciliation:true});if(!config.available)throw Error('Paddle checkout is not configured');
  return transaction(db,()=>{
    if(!db.prepare('INSERT OR IGNORE INTO subscription_payment_events VALUES(?,?,?,?)').run(event.event_id,event.event_type,event.occurred_at,NOW()).changes)return {duplicate:true};
    if(event.event_type!=='transaction.completed')return {ignored:true};
    const data=event.data,custom=data?.custom_data,plan=subscriptionPlan(custom?.understood_plan);
    if(!plan||!custom?.understood_checkout)return {ignored:true};
    const checkout=db.prepare('SELECT * FROM subscription_checkouts WHERE request_id=?').get(custom.understood_checkout);
    if(!checkout||checkout.org_id!==custom.understood_org||checkout.plan!==plan.id||checkout.environment!=='sandbox')throw Error('Paddle checkout scope mismatch');
    if(checkout.transaction_id&&checkout.transaction_id!==data.id)throw Error('Paddle transaction mismatch');
    if(data.status!=='completed'||data.collection_mode!=='automatic'||data.discount_id!=null||data.currency_code!=='USD'||data.items?.length!==1
      ||data.items[0].quantity!==1||data.items[0].price?.id!==config.prices[plan.id]||!/^sub_[a-z0-9]+$/.test(data.subscription_id||''))throw Error('Paddle payment does not match checkout');
    checkPaddlePrice(data.items[0].price,plan.id);
    const start=data.billing_period?.starts_at,end=data.billing_period?.ends_at;
    if(!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start))throw Error('Invalid subscription period');
    db.prepare(`INSERT OR IGNORE INTO subscription_allowance_grants VALUES(?,?,?,?,?,?,?,'sandbox_only',?,?,?,?)`).run(data.id,checkout.request_id,checkout.org_id,plan.id,plan.characters,plan.transcriptionMinutes,JSON.stringify(providerBudget(plan.id)),new Date(start).toISOString(),new Date(end).toISOString(),event.event_id,NOW());
    db.prepare("UPDATE subscription_checkouts SET state='completed',transaction_id=? WHERE request_id=?").run(data.id,checkout.request_id);
    return {recorded:true,fundingState:'sandbox_only'};
  });
}

export function sqliteSubscriptionRepository(db,{env=process.env,fetchImpl=fetch}={}){
  return {
    event:event=>recordSqliteSubscriptionEvent(db,event,{env}),
    async status(session){
      owner(db,session);const config=paddleConfig(env,{localReconciliation:true});let confirmationPending=false;
      // Localhost cannot receive Paddle webhooks directly. Reconcile only a
      // server-stored transaction through authenticated Paddle API reads.
      const open=db.prepare("SELECT transaction_id FROM subscription_checkouts WHERE org_id=? AND state IN ('ready','needs_review') AND transaction_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").get(session.org_id);
      if(config.available&&open){
        try{const data=await paddleRequest(config,`/transactions/${open.transaction_id}`,{fetchImpl});owner(db,session);
          if(data.id!==open.transaction_id)throw Error('Paddle transaction mismatch');
          if(data.status==='completed')recordSqliteSubscriptionEvent(db,{event_id:`api_reconciliation:${data.id}`,event_type:'transaction.completed',occurred_at:NOW(),data},{env});
        }catch{confirmationPending=true;}
      }
      const grant=db.prepare('SELECT transaction_id,plan,characters,transcription_minutes,funding_state,period_start,period_end FROM subscription_allowance_grants WHERE org_id=? ORDER BY created_at DESC LIMIT 1').get(session.org_id)??null;
      const dashboardAvailable=sqliteSandboxDashboard(db,session.org_id);
      return {mode:config.mode,checkoutAvailable:config.available&&!dashboardAvailable,dashboardAvailable,confirmationPending,plans:SUBSCRIPTION_PLANS,grant,providerFunding:'not_funded',liveCheckoutAvailable:false};
    },
    async checkout(session,input){
      owner(db,session);
      if(!input||Object.keys(input).some(key=>!['plan','requestId'].includes(key))||!subscriptionPlan(input.plan)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId||''))throw Error('Invalid subscription request');
      if(!isAvailableSubscriptionPlan(input.plan))throw Error('This plan is coming soon. Choose Starter for now.');
      const config=paddleConfig(env,{localReconciliation:true});if(!config.available)throw Error('Paddle checkout is not configured');
      const previous=transaction(db,()=>{
        if(sqliteSandboxDashboard(db,session.org_id))throw Error('Sandbox payment is already confirmed. Open the dashboard instead.');
        const old=db.prepare('SELECT * FROM subscription_checkouts WHERE request_id=?').get(input.requestId);
        if(old){if(old.org_id!==session.org_id||old.plan!==input.plan)throw Error('Subscription request conflict');return old;}
        if(db.prepare("SELECT 1 FROM subscription_checkouts WHERE org_id=? AND state IN ('creating','ready','needs_review')").get(session.org_id))throw Error('A subscription checkout already exists. Contact support to recover it.');
        db.prepare("INSERT INTO subscription_checkouts(request_id,org_id,plan,environment,state,created_at) VALUES(?,?,?,'sandbox','creating',?)").run(input.requestId,session.org_id,input.plan,NOW());return null;
      });
      const result=id=>({transactionId:id,mode:'sandbox',clientToken:config.clientToken});
      if(previous){if(previous.state==='ready')return result(previous.transaction_id);throw Error('Checkout outcome needs review. Contact support before starting again.');}
      try{
        checkPaddlePrice(await paddleRequest(config,`/prices/${config.prices[input.plan]}`,{fetchImpl}),input.plan);
        const data=await paddleRequest(config,'/transactions',{fetchImpl,body:{items:[{price_id:config.prices[input.plan],quantity:1}],collection_mode:'automatic',custom_data:{understood_checkout:input.requestId,understood_org:session.org_id,understood_plan:input.plan}}});
        if(!/^txn_[a-z0-9]+$/.test(data.id||''))throw Error('Invalid Paddle transaction');
        db.prepare("UPDATE subscription_checkouts SET state='ready',transaction_id=? WHERE request_id=? AND state='creating'").run(data.id,input.requestId);return result(data.id);
      }catch(error){db.prepare("UPDATE subscription_checkouts SET state='needs_review' WHERE request_id=? AND state='creating'").run(input.requestId);throw error;}
    },
  };
}
