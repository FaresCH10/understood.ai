import type {SealedLiveQuery} from '@neon/realtime/client';

export function watchNeonNotifications(binding:string,signal:AbortSignal,onChanged:()=>void){
  let close=()=>{},timer:ReturnType<typeof setTimeout>|undefined;
  const connect=async()=>{
    close();
    try{
      const response=await fetch('/api/notifications/live',{credentials:'include',cache:'no-store',redirect:'error',
        headers:{'x-client-session-context':binding},signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
      if(!response.ok||signal.aborted)return; // SQLite deployments retain the existing polling fallback.
      const data=await response.json() as {url:string;query:SealedLiveQuery<{events:string;reads:string}>};
      if(!data.url.startsWith('wss://')||!data.query.capability||!Number.isFinite(data.query.expiresAt))return;
      const {createRealtimeClient}=await import('@neon/realtime/client');
      if(signal.aborted)return;
      const client=createRealtimeClient({url:data.url}),subscription=client.subscribe(data.query);
      let previous='';
      subscription.onChange(snapshot=>{
        if(signal.aborted||snapshot.status!=='live'||!snapshot.data)return;
        const fingerprint=JSON.stringify(snapshot.data);
        if(fingerprint!==previous){previous=fingerprint;onChanged();}
      });
      close=()=>{subscription.unsubscribe();client.close();};
      timer=setTimeout(()=>void connect(),Math.max(5000,data.query.expiresAt-Date.now()-30000));
    }catch{if(!signal.aborted)timer=setTimeout(()=>void connect(),30000);}
  };
  void connect();
  const stop=()=>{clearTimeout(timer);close();};
  signal.addEventListener('abort',stop,{once:true});
  return stop;
}
