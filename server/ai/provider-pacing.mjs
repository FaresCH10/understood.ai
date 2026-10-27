import {setTimeout as delay} from 'node:timers/promises';

// Shared by handles created for individual metered operations. Reserve only the
// next slot, so a burst cannot book minutes of requests ahead of another job.
export function createProviderPacer({intervalMs=6000,intervals={},now=Date.now,wait=delay}={}) {
  if(!Number.isInteger(intervalMs) || intervalMs<0 || intervalMs>30000)throw Error('Invalid provider request interval');
  if(!intervals || typeof intervals!=='object' || Array.isArray(intervals)
    || Object.values(intervals).some(value=>!Number.isInteger(value) || value<0 || value>30000))throw Error('Invalid provider request interval');
  const configured={...intervals};
  const next=new Map();
  return async model=>{
    const interval=configured[model] ?? intervalMs;
    if(interval===0)return;
    for(;;){
      const time=now(),remaining=(next.get(model) ?? 0)-time;
      if(remaining<=0){next.set(model,time+interval);return;}
      await wait(remaining);
    }
  };
}
