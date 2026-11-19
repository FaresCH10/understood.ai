import {SubscriptionPanel} from './SubscriptionPanel';
import {useContext,useEffect,useRef,useState} from 'react';
import {LogOut,Mail,RefreshCw} from 'lucide-react';
import {pendingPaidPlan,PLAN_NAMES} from '../server/pilot-policy.mjs';
import {SessionRecoveryScreen} from './SessionRecoveryScreen';
import {StaffLanguageContext,useStaffText} from './staff-language';

export function WorkspaceAccess({plan,state,onRecheck,onSignOut,onContact,clientContext,owner}:{clientContext:string;owner:boolean;plan:string;state?:'pending'|'declined'|null;onRecheck:()=>Promise<boolean>;onSignOut:()=>Promise<boolean>;onContact:()=>void}) {
  const language=useContext(StaffLanguageContext),t=useStaffText();
  const paidPlan=pendingPaidPlan(plan);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const checking=useRef(false),declined=state==='declined';
  const title=language==='ar'?'أكمل الاشتراك':'Complete your subscription';
  useEffect(()=>{
    let live=true;
    const refresh=async()=>{
      if(!live||document.visibilityState!=='visible'||checking.current)return;
      checking.current=true;
      try{await onRecheck();}catch{}finally{checking.current=false;}
    };
    const timer=window.setInterval(()=>void refresh(),15000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{live=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[onRecheck]);
  useEffect(()=>{setMessage('');},[state]);
  async function recheck(){
    if(checking.current)return;
    checking.current=true;
    setBusy(true);setMessage('');
    try{setMessage(await onRecheck()?'Access status checked.':'Please check your connection and try again.');}
    catch{setMessage('Please check your connection and try again.');}
    finally{checking.current=false;setBusy(false);}
  }
  return <SessionRecoveryScreen language={language} title={title} kind={declined?'declined':'pending'}>
    <p>{language==='ar'?'اختر خطة شهرية لمساحة عملك.':'Choose a monthly plan for your workspace.'}</p>
    {owner?<SubscriptionPanel clientContext={clientContext} initialPlan={paidPlan??'starter'}/>:<p>{language==='ar'?'اطلب من مالك مساحة العمل إكمال الاشتراك.':'Ask your workspace owner to complete the subscription.'}</p>}
    {message&&<p role="status">{t(message)}</p>}
    <div className="actions"><button className="button primary" onClick={()=>void recheck()} disabled={busy}><RefreshCw size={17}/>{t('Check access')}</button><button className="button outline" onClick={onContact}><Mail size={17}/>{t('Contact us')}</button><button className="button subtle" onClick={()=>void onSignOut()}><LogOut size={17}/>{t('Sign out')}</button></div>
  </SessionRecoveryScreen>;
}
