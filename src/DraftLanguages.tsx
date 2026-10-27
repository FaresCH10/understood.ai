import {GENERATION_LANGUAGE_CODES,workerLocale} from '../server/languages.mjs';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Languages,RefreshCw,Save,X} from 'lucide-react';
import {readDraftLanguages,saveDraftLanguages,clearDraftLanguages,requestDraftLanguages,DraftLanguagesError,type PendingDraftLanguages,type LanguageSession} from './draft-languages-recovery';

export default function DraftLanguages({id,revision,selection,session,canWrite,disabled,onChanged,onEditingChange}:{id:string;revision:number;selection:string[]|null;session:LanguageSession;canWrite:boolean;disabled:boolean;onChanged:()=>void;onEditingChange:(editing:boolean)=>void}) {
  const [recovery,setRecovery]=useState(()=>{try{return {pending:readDraftLanguages(sessionStorage,session,id),error:''};}catch(error){return {pending:null,error:(error as Error).message};}});
  const [editing,setEditing]=useState(false),[defaults,setDefaults]=useState(selection===null),[languages,setLanguages]=useState(selection || ['en','ar','ur']);
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[absent,setAbsent]=useState(false),[rejected,setRejected]=useState(false),[error,setError]=useState(''),[tick,setTick]=useState(0);
  const inFlight=useRef(false),controller=useRef<AbortController|null>(null),trigger=useRef<HTMLButtonElement>(null),callback=useRef(onChanged),editCallback=useRef(onEditingChange);callback.current=onChanged;editCallback.current=onEditingChange;
  const pending=recovery.pending,changed=JSON.stringify(defaults?null:languages)!==JSON.stringify(selection);
  useEffect(()=>{editCallback.current(editing || !!pending || !!recovery.error);return ()=>editCallback.current(false);},[editing,pending,recovery.error]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{
    if(!pending || inFlight.current)return;
    const abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),30000);let current=true;setBusy(true);setAbsent(false);
    requestDraftLanguages(pending,false,fetch,abort.signal).then(found=>{
      if(!current)return;
      if(found){clearDraftLanguages(sessionStorage,pending);setRecovery({pending:null,error:''});setEditing(false);setConfirmed(false);callback.current();trigger.current?.focus();}
      else setAbsent(true);
    }).catch(reason=>{if(current)setError((reason as Error).message);}).finally(()=>{clearTimeout(timeout);if(current)setBusy(false);});
    return ()=>{current=false;clearTimeout(timeout);abort.abort();};
  },[pending,tick]);
  async function send(value:PendingDraftLanguages) {
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setAbsent(false);setRejected(false);
    const abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),30000);
    try{saveDraftLanguages(sessionStorage,value);setRecovery({pending:value,error:''});await requestDraftLanguages(value,true,fetch,abort.signal);}
    catch(reason){setError((reason as Error).message);setRejected(reason instanceof DraftLanguagesError && reason.rejected);}
    finally{clearTimeout(timeout);inFlight.current=false;setBusy(false);setConfirmed(false);setTick(n=>n+1);}
  }
  function submit(event:FormEvent) {event.preventDefault();if(!canWrite || !confirmed || !changed || busy)return;void send({...session,briefingId:id,requestId:crypto.randomUUID(),body:{revision,generationLanguages:defaults?null:languages,confirmed:true}});}
  if(recovery.error)return <p role="alert" className="record-error">{recovery.error}</p>;
  if(pending)return <div className="draft-review"><h3>Language change receipt</h3><p>{pending.body.generationLanguages?.map(code=>workerLocale(code)?.englishName || code).join(', ') || 'Site generation defaults'} · source revision {pending.body.revision}</p>
    <p role="status">{busy?'Checking language change...':absent?'No accepted receipt was found.':'Acceptance has not been verified.'}</p>{error && <p role="alert" className="record-error">{error}</p>}
    {absent && !rejected && <label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>Retry the original language change</span></label>}
    <div className="actions"><button className="button outline" disabled={busy} onClick={()=>{setError('');setTick(n=>n+1);}}><RefreshCw size={18}/>Check receipt</button>{absent && !rejected && <button className="button primary" disabled={busy || !confirmed} onClick={()=>void send(pending)}><Save size={18}/>Retry unchanged change</button>}
      {absent && rejected && <button className="button outline" disabled={busy} onClick={()=>{try{clearDraftLanguages(sessionStorage,pending);setRecovery({pending:null,error:''});setEditing(false);callback.current();}catch(reason){setError((reason as Error).message);}}}><X size={18}/>Close rejected change</button>}</div></div>;
  return <div className="draft-review"><p>Preparation languages: {selection?.map(code=>workerLocale(code)?.englishName || code).join(', ') || 'Site generation defaults'}</p>
    {canWrite && (editing?<form onSubmit={submit}><fieldset className="generation-language-options" disabled={busy}><legend>Draft preparation languages</legend>
      <label className="billing-confirm"><input type="checkbox" checked={defaults} onChange={event=>{setDefaults(event.target.checked);setConfirmed(false);}}/><span>Use site generation defaults</span></label>
      {!defaults && GENERATION_LANGUAGE_CODES.map(code=><label className="billing-confirm" key={code}><input type="checkbox" disabled={code==='en'} checked={languages.includes(code)} onChange={event=>{setLanguages(old=>GENERATION_LANGUAGE_CODES.filter(language=>language===code?event.target.checked:old.includes(language)));setConfirmed(false);}}/><span>{code==='en'?'English (source)':workerLocale(code)?.englishName || code}</span></label>)}</fieldset>
      <p>Published versions and answers stay unchanged. This draft will be prepared again.</p><label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={busy || !changed} onChange={event=>setConfirmed(event.target.checked)}/><span>Save these languages and regenerate this draft</span></label>
      {error && <p role="alert" className="record-error">{error}</p>}<div className="actions"><button className="button primary" disabled={busy || !confirmed || !changed}><Save size={18}/>Save languages</button><button className="button outline" type="button" disabled={busy} onClick={()=>{setEditing(false);trigger.current?.focus();}}><X size={18}/>Cancel</button></div>
    </form>:<button ref={trigger} className="button outline" disabled={disabled} onClick={()=>{setDefaults(selection===null);setLanguages(selection || ['en','ar','ur']);setConfirmed(false);setError('');setEditing(true);}}><Languages size={18}/>Change draft languages</button>)}
  </div>;
}
