import {useEffect,useRef,useState} from 'react';
import {RefreshCw,ArrowLeft,ArrowRight} from 'lucide-react';
import {recoverWorkerEntry,workerEntryRecoveryText,type PendingWorkerEntry} from './worker-entry-recovery';
import {workerUiDirection} from './worker-ui-language';
import type {PageSession} from './session-state';

export default function WorkerEntryRecovery({pending,storageError,paused,request,onResolved,onAnother}:{pending:PendingWorkerEntry|null;storageError:string;paused:boolean;request:(path:string,options?:RequestInit)=>Promise<unknown>;onResolved:(session:PageSession)=>void;onAnother:()=>Promise<void>}){
  const language=pending?.language??'en',t=workerEntryRecoveryText[language];
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[unconfirmed,setUnconfirmed]=useState(false),[tick,setTick]=useState(0);
  const heading=useRef<HTMLHeadingElement>(null),live=useRef(true),another=useRef(false),resolved=useRef(onResolved);resolved.current=onResolved;
  useEffect(()=>{live.current=true;heading.current?.focus();return()=>{live.current=false;};},[]);
  useEffect(()=>{
    if(paused || !pending)return;let current=true;setBusy(true);setError('');setUnconfirmed(false);
    recoverWorkerEntry(pending,request).then(session=>{if(!current)return;if(session)resolved.current(session);else setUnconfirmed(true);})
      .catch(()=>{if(current)setError(t.checkFailed);}).finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;};
  },[paused,pending,tick,request,t]);
  async function useAnother(){if(busy || paused || another.current)return;another.current=true;setBusy(true);setError('');try{await onAnother();}catch{if(live.current)setError(t.anotherFailed);}finally{another.current=false;if(live.current)setBusy(false);}}
  return <section className="worker-entry-recovery" lang={language} dir={workerUiDirection(language)}><h1 ref={heading} tabIndex={-1}>{t.title}</h1><p>{t.body}</p>{storageError && <p role="alert">{t.storageUnavailable}</p>}{unconfirmed && <p role="status">{t.unconfirmed}</p>}{error && <p role="alert">{error}</p>}<div className="entry-actions">{pending && <button className="button primary" disabled={busy || paused} onClick={()=>setTick(n=>n+1)}><RefreshCw size={20}/>{busy || paused?t.checking:t.check}</button>}<button className="button outline" disabled={busy || paused} onClick={()=>void useAnother()}>{workerUiDirection(language)==='rtl'?<ArrowRight size={20}/>:<ArrowLeft size={20}/>}{t.another}</button></div></section>;
}
