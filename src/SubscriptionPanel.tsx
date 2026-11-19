import {useContext,useEffect,useRef,useState} from 'react';
import {StaffLanguageContext} from './staff-language';
import {SUBSCRIPTION_PLANS,formatSubscriptionPrice} from '../server/subscription-plans.mjs';
import './subscription-panel.css';

type Status={mode:string;checkoutAvailable:boolean;providerFunding:string;grant:null|{characters:number;transcription_minutes:number;funding_state:string}};
type PaddleSDK={Environment:{set:(mode:'sandbox')=>void};Initialize:(options:{token:string})=>void;Checkout:{open:(options:{transactionId:string})=>void}};
let sdkLoading:Promise<PaddleSDK>|undefined,initializedToken:string|undefined;
function loadPaddle(){
  if(!sdkLoading)sdkLoading=new Promise<PaddleSDK>((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://cdn.paddle.com/paddle/v2/paddle.js';script.async=true;
    script.onload=()=>{const sdk=(window as Window&{Paddle?:PaddleSDK}).Paddle;if(sdk)resolve(sdk);else reject(Error('Checkout could not load.'));};
    script.onerror=()=>{sdkLoading=undefined;script.remove();reject(Error('Checkout could not load. Check your connection and try again.'));};
    document.head.append(script);
  });
  return sdkLoading;
}

export function SubscriptionPanel({clientContext,initialPlan='starter'}:{clientContext:string;initialPlan?:string}){
  const language=useContext(StaffLanguageContext),ar=language==='ar';
  const [status,setStatus]=useState<Status|null>(null),[plan,setPlan]=useState(SUBSCRIPTION_PLANS.some(p=>p.id===initialPlan&&p.available)?initialPlan:'starter');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const requestId=useRef<{plan:string;id:string}|null>(null),active=useRef(true),sending=useRef(false);
  const binding=useRef(clientContext);binding.current=clientContext;
  const text=(en:string,arText:string)=>ar?arText:en;
  useEffect(()=>{
    active.current=true;const controller=new AbortController();setStatus(null);setError('');requestId.current=null;
    fetch('/api/subscriptions',{credentials:'include',cache:'no-store',signal:controller.signal,headers:{'x-client-session-context':clientContext}})
      .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to load subscription details.');if(active.current)setStatus(data);})
      .catch(error=>{if(!controller.signal.aborted&&active.current)setError(error.message);});
    return()=>{active.current=false;controller.abort();};
  },[clientContext]);
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
      if(initializedToken!==data.clientToken){sdk.Environment.set('sandbox');sdk.Initialize({token:data.clientToken});initializedToken=data.clientToken;}
      sdk.Checkout.open({transactionId:data.transactionId});
    }catch(error){if(active.current&&binding.current===checkoutContext)setError((error as Error).message);}
    finally{sending.current=false;if(active.current)setBusy(false);}
  }
  return <section className="panel subscription-panel" aria-labelledby="subscription-heading">
    <h2 id="subscription-heading">{text('Subscription','الاشتراك')}</h2>
    <p>{text('10% off every monthly payment. Prices are in USD before applicable taxes.','خصم 10% على كل دفعة شهرية. الأسعار بالدولار قبل الضرائب.')}</p>
    <label className="field">{text('Plan','الخطة')}<select value={plan} disabled={busy} onChange={event=>setPlan(event.target.value)}>{SUBSCRIPTION_PLANS.map(item=><option value={item.id} key={item.id} disabled={!item.available}>{item.name} · {item.available?`${formatSubscriptionPrice(item.monthlyCents)} ${text('/month','/شهرياً')}`:text('Coming soon','قريباً')}</option>)}</select></label>
    {status?.checkoutAvailable?<><p className="notice notice-blue">{text('Sandbox checkout only. Test payments do not activate workspace access or purchase API credits.','دفع تجريبي فقط. لا تفعّل المدفوعات التجريبية مساحة العمل ولا تشتري رصيد الخدمات.')}</p><button className="button primary" disabled={busy} onClick={()=>void checkout()}>{busy?text('Preparing checkout…','جارٍ تجهيز الدفع…'):text('Open test checkout','فتح الدفع التجريبي')}</button></>:
      <p role="status" className="muted">{status?text('Online subscriptions are not open yet. No payment will be taken. Contact us for availability.','الاشتراكات عبر الإنترنت غير مفتوحة بعد. لن يتم تحصيل أي مبلغ. تواصل معنا لمعرفة التوفر.'):error?text('Subscription details are unavailable. Refresh the page to try again.','تفاصيل الاشتراك غير متاحة. حدّث الصفحة للمحاولة مجدداً.'):text('Loading subscription details…','جارٍ تحميل تفاصيل الاشتراك…')}</p>}
    {status?.grant&&<p role="status">{text('Test allowance recorded','تم تسجيل الرصيد التجريبي')}: {status.grant.characters.toLocaleString()} {text('characters. This is not spendable provider credit.','حرف. هذا ليس رصيداً قابلاً للإنفاق لدى مزوّدي الخدمات.')}</p>}
    {error&&<p role="alert" className="record-error">{error}</p>}
  </section>;
}
