import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {useStaffText} from './staff-language';
import './clarification-count.css';

const CountContext=createContext<number|null>(null);
export function ClarificationCountProvider({authority,refresh,children}:{authority:StaffRequestAuthority;refresh:number;children:ReactNode}){
  const api=useStaffRequest(authority),[count,setCount]=useState<number|null>(null),[tick,setTick]=useState(0);
  useEffect(()=>{
    if(!['owner','supervisor','auditor'].includes(authority.session.staffRole||''))return;
    let live=true;const controller=new AbortController();
    api.request<{unreadInstructions:number;clientContext:string}>('/api/clarification-flow?summary=1',undefined,controller.signal).then(value=>{
      if(value.clientContext!==authority.session.clientContext||!Number.isSafeInteger(value.unreadInstructions)||value.unreadInstructions<0)throw Error('Unverified clarification count');
      if(live&&api.current())setCount(value.unreadInstructions);
    }).catch(()=>{if(live)setCount(null);});
    const timer=window.setTimeout(()=>{if(document.visibilityState==='visible')setTick(n=>n+1);},15000);
    return()=>{live=false;controller.abort();window.clearTimeout(timer);};
  },[api,tick,refresh]);
  useEffect(()=>{
    const update=()=>{if(document.visibilityState==='visible')setTick(n=>n+1);};
    window.addEventListener('understood:clarification-change',update);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
    return()=>{window.removeEventListener('understood:clarification-change',update);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
  },[]);
  return <CountContext.Provider value={count}>{children}</CountContext.Provider>;
}
export function ClarificationCountBadge(){
  const count=useContext(CountContext),t=useStaffText();
  if(count===null||count===0)return null;
  return <span className="clarification-nav-count"><span aria-hidden="true">{t.number(count)}</span><span className="sr-only">{t(count===1?'{p0} instruction needs clarification':'{p0} instructions need clarification',{p0:t.number(count)})}</span></span>;
}
