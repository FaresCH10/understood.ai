import {useContext,useEffect,useRef,useState} from 'react';
import {StaffLanguageContext} from './staff-language';
import {SUBSCRIPTION_PLANS,formatSubscriptionPrice} from '../server/subscription-plans.mjs';
import './subscription-panel.css';

type Status={mode:string;checkoutAvailable:boolean;dashboardAvailable:boolean;providerFunding:string;grant:null|{transaction_id:string;characters:number;transcription_minutes:number;funding_state:string}};
type PaddleEvent={name:string;data?:{transaction_id?:string}};
type PaddleSDK={Environment:{set:(mode:'sandbox')=>void};Initialize:(options:{token:string;eventCallback:(event:PaddleEvent)=>void})=>void;Checkout:{open:(options:{transactionId:string})=>void;close:()=>void}};
let sdkLoading:Promise<PaddleSDK>|undefined,initializedToken:string|undefined,checkoutListener:((event:PaddleEvent)=>void)|undefined;
function loadPaddle(){
  if(!sdkLoading)sdkLoading=new Promise<PaddleSDK>((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://cdn.paddle.com/paddle/v2/paddle.js';script.async=true;
    script.onload=()=>{const sdk=(window as Window&{Paddle?:PaddleSDK}).Paddle;if(sdk)resolve(sdk);else reject(Error('Checkout could not load.'));};
    script.onerror=()=>{sdkLoading=undefined;script.remove();reject(Error('Checkout could not load. Check your connection and try again.'));};
    document.head.append(script);
  });
  return sdkLoading;
}

