import {send,readJson} from './http.mjs';
import {paddleConfig,verifyPaddleWebhook} from './paddle.mjs';
import {recordSubscriptionEvent,subscriptionStatus,createSubscriptionCheckout} from './postgres/subscriptions.mjs';

export async function handleSubscriptionWebhook(pool,req,res,url,options){
  if(url.pathname!=='/api/subscriptions/paddle/webhook')return false;
  if(req.method!=='POST'||url.search){send(res,405,{error:'Method not allowed'});return true;}
  const config=paddleConfig(options.env);
  if(!config.available){send(res,503,{error:'Paddle checkout is not configured'});return true;}
  let event;
  try{
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>262144)throw Error('Request too large');chunks.push(Buffer.from(chunk));}
    event=verifyPaddleWebhook(Buffer.concat(chunks),req.headers['paddle-signature'],config.webhookSecret);
  }catch{send(res,400,{error:'Invalid Paddle webhook'});return true;}
  try{await recordSubscriptionEvent(pool,event,options);send(res,200,{ok:true});}
  catch{send(res,503,{error:'Paddle event could not be recorded. Retry delivery.'});}
  return true;
}

export async function handleSubscriptionRoute(pool,req,res,url,session,options){
  if(!['/api/subscriptions','/api/subscriptions/checkout'].includes(url.pathname))return false;
  if(session?.principal_type!=='staff'||session.role!=='owner'){send(res,403,{error:'Only the workspace owner can manage subscriptions'});return true;}
  if(url.search){send(res,400,{error:'Invalid subscription request'});return true;}
  try{
    if(url.pathname==='/api/subscriptions'&&req.method==='GET')send(res,200,await subscriptionStatus(pool,session,options));
    else if(url.pathname==='/api/subscriptions/checkout'&&req.method==='POST')send(res,200,await createSubscriptionCheckout(pool,session,await readJson(req,2048),options));
    else send(res,405,{error:'Method not allowed'});
  }catch(error){
    const message=error.message;
    const allowed=['This plan is coming soon. Choose Starter for now.','Invalid subscription request','Subscription request conflict','A subscription checkout already exists. Contact support to recover it.',
      'Checkout outcome needs review. Contact support before starting again.','Paddle checkout is not configured','Paddle price does not match the subscription plan','Paddle request could not be confirmed'];
    send(res,message==='Forbidden'?403:message==='Invalid subscription request'?400:409,{error:allowed.includes(message)?message:'Subscription service unavailable. Try again later.'});
  }
  return true;
}
