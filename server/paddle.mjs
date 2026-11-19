import {createHmac,timingSafeEqual} from 'node:crypto';
import {subscriptionPlan} from './subscription-plans.mjs';

export function paddleConfig(env=process.env){
  // Preparation is sandbox-only. Test payments must never buy real API usage.
  if(env.UNDERSTOOD_PADDLE_MODE!=='sandbox')return {available:false,mode:'disabled'};
  const prices=Object.fromEntries(['starter','pro','business','enterprise'].map(id=>[id,env[`PADDLE_PRICE_${id.toUpperCase()}`]]));
  const available=!!env.PADDLE_API_KEY&&!!env.PADDLE_WEBHOOK_SECRET&&/^test_[A-Za-z0-9_]+$/.test(env.PADDLE_CLIENT_TOKEN||'')
    &&Object.values(prices).every(id=>/^pri_[a-z0-9]+$/.test(id||''));
  return {available,mode:'sandbox',prices,apiKey:env.PADDLE_API_KEY,webhookSecret:env.PADDLE_WEBHOOK_SECRET,clientToken:env.PADDLE_CLIENT_TOKEN};
}

export function verifyPaddleWebhook(raw,header,secret,{now=Date.now()}={}){
  if(!Buffer.isBuffer(raw)||raw.length>262144||typeof header!=='string'||header.length>2048||!secret)throw Error('Invalid Paddle signature');
  const fields=header.split(';').map(part=>part.trim().split('='));
  const timestamps=fields.filter(([key])=>key==='ts');
  const ts=timestamps[0]?.[1];
  if(timestamps.length!==1||!/^\d{10}$/.test(ts||'')||Math.abs(now/1000-Number(ts))>300)throw Error('Invalid Paddle signature');
  const expected=createHmac('sha256',secret).update(`${ts}:`).update(raw).digest();
  if(!fields.some(([key,value])=>key==='h1'&&/^[a-f0-9]{64}$/.test(value||'')&&timingSafeEqual(expected,Buffer.from(value,'hex'))))throw Error('Invalid Paddle signature');
  let event;try{event=JSON.parse(raw.toString('utf8'));}catch{throw Error('Invalid Paddle event');}
  if(!/^evt_[a-z0-9]+$/.test(event?.event_id||'')||typeof event.event_type!=='string'||!Number.isFinite(Date.parse(event.occurred_at)))throw Error('Invalid Paddle event');
  return event;
}

export async function paddleRequest(config,path,{body,fetchImpl=fetch}={}){
  if(!config.available||config.mode!=='sandbox')throw Error('Paddle checkout is not configured');
  const response=await fetchImpl(`https://sandbox-api.paddle.com${path}`,{method:body?'POST':'GET',
    headers:{authorization:`Bearer ${config.apiKey}`,'content-type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!response.ok){await response.body?.cancel();throw Error('Paddle request could not be confirmed');}
  const result=await response.json();if(!result?.data)throw Error('Invalid Paddle response');return result.data;
}

export function checkPaddlePrice(price,planId){
  const plan=subscriptionPlan(planId);
  if(!plan||price?.status!=='active'||price.unit_price?.currency_code!=='USD'||price.unit_price?.amount!==String(plan.monthlyCents)
    ||price.billing_cycle?.interval!=='month'||price.billing_cycle?.frequency!==1||price.trial_period!=null
    ||price.quantity?.minimum>1||price.quantity?.maximum<1||price.unit_price_overrides?.length)throw Error('Paddle price does not match the subscription plan');
  return plan;
}
