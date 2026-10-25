import React,{useEffect,useState} from 'react';
import {Save,RotateCcw,Trash2} from 'lucide-react';
import {canRestoreTextDraft,removeTextDraft,restoreTextDraft,saveTextDraft,textDraftStatus,textDraftCopy,type DraftScope,type TextDraft} from './worker-text-draft';
import type {PageSession} from './session-state';
import {usePrivateDevice} from './usePrivateDevice';
import {sharedDeviceText} from './worker-device-policy';
import {workerUiFallbackLanguage,type WorkerUiLanguage} from './worker-ui-language';

export function WorkerTextDraft({session,interfaceLanguage,scope,draft,disabled,restoreBlocked,current,onRestore}:{session:PageSession;interfaceLanguage?:WorkerUiLanguage;scope:DraftScope;draft:TextDraft;disabled:boolean;restoreBlocked:boolean;current:()=>boolean;onRestore:(value:TextDraft)=>void}){
  const language=interfaceLanguage??workerUiFallbackLanguage(session);
  const t=textDraftCopy[language];
  const [consent,setConsent]=useState(false),[status,setStatus]=useState<keyof typeof t>('empty');
  const privateDevice=usePrivateDevice(session.clientContext!);
  useEffect(()=>{
    setConsent(false);
    try {if(current())setStatus(textDraftStatus(sessionStorage,session,scope));}catch {setStatus('failed');}
  },[session.clientContext,scope.assignmentId,scope.publicationId,scope.version]);
  const run=(action:'save'|'restore'|'remove')=>{
    if(disabled || !current())return;
    try {
      if(action==='save'){saveTextDraft(sessionStorage,session,scope,draft,consent);setStatus('saved');}
      else if(action==='remove'){removeTextDraft(sessionStorage);setStatus('removed');}
      else {
        if(!canRestoreTextDraft(draft,restoreBlocked))return;
        const value=restoreTextDraft(sessionStorage,session,scope);
        if(value){onRestore(value);setStatus('restored');}else setStatus('empty');
      }
    }catch {setStatus('failed');}
  };
  return <section className="worker-text-draft" aria-label={t.title}>
    <h2>{t.title}</h2><p>{t.limits}</p>
    {!privateDevice && <p>{sharedDeviceText[language].blocked}</p>}
    <label className="checkbox-label"><input type="checkbox" checked={consent} disabled={disabled || !privateDevice} onChange={event=>setConsent(event.target.checked)}/>{t.consent}</label>
    <p role="status">{t[status]}</p>
    {status==='restored' && <div className="worker-restored-text">{draft.answer && <p>{draft.answer}</p>}{draft.help && <p>{draft.help}</p>}</div>}
    <div className="actions">
      <button className="button outline" disabled={disabled || !privateDevice || !consent || (!draft.answer.trim() && !draft.help.trim() && !draft.receipts.length) || status==='other'} onClick={()=>run('save')}><Save size={18}/>{t.save}</button>
      <button className="button outline" disabled={disabled || !['saved','restored'].includes(status) || !canRestoreTextDraft(draft,restoreBlocked)} onClick={()=>run('restore')}><RotateCcw size={18}/>{t.restore}</button>
      <button className="button subtle" disabled={disabled} onClick={()=>run('remove')}><Trash2 size={18}/>{t.remove}</button>
    </div>
  </section>;
}
