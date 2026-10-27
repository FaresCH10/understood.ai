import {useEffect,useRef,useState} from 'react';
import {samePageSession,validPageSession,type PageSession} from './session-state';
import {BootstrapSessionError,fetchBootstrapSession} from './worker-offline';

const signal='understood:session-signal';
export function useWorkerSessionGuard(session:PageSession|null,paused:boolean) {
  const [suspended,setSuspended]=useState<string|null>(null),retry=useRef<(()=>void)|null>(null);
  const [locked,setLocked]=useState<string|null>(null),[checking,setChecking]=useState<string|null>(null);
  const binding=session?.authenticated?JSON.stringify([session.clientContext,session.role,session.staffRole,session.staffScope,session.siteState,session.expiresAt]):null;
  const lockedRef=useRef<string|null>(null),checkingRef=useRef<string|null>(null),active=useRef(binding);active.current=binding;
  const channel=useRef<BroadcastChannel|null>(null),previous=useRef<string|null>(null);
  const invalidate=()=>{if(binding && active.current===binding){lockedRef.current=binding;setLocked(binding);}};
  const resume=()=>{if(active.current!==binding)return;setSuspended(null);lockedRef.current=null;checkingRef.current=null;setLocked(null);setChecking(null);};
  useEffect(()=>{
    try {channel.current=new BroadcastChannel(signal);}catch {channel.current=null;}
    return()=>{channel.current?.close();channel.current=null;};
  },[]);
  useEffect(()=>{
    if(!session)return;
    const context=session.authenticated ? session.clientContext || null : 'signed-out';
    if(previous.current!==null && previous.current!==context) {
      if(channel.current)channel.current.postMessage('changed');
      else try {localStorage.setItem(signal,crypto.randomUUID());localStorage.removeItem(signal);}catch {/* Foreground and expiry checks still apply. */}
    }
    previous.current=context;
  },[session?.authenticated,session?.clientContext]);
  useEffect(()=>{
    if(!session?.authenticated || paused || locked===binding)return;
    if(!validPageSession(session)){invalidate();return;}
    let live=true,inFlight=false,unverified=false,retryTimer:ReturnType<typeof setTimeout>|undefined;
    const controller=new AbortController();
    const lock=(denied=false)=>{if(live && active.current===binding){if(denied && session.role==='worker')try{sessionStorage.removeItem('understood:offline-context');}catch{}invalidate();}};
    const check=async(background=false)=>{
      if(!live || inFlight)return;
      if(!validPageSession(session)){lock(true);return;}
      inFlight=true;
      if(session.role==='staff' && !background){checkingRef.current=binding;setChecking(binding);}
      try {
        const value=await fetchBootstrapSession(fetch,controller.signal);
        if(!samePageSession(session,value))lock(true);
        else{unverified=false;setSuspended(null);}
      }catch(error) {
        if(!controller.signal.aborted && live && active.current===binding){
          if(error instanceof BootstrapSessionError && [401,403,409,410].includes(error.status || 0))lock(true);
          else{
            if(!unverified)window.dispatchEvent(new Event('understood:session-verification-pending'));
            unverified=true;checkingRef.current=binding;setChecking(binding);setSuspended(binding);
            clearTimeout(retryTimer);retryTimer=setTimeout(()=>void check(true),5000);
          }
        }
      }finally {inFlight=false;if(live && active.current===binding && !unverified){checkingRef.current=null;setChecking(null);}}

    };
    retry.current=()=>{clearTimeout(retryTimer);void check(true);};
    const foreground=()=>{if(document.visibilityState==='visible')void check();};
    const message=(event:MessageEvent)=>{if(event.data==='changed')lock(true);};
    const storage=(event:StorageEvent)=>{if(event.key===signal && event.newValue)lock(true);};
    let expiry:number;
    const watchExpiry=()=>{const remaining=Date.parse(session.expiresAt!)-Date.now();if(remaining<=0){lock(true);return;}expiry=window.setTimeout(watchExpiry,Math.min(2147483647,remaining));};watchExpiry();
    // Revalidate access quietly; periodic checks must not inert the whole page
    // and steal focus from a draft or an active recording.
    const polling=window.setInterval(()=>{if(document.visibilityState==='visible')void check(true);},60000);
    channel.current?.addEventListener('message',message);
    window.addEventListener('storage',storage);window.addEventListener('focus',foreground);
    window.addEventListener('online',foreground);document.addEventListener('visibilitychange',foreground);
    // Catch a cookie rotation between the initial read and this view opening.
    void check();
    return()=>{
      live=false;retry.current=null;clearTimeout(retryTimer);controller.abort();clearTimeout(expiry);clearInterval(polling);if(checkingRef.current===binding)checkingRef.current=null;
      channel.current?.removeEventListener('message',message);
      window.removeEventListener('storage',storage);window.removeEventListener('focus',foreground);
      window.removeEventListener('online',foreground);document.removeEventListener('visibilitychange',foreground);
    };
  },[binding,session?.language,session?.workerId,paused,locked]);
  return {suspended:!!binding && suspended===binding,retry:()=>retry.current?.(),locked:!!binding && locked===binding,checking:!!binding && !paused && checking===binding,invalidate,resume,
    isInvalidated:()=>!!active.current && lockedRef.current===active.current,
    isLocked:()=>!!active.current && (lockedRef.current===active.current || checkingRef.current===active.current)};
}