export function SubscriptionPanel({clientContext,initialPlan='starter',onConfirmed}:{clientContext:string;initialPlan?:string;onConfirmed?:()=>unknown}){
  const language=useContext(StaffLanguageContext),ar=language==='ar';
  const [status,setStatus]=useState<Status|null>(null),[plan,setPlan]=useState(SUBSCRIPTION_PLANS.some(p=>p.id===initialPlan&&p.available)?initialPlan:'starter');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [check,setCheck]=useState(0),[confirming,setConfirming]=useState(false),[waiting,setWaiting]=useState(false);
  const confirmedCallback=useRef(onConfirmed);confirmedCallback.current=onConfirmed;
  const requestId=useRef<{plan:string;id:string}|null>(null),active=useRef(true),sending=useRef(false);
  const binding=useRef(clientContext);binding.current=clientContext;
  const text=(en:string,arText:string)=>ar?arText:en;
  useEffect(()=>{
    active.current=true;requestId.current=null;
    return()=>{active.current=false;};
  },[clientContext]);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,attempts=0;
    const refresh=async()=>{
      try{
        const response=await fetch('/api/subscriptions',{credentials:'include',cache:'no-store',signal:controller.signal,headers:{'x-client-session-context':clientContext}});
        const data:Status&{error?:string}=await response.json();if(!response.ok)throw Error(data.error||'Unable to load subscription details.');
        if(controller.signal.aborted)return;setStatus(data);setError('');
        if(data.dashboardAvailable){setConfirming(false);setWaiting(false);await confirmedCallback.current?.();return;}
        if(confirming){if(++attempts<15)timer=setTimeout(()=>void refresh(),2000);else{setConfirming(false);setWaiting(true);}}
      }catch(error){if(!controller.signal.aborted){setError((error as Error).message);setConfirming(false);}}
    };
    void refresh();
    return()=>{controller.abort();clearTimeout(timer);};
  },[clientContext,check]);
  async function checkout(){
    if(sending.current||!status?.checkoutAvailable)return;
    sending.current=true;setBusy(true);setError('');
    const checkoutContext=clientContext;
    if(requestId.current?.plan!==plan)requestId.current={plan,id:crypto.randomUUID()};
    try{
      const response=await fetch('/api/subscriptions/checkout',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-client-session-context':clientContext},body:JSON.stringify({plan,requestId:requestId.current.id})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to prepare checkout.');
      if(data.mode!=='sandbox'||!/^test_[A-Za-z0-9_]+$/.test(data.clientToken)||!/^txn_[a-z0-9]+$/.test(data.transactionId))throw Error('Invalid checkout configuration.');
      if(!active.current||binding.current!==checkoutContext)return;
      const sdk=await loadPaddle();if(!active.current||binding.current!==checkoutContext)return;
      checkoutListener=event=>{
        if(event.name!=='checkout.completed'||event.data?.transaction_id!==data.transactionId||!active.current||binding.current!==checkoutContext)return;
        sdk.Checkout.close();setConfirming(true);setWaiting(false);setCheck(value=>value+1);
      };
      if(!initializedToken){sdk.Environment.set('sandbox');sdk.Initialize({token:data.clientToken,eventCallback:event=>checkoutListener?.(event)});initializedToken=data.clientToken;}
      else if(initializedToken!==data.clientToken)throw Error('Checkout configuration changed. Reload this page before continuing.');
      sdk.Checkout.open({transactionId:data.transactionId});
    }catch(error){if(active.current&&binding.current===checkoutContext)setError((error as Error).message);}
    finally{sending.current=false;if(active.current)setBusy(false);}
  }
  return <section className="panel subscription-panel" aria-labelledby="subscription-heading">
    <h2 id="subscription-heading">{text('Subscription','الاشتراك')}</h2>
    <p>{text('10% off every monthly payment. Prices are in USD before applicable taxes.','خصم 10% على كل دفعة شهرية. الأسعار بالدولار قبل الضرائب.')}</p>
    <label className="field">{text('Plan','الخطة')}<select value={plan} disabled={busy} onChange={event=>setPlan(event.target.value)}>{SUBSCRIPTION_PLANS.map(item=><option value={item.id} key={item.id} disabled={!item.available}>{item.name} · {item.available?`${formatSubscriptionPrice(item.monthlyCents)} ${text('/month','/شهرياً')}`:text('Coming soon','قريباً')}</option>)}</select></label>
    {status?.dashboardAvailable?<><p role="status">{text('Sandbox payment confirmed. You can open the read-only dashboard.','تم تأكيد الدفع التجريبي. يمكنك فتح لوحة التحكم للقراءة فقط.')}</p><button className="button primary" onClick={()=>{if(onConfirmed)onConfirmed();else location.hash='overview';}}>{text('Open sandbox dashboard','فتح لوحة التحكم التجريبية')}</button></>:confirming||waiting?<><p role="status">{confirming?text('Confirming your test payment with Understood…','جارٍ تأكيد الدفع التجريبي مع Understood…'):text('Payment confirmation is taking longer than expected. Check again; you do not need to pay again.','تأكيد الدفع يستغرق وقتاً أطول. أعد الفحص؛ لا حاجة للدفع مجدداً.')}</p><button className="button outline" disabled={confirming} onClick={()=>{setConfirming(true);setWaiting(false);setCheck(value=>value+1);}}>{text('Check payment','التحقق من الدفع')}</button></>:status?.checkoutAvailable?<><p className="notice notice-blue">{text('Sandbox checkout only. A confirmed test payment opens a read-only dashboard. Paid API processing remains disabled.','دفع تجريبي فقط. يفتح الدفع المؤكد لوحة التحكم للقراءة فقط. تبقى الخدمات المدفوعة معطّلة.')}</p><button className="button primary" disabled={busy} onClick={()=>void checkout()}>{busy?text('Preparing checkout…','جارٍ تجهيز الدفع…'):text('Open test checkout','فتح الدفع التجريبي')}</button></>:
      <p role="status" className="muted">{status?text('Online subscriptions are not open yet. No payment will be taken. Contact us for availability.','الاشتراكات عبر الإنترنت غير مفتوحة بعد. لن يتم تحصيل أي مبلغ. تواصل معنا لمعرفة التوفر.'):error?text('Subscription details are unavailable. Refresh the page to try again.','تفاصيل الاشتراك غير متاحة. حدّث الصفحة للمحاولة مجدداً.'):text('Loading subscription details…','جارٍ تحميل تفاصيل الاشتراك…')}</p>}
    {status?.grant&&<p role="status">{text('Test allowance recorded','تم تسجيل الرصيد التجريبي')}: {status.grant.characters.toLocaleString()} {text('characters. This is not spendable provider credit.','حرف. هذا ليس رصيداً قابلاً للإنفاق لدى مزوّدي الخدمات.')}</p>}
    {error&&<p role="alert" className="record-error">{error}</p>}
  </section>;
}
