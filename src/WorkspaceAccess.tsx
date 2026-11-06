import {useContext,useState} from 'react';
import {LogOut,Mail,RefreshCw} from 'lucide-react';
import {pendingPaidPlan,PLAN_NAMES} from '../server/pilot-policy.mjs';
import {SessionRecoveryScreen} from './SessionRecoveryScreen';
import {StaffLanguageContext,useStaffText} from './staff-language';

export function WorkspaceAccess({plan,onRecheck,onSignOut,onContact}:{plan:string;onRecheck:()=>Promise<boolean>;onSignOut:()=>Promise<boolean>;onContact:()=>void}) {
  const language=useContext(StaffLanguageContext),t=useStaffText();
  const paidPlan=pendingPaidPlan(plan);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const title=paidPlan?t('Your plan is awaiting activation.'):t('Your pilot is awaiting approval.');
  async function recheck(){
    setBusy(true);setMessage('');
    try{setMessage(await onRecheck()?(paidPlan?'Your plan is still awaiting activation.':'Your pilot is still awaiting approval.'):'Please check your connection and try again.');}
    finally{setBusy(false);}
  }
  return <SessionRecoveryScreen language={language} title={title} kind="pending">
    {paidPlan?<><p><strong>{PLAN_NAMES[paidPlan]}</strong></p><p>{t('Your workspace opens when Understood activates your plan. Contact us to arrange billing.')}</p></>:<p>{t('Your email is verified. Your 14-day pilot starts once Understood approves it.')}</p>}
    {message&&<p role="status">{t(message)}</p>}
    <div className="actions"><button className="button primary" onClick={()=>void recheck()} disabled={busy}><RefreshCw size={17}/>{t('Check access')}</button><button className="button outline" onClick={onContact}><Mail size={17}/>{t('Contact us')}</button><button className="button subtle" onClick={()=>void onSignOut()}><LogOut size={17}/>{t('Sign out')}</button></div>
  </SessionRecoveryScreen>;
}
