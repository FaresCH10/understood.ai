import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {Clock3,Mail,RefreshCw} from 'lucide-react';
import {FirstRunOnboarding} from './FirstRunOnboarding';
import {useStaffRequest} from './useStaffRequest';
import {checkedUsageModel} from './usage-state';
import {useStaffText} from './staff-language';

export function PilotOnboarding(props:ComponentProps<typeof FirstRunOnboarding>){
  const t=useStaffText(),api=useStaffRequest(props.authority),admitted=useRef(false);
  const [state,setState]=useState<'loading'|'pending'|'expired'|'ready'|'error'>('loading'),[tick,setTick]=useState(0);
  useEffect(()=>{
    if(admitted.current)return;
    const controller=new AbortController();setState('loading');
    api.request<unknown>('/api/usage',undefined,controller.signal).then(value=>{
      if(controller.signal.aborted||!api.current())return;
      const {entitlement}=checkedUsageModel(value,props.authority.session.mode,props.authority.session.staffRole);
      if(entitlement.plan==='pilot_pending')setState('pending');
      else if(entitlement.plan==='pilot'&&!entitlement.writeAllowed)setState('expired');
      else{admitted.current=true;setState('ready');}
    }).catch(()=>{if(!controller.signal.aborted&&api.current())setState('error');});
    return()=>controller.abort();
  },[api,tick,props.refresh]);
  if(admitted.current&&state==='ready')return <FirstRunOnboarding {...props}/>;
  if(state==='loading')return <p data-page-loading role="status">{t('Checking pilot access...')}</p>;
  return <section className="panel" aria-labelledby="pilot-access-title"><Clock3 size={28}/><h1 id="pilot-access-title">{t(state==='error'?'Pilot access could not be checked.':state==='expired'?'Your pilot has ended.':'Your pilot is awaiting approval.')}</h1><p>{t(state==='error'?'Please check your connection and try again.':state==='expired'?'Contact us to discuss a paid rollout or an extension. Your existing records are retained.':'Your email is verified. Pilot access starts only after approval and activation; your 30 days have not started.')}</p><p>{t('One site · up to 25 active workers · 30 days after approval')}</p><div className="actions"><button className="button primary" onClick={()=>setTick(n=>n+1)}><RefreshCw size={17}/>{t('Recheck pilot approval')}</button><button className="button outline" onClick={()=>props.onNavigate('contact')}><Mail size={17}/>{t('Contact us')}</button></div></section>;
}
