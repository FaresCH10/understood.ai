import {useEffect,useRef,useState} from 'react';
import {HardDrive,RefreshCw,Send,Trash2} from 'lucide-react';
import {browserAudioDraftFor,readAudioDraft,clearAudioDraft,audioDraftCopy,subscribeAudioDraftChanges,type AudioDraft} from './worker-audio-draft';
import type {PageSession} from './session-state';
import type {RecordingScope} from './worker-audio-retry';
import {usePrivateDevice} from './usePrivateDevice';
import {sharedDeviceText} from './worker-device-policy';
import {workerUiFallbackLanguage,type WorkerUiLanguage} from './worker-ui-language';

export type AudioDraftProps={session:PageSession;interfaceLanguage?:WorkerUiLanguage;scope:RecordingScope;refresh:number;disabled:boolean;blocked:boolean;consent:boolean;current:()=>boolean;onConsent:(value:boolean)=>void;onSend:(bytes:Uint8Array,id:string,presentationId:string|null)=>Promise<void>;onCheck:(id:string)=>Promise<void>};
export function WorkerAudioDraft({session,interfaceLanguage,scope,refresh,disabled,blocked,consent,current,onConsent,onSend,onCheck}:AudioDraftProps){
  const language=interfaceLanguage??workerUiFallbackLanguage(session);
  const t=audioDraftCopy[language];
  const [status,setStatus]=useState<'loading'|'empty'|'saved'|'other'|'failed'|'removed'|'received'>('loading');
  const privateDevice=usePrivateDevice(session.clientContext!);
  const [draft,setDraft]=useState<AudioDraft|null>(null),[tick,setTick]=useState(0),[working,setWorking]=useState(false),[url,setUrl]=useState('');
  const allowed=useRef(current);allowed.current=current;
  const live=useRef(false);
  const readRevision=useRef(0);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>subscribeAudioDraftChanges(()=>{readRevision.current++;setDraft(null);setStatus('loading');setTick(value=>value+1);}),[]);
  useEffect(()=>{onConsent(false);},[session.clientContext,scope.assignmentId,scope.publicationId,scope.version]);
  useEffect(()=>{
    let active=true;const revision=++readRevision.current;setStatus('loading');setDraft(null);
    void browserAudioDraftFor(scope).then(store=>readAudioDraft(store,session,scope,()=>active && readRevision.current===revision && allowed.current())).then(value=>{
      if(!active || readRevision.current!==revision || !allowed.current())return;setStatus(value.status);setDraft(value.status==='saved'?value.draft:null);
    }).catch(()=>{if(active && readRevision.current===revision)setStatus('failed');});
    return()=>{active=false;};
  },[session.clientContext,session.expiresAt,scope.assignmentId,scope.publicationId,scope.version,scope.language,refresh,tick]);
  useEffect(()=>{
    if(!draft || disabled){setUrl('');return;}
    const next=URL.createObjectURL(new Blob([new Uint8Array(draft.bytes)],{type:'audio/wav'}));setUrl(next);
    return()=>URL.revokeObjectURL(next);
  },[draft,disabled]);
  useEffect(()=>{
    if(!draft)return;
    const timer=window.setTimeout(()=>{setDraft(null);setStatus('loading');setTick(value=>value+1);},Math.max(0,Date.parse(draft.expiresAt)-Date.now()));
    return()=>window.clearTimeout(timer);
  },[draft]);
  const run=async(action:'remove'|'send'|'check')=>{
    if(disabled || working || !allowed.current() || (action==='send' && blocked))return;
    setWorking(true);
    try {
      if(action==='remove'){await clearAudioDraft(await browserAudioDraftFor(scope),session.clientContext);if(live.current && allowed.current()){setDraft(null);setStatus('removed');}}
      else if(draft){
        if(Date.parse(draft.expiresAt)<=Date.now()){setDraft(null);setTick(value=>value+1);return;}
        if(action==='send'){await onSend(new Uint8Array(draft.bytes),draft.submissionId,draft.presentationId);if(live.current && allowed.current())setStatus('received');}
        else await onCheck(draft.submissionId);
      }
    }catch {if(live.current)setStatus('failed');}
    finally {if(live.current)setWorking(false);}
  };
  return <details className="worker-text-draft worker-audio-draft"><summary><HardDrive size={18}/>{t.title}</summary>
    <p>{t.privacy}</p>{!privateDevice && <p>{sharedDeviceText[language].blocked}</p>}<label className="checkbox-label"><input type="checkbox" checked={consent} disabled={disabled || working || !privateDevice} onChange={event=>onConsent(event.target.checked)}/>{t.consent}</label>
    <p role="status">{t[status]}</p>
    {draft && !disabled && <><time dateTime={draft.capturedAt}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(draft.capturedAt))}</time><audio controls preload="none" src={url || undefined} aria-label={t.title}/></>}
    <div className="actions"><button className="button outline" disabled={disabled || working || !draft || blocked || status==='received'} onClick={()=>void run('send')}><Send size={18}/>{t.send}</button>
      <button className="button outline" disabled={disabled || working || !draft} onClick={()=>void run('check')}><RefreshCw size={18}/>{t.check}</button>
      <button className="button subtle" disabled={disabled || working} onClick={()=>void run('remove')}><Trash2 size={18}/>{t.remove}</button>
      <button className="icon-button" aria-label={t.reload} title={t.reload} disabled={disabled || working} onClick={()=>setTick(value=>value+1)}><RefreshCw size={18}/></button></div>
  </details>;
}
