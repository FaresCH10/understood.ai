import {useEffect,useRef,useState} from 'react';
import {Bell} from 'lucide-react';
import {validPageSession,type PageSession} from './session-state';

export const notificationChanged='understood:notifications-changed';

export function NotificationBell({session,label,locale='en',disabled=false,onOpen,onSessionLost}:{
  session:PageSession;label:string;locale?:string;disabled?:boolean;onOpen:()=>void;onSessionLost:()=>void;
}) {
  const binding=session.clientContext || '';
  const latest=useRef({session,onSessionLost});latest.current={session,onSessionLost};
  const [count,setCount]=useState<{binding:string;unread:number}|null>(null);
  useEffect(()=>{
    if(!binding || !validPageSession(session))return;
    const controller=new AbortController();let pending=false;
    const read=async()=>{
      if(pending || document.visibilityState==='hidden' || !validPageSession(latest.current.session))return;
      pending=true;
      try {
        const response=await fetch('/api/notifications?status=unread&page=1&pageSize=1',{
          credentials:'include',cache:'no-store',redirect:'error',headers:{'x-client-session-context':binding},
          signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),
        });
        if(controller.signal.aborted)return;
        if(response.status===401 || response.status===409){latest.current.onSessionLost();return;}
        if(!response.ok)return;
        const value=await response.json();
        if(!controller.signal.aborted && latest.current.session.clientContext===binding && Number.isSafeInteger(value.unread) && value.unread>=0)
          setCount({binding,unread:value.unread});
      }catch {/* Keep the last confirmed count during a temporary outage. */}
      finally{pending=false;}
    };
    const changed=()=>{void read();};
    void read();const timer=window.setInterval(changed,30000);
    window.addEventListener(notificationChanged,changed);window.addEventListener('focus',changed);
    window.addEventListener('hashchange',changed);document.addEventListener('visibilitychange',changed);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener(notificationChanged,changed);
      window.removeEventListener('focus',changed);window.removeEventListener('hashchange',changed);document.removeEventListener('visibilitychange',changed);};
  },[binding]);
  const unread=count?.binding===binding && validPageSession(session)?count.unread:0;
  const display=new Intl.NumberFormat(locale).format(Math.min(unread,99))+(unread>99?'+':'');
  return <button type="button" className="icon-button bell notification-bell" aria-label={unread?`${label} (${new Intl.NumberFormat(locale).format(unread)})`:label}
    title={label} disabled={disabled} onClick={onOpen}><Bell size={21} aria-hidden="true"/>
    {unread>0 && <span className="notification-count" aria-hidden="true">{display}</span>}
  </button>;
}
