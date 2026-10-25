import {useEffect,useState,useRef} from 'react';
import {browserPushCapability,checkedPushStatus,readRememberedPushId,removeBrowserPush,subscribeBrowserPush,type PushStatus} from './push-notifications';

export type PushSessionAuthority={clientContext?:string;current:()=>boolean;onSessionLost:()=>void};

export function usePushNotifications(authority:PushSessionAuthority) {
  const latest=useRef(authority);latest.current=authority;
  const context=authority.clientContext || '',supported=browserPushCapability()==='supported';
  const [status,setStatus]=useState<PushStatus|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[notice,setNotice]=useState<'enabled'|'removed'|''>(''),[tick,setTick]=useState(0);
  const [denied,setDenied]=useState(()=>supported && Notification.permission==='denied');
  const live=()=>/^[a-f0-9]{64}$/.test(context) && latest.current.current();
  const request=async<T>(path:string,init:RequestInit={},signal?:AbortSignal):Promise<T>=>{
    if(!live())throw Error('Session context changed. Push settings were not changed.');
    const response=await fetch(path,{...init,credentials:'include',cache:'no-store',redirect:'error',
      headers:{...(init.body!==undefined?{'content-type':'application/json'}:{}),'x-client-session-context':context},
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
    let data;
    try {data=await response.json();}catch{throw Error('Push settings could not be read. In-app notifications remain available.');}
    if(response.status===401 || response.status===409 && data?.error==='Session context changed'){
      latest.current.onSessionLost();throw Error('Session context changed. Push settings were not changed.');
    }
    if(!live())throw Error('Session context changed. Push settings were not changed.');
    if(!response.ok)throw Error(typeof data?.error==='string' && data.error.length<=300?data.error:'Push settings could not be saved.');
    return data as T;
  };
  useEffect(()=>{
    if(!/^[a-f0-9]{64}$/.test(context)){setStatus(null);setLoading(false);return;}
    const controller=new AbortController();
    setLoading(true);setError('');
    request('/api/push/status',{},controller.signal)
      .then(value=>{if(!controller.signal.aborted)setStatus(checkedPushStatus(value));})
      .catch(reason=>{if(!controller.signal.aborted)setError((reason as Error).message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[context,tick]);
  const enable=async()=>{
    if(busy || !status || status.adapter!=='webpush' || !status.configured || !status.publicKey)return;
    setBusy(true);setError('');setMessage('');setNotice('');
    try {
      await subscribeBrowserPush(status.publicKey,context,body=>request('/api/push/subscriptions',{method:'POST',body:JSON.stringify(body)}));
      setDenied(false);setNotice('enabled');setMessage('Push alerts are enabled on this device. Delivery can be delayed or blocked; in-app notifications remain the record.');
      setTick(value=>value+1);
    } catch(reason) {
      if((reason as {code?:string}).code==='permission' && supported)setDenied(Notification.permission==='denied');
      setError((reason as Error).message);
    } finally {setBusy(false);}
  };
  const remove=async(id:string)=>{
    if(busy)return;
    setBusy(true);setError('');setMessage('');setNotice('');
    try {
      await removeBrowserPush(id,context,value=>request(`/api/push/subscriptions/${encodeURIComponent(value)}`,{method:'DELETE'}));
      setNotice('removed');setMessage('This push registration was removed.');setTick(value=>value+1);
    } catch(reason) {setError((reason as Error).message);}
    finally {setBusy(false);}
  };
  const thisDeviceId=readRememberedPushId(sessionStorage,context);
  return {status,loading,busy,error,message,notice,denied,supported,thisDeviceId,enable,remove,reload:()=>setTick(value=>value+1)};
}
