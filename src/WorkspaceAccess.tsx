import {useContext,useEffect,useRef,useState} from 'react';
import {LogOut,Mail,RefreshCw} from 'lucide-react';
import {pendingPaidPlan,PLAN_NAMES} from '../server/pilot-policy.mjs';
import {SessionRecoveryScreen} from './SessionRecoveryScreen';
import {StaffLanguageContext,useStaffText} from './staff-language';

export function WorkspaceAccess({plan,state,onRecheck,onSignOut,onContact}:{plan:string;state?:'pending'|'declined'|null;onRecheck:()=>Promise<boolean>;onSignOut:()=>Promise<boolean>;onContact:()=>void}) {
  const language=useContext(StaffLanguageContext),t=useStaffText();
  const paidPlan=pendingPaidPlan(plan);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const checking=useRef(false),declined=state==='declined';
  const title=declined?(paidPlan?t('Your plan activation request was declined.'):t('Your pilot request was declined.')):paidPlan?t('Your plan is awaiting activation.'):t('Your pilot is awaiting approval.');
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
    {declined?<p>{t('Your workspace has not been activated. Contact us if you would like us to review your request.')}</p>:paidPlan?<><p><strong>{PLAN_NAMES[paidPlan]}</strong></p><p>{t('Your workspace opens when Understood activates your plan. Contact us to arrange billing.')}</p></>:<p>{t('Your email is verified. Your 14-day pilot starts once Understood approves it.')}</p>}
    {message&&<p role="status">{t(message)}</p>}
    <div className="actions"><button className="button primary" onClick={()=>void recheck()} disabled={busy}><RefreshCw size={17}/>{t('Check access')}</button><button className="button outline" onClick={onContact}><Mail size={17}/>{t('Contact us')}</button><button className="button subtle" onClick={()=>void onSignOut()}><LogOut size={17}/>{t('Sign out')}</button></div>
  </SessionRecoveryScreen>;
}
