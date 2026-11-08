import {watchNeonNotifications} from './neon-notifications';
import {useEffect,useRef,useState} from 'react';
import {Bell} from 'lucide-react';
import {gsap} from 'gsap';
import {useGSAP} from '@gsap/react';
import {validPageSession,type PageSession} from './session-state';

gsap.registerPlugin(useGSAP);

export const notificationChanged='understood:notifications-changed';

export function NotificationBell({session,label,locale='en',disabled=false,onOpen,onSessionLost,showLabel=false}:{
  session:PageSession;label:string;locale?:string;disabled?:boolean;onOpen:()=>void;onSessionLost:()=>void;showLabel?:boolean;
}) {
  const buttonRef=useRef<HTMLButtonElement>(null);
  useGSAP(()=>{
    const button=buttonRef.current;
    if(!button || disabled)return;
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      const ring=gsap.timeline({paused:true,defaults:{ease:'sine.inOut'}})
        .set('.notification-bell-icon',{transformOrigin:'50% 15%'})
        .to('.notification-bell-icon',{rotation:16,duration:0.1})
        .to('.notification-bell-icon',{rotation:-13,duration:0.14})
        .to('.notification-bell-icon',{rotation:9,duration:0.13})
        .to('.notification-bell-icon',{rotation:-5,duration:0.12})
        .to('.notification-bell-icon',{rotation:0,duration:0.16});
      const hover=(event:PointerEvent)=>{if(event.pointerType!=='touch')ring.restart();};
      const focus=()=>{if(button.matches(':focus-visible'))ring.restart();};
      button.addEventListener('pointerenter',hover);
      button.addEventListener('focus',focus);
      return()=>{button.removeEventListener('pointerenter',hover);button.removeEventListener('focus',focus);};
    });
    return()=>media.revert();
  },{scope:buttonRef,dependencies:[disabled],revertOnUpdate:true});
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
    // Live notifications are a staff feature; workers keep the polling fallback.
    const stopLive=session.role==='worker'?()=>{}:watchNeonNotifications(binding,controller.signal,changed);
    void read();const timer=window.setInterval(changed,30000);
    window.addEventListener(notificationChanged,changed);window.addEventListener('focus',changed);
    window.addEventListener('hashchange',changed);document.addEventListener('visibilitychange',changed);
    return()=>{controller.abort();stopLive();clearInterval(timer);window.removeEventListener(notificationChanged,changed);
      window.removeEventListener('focus',changed);window.removeEventListener('hashchange',changed);document.removeEventListener('visibilitychange',changed);};
  },[binding]);
  const unread=count?.binding===binding && validPageSession(session)?count.unread:0;
  const display=new Intl.NumberFormat(locale).format(Math.min(unread,99))+(unread>99?'+':'');
  return <button ref={buttonRef} type="button" className={`icon-button bell notification-bell${showLabel?' worker-header-action':''}`} aria-label={unread?`${label} (${new Intl.NumberFormat(locale).format(unread)})`:label}
    title={label} disabled={disabled} onClick={onOpen}><Bell className="notification-bell-icon" size={21} aria-hidden="true"/>
    {unread>0 && <span className={`notification-count${showLabel?' is-inline':''}`} aria-hidden="true">{display}</span>}
    {showLabel && <span className="worker-header-action-label" aria-hidden="true">{label}</span>}
  </button>;
}
