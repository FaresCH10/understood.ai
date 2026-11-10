import {useEffect,useRef,useState} from 'react';
import {ChevronDown,RefreshCw,ShieldCheck,Trash2,UserRoundCheck} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {ClarificationContractError,checkedClarificationActionReceipt,type ClarificationActionReceipt,type ClarificationDetail} from './clarification-contract';
import {canonicalClarificationAction,clarificationActionHash,clearClarificationAction,readClarificationAction,retainClarificationAction,type ClarificationActionContent,type PendingClarificationAction} from './clarification-action-recovery';
import {keepDialogFocus} from './dialog-focus';
import {caseText,caseMessage,type CaseLocale,type CaseTextKey} from './clarification-locale';

const resolutionNotes=(value:string)=>value.replace(/^\[Understood:(ready|blocked|cancelled)\]\n?/, '');
type Draft={notes:string;notesBase:string;owner:string;ownerBase:string};
export function ClarificationActions({data,authority,available,canWrite,onDirtyChange,onChanged,language:locale='en'}:{data:ClarificationDetail;authority:StaffRequestAuthority;available:boolean;canWrite:boolean;onDirtyChange:(dirty:boolean)=>void;onChanged:()=>void;language?:CaseLocale}){
  const t=(key:CaseTextKey)=>caseText(locale,key);
  const [resolution,setResolution]=useState(()=>data.status==='resolved'?/^\[Understood:(ready|blocked|cancelled)\]/.exec(data.notes)?.[1]||'':'');
  const api=useStaffRequest(authority),[draft,setDraft]=useState<Draft>({notes:resolutionNotes(data.notes),notesBase:resolutionNotes(data.notes),owner:data.owner_staff_id||'',ownerBase:data.owner_staff_id||''});
  const [pending,setPending]=useState<PendingClarificationAction|null>(null),[receipt,setReceipt]=useState<ClarificationActionReceipt|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recoveryFailed,setRecoveryFailed]=useState(false);
  const live=useRef(false),inFlight=useRef(false),command=useRef<AbortController|null>(null),latest=useRef({draft,authority,available,canWrite,onDirtyChange,onChanged});latest.current={draft,authority,available,canWrite,onDirtyChange,onChanged};
  const dialog=useRef<HTMLDialogElement>(null),clearTrigger=useRef<HTMLButtonElement>(null),clearIntent=useRef<Draft|null>(null);
  const notesInput=useRef<HTMLTextAreaElement>(null),resolveDetails=useRef<HTMLDetailsElement>(null),resolveSummary=useRef<HTMLElement>(null);
  useEffect(()=>{if(resolveDetails.current&&(data.status==='resolved'||!!resolution))resolveDetails.current.open=true;},[]);
  const path=`/api/clarifications/${encodeURIComponent(data.id)}`;
  const current=()=>live.current&&api.current();
  const writable=()=>current()&&latest.current.available&&latest.current.canWrite&&latest.current.authority.canMutate();
  const dirty=draft.notes!==draft.notesBase||draft.owner!==draft.ownerBase||busy||data.status==='open'&&!!resolution;
  useEffect(()=>{live.current=true;try{setPending(readClarificationAction(sessionStorage,authority.session,data.id));}catch{setRecoveryFailed(true);setError('Local action recovery could not be verified. No new action will be sent.');}return()=>{live.current=false;command.current?.abort();latest.current.onDirtyChange(false);};},[]);
  useEffect(()=>{
    setDraft(old=>({notes:old.notes===old.notesBase?resolutionNotes(data.notes):old.notes,notesBase:resolutionNotes(data.notes),
      owner:old.owner===old.ownerBase?data.owner_staff_id||'':old.owner,ownerBase:old.owner===old.ownerBase?data.owner_staff_id||'':old.ownerBase}));
  },[data.notes,data.owner_staff_id]);
  useEffect(()=>{latest.current.onDirtyChange(dirty);if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  function content(kind:'assign'|'resolve',value=latest.current.draft):ClarificationActionContent{
    return canonicalClarificationAction(kind==='resolve'?{kind,notes:`[Understood:${resolution}]\n${value.notes}`}:{kind,ownerId:value.owner||null,expectedOwnerId:value.ownerBase||null});
  }
  async function accept(value:unknown,retained:PendingClarificationAction){
    const result=checkedClarificationActionReceipt(value,data.id,retained,authority.session.clientContext!);
    const candidate=latest.current.draft;let matching=false;
    try{matching=await clarificationActionHash(content(retained.kind,candidate))===retained.hash;}catch{/* A different or empty draft is not part of this receipt. */}
    if(!current())return;
    setReceipt(result);
    try{clearClarificationAction(sessionStorage,authority.session,data.id,retained);setPending(null);setRecoveryFailed(false);}catch{setRecoveryFailed(true);setError('The server receipt is verified, but local recovery could not be cleared. No new action will be sent.');}
    if(matching&&latest.current.draft===candidate&&result.effect!=='rejected')setDraft(old=>retained.kind==='assign'?{...old,owner:result.ownerId||'',ownerBase:result.ownerId||''}:{...old,notes:candidate.notes.trim(),notesBase:candidate.notes.trim()});
    if(retained.kind==='resolve'&&result.effect!=='rejected')setResolution('');
    latest.current.onChanged();
  }
  async function act(kind:'assign'|'resolve'|'check'){
    if(inFlight.current||!current()||kind!=='check'&&(recoveryFailed||!writable()))return;
    inFlight.current=true;setBusy(true);setError('');if(kind!=='check')setReceipt(null);const controller=new AbortController();command.current=controller;
    let retained:PendingClarificationAction|null=null;
    try{
      const captured=kind==='check'?null:content(kind);
      if(kind==='check')retained=readClarificationAction(sessionStorage,authority.session,data.id);
      else retained=await retainClarificationAction(sessionStorage,authority.session,data.id,captured!,writable);
      if(!retained)throw Error('No pending action');if(!current())return;setPending(retained);
      const body=!captured?undefined:captured.kind==='resolve'?{requestId:retained.id,notes:captured.notes}:{requestId:retained.id,ownerId:captured.ownerId,expectedOwnerId:captured.expectedOwnerId};
      const value=await api.request<unknown>(kind==='check'?`${path}/actions/${retained.id}`:`${path}/${kind}`,body,controller.signal);
      if(!current()||kind!=='check'&&!writable())return;await accept(value,retained);
    }catch(reason){
      if(!current())return;
      if(reason instanceof ClarificationContractError&&reason.code==='session'){authority.onSessionLost();return;}
      setError(retained?'The action outcome is not confirmed. Check its receipt before retrying. Only the exact original action can be resent.':'The action could not be prepared. Check the draft and local recovery before trying again.');
    }finally{inFlight.current=false;if(current())setBusy(false);}
  }
  const editable=available&&canWrite&&data.status==='open'&&!busy&&!recoveryFailed&&authority.canMutate();
  const resolved=data.status==='resolved',recordedOutcome=resolved?/^\[Understood:(ready|blocked|cancelled)\]/.exec(data.notes)?.[1]||'':'';
  const outcomeText=(value:string)=>value==='ready'?t('Explained; worker can continue'):value==='blocked'?t('Work cannot proceed'):t('Work cancelled');
  const rejected=receipt?.effect==='rejected';
  const reason=receipt?.reasonCode==='owner_changed'?'The owner changed before this request.':receipt?.reasonCode==='owner_unavailable'?'The requested supervisor is no longer available.':receipt?.reasonCode==='case_resolved'?'The case was already resolved.':'A different resolution was already recorded.';
  return <>
    {error&&<p role="alert" className="record-error">{caseMessage(locale,error)}</p>}
    {receipt&&<div className={`notice notice-${rejected?'amber':'green'}`} role="status"><p>{rejected?caseText(locale,'Action recorded, but not applied. {reason}',{reason:caseMessage(locale,reason)}):receipt.effect==='unchanged'?t('Receipt verified. The requested state was already present.'):t('Receipt verified. The action was applied.')}</p><p>{t('The receipt describes the state at the time of that request. Original responses and assessments are unchanged.')}</p></div>}
    {pending&&!busy&&<div className="notice notice-amber"><p>{receipt?t("Server receipt verified; local recovery still needs attention."):t("An owner or resolution request has no verified receipt on this screen.")}</p><button className="button outline" disabled={busy||!api.current()} onClick={()=>void act('check')}><RefreshCw size={18}/>{t("Check action receipt")}</button></div>}
    {!available&&<p role="status">{t("Your case drafts are still here. Saving is unavailable until the case details are verified again.")}</p>}
    <section className="panel cd-case-card" aria-labelledby="cd-case-title">
      <h2 id="cd-case-title">{t('Case settings')}</h2>
      <div className="cd-case-owner">
        {resolved?<div className="cd-resolution-record"><span>{t('Supervisor')}</span><strong>{data.owner_name||t('Unassigned')}</strong></div>:<label className="field">{t("Supervisor")}<select aria-label={t('Supervisor')} value={draft.owner} disabled={!editable} onChange={event=>setDraft(old=>({...old,owner:event.target.value}))}><option value="">{t("Unassigned")}</option>{draft.owner&&!data.owners.some(row=>row.id===draft.owner)&&<option value={draft.owner}>{draft.owner===data.owner_staff_id?data.owner_name||t("Former supervisor"):t("Previously selected supervisor")}</option>}{data.owners.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
        {draft.ownerBase!==(data.owner_staff_id||'')&&<div className="notice notice-amber"><p>{t("The current case owner changed. Your requested owner is retained.")}</p><button className="button outline" disabled={!editable||!!pending} onClick={()=>setDraft(old=>({...old,ownerBase:data.owner_staff_id||''}))}>{t("Use current owner as starting point")}</button></div>}
        {canWrite&&data.status==='open'&&(draft.owner!==draft.ownerBase||pending?.kind==='assign')&&<button className="button outline" disabled={!editable||!!pending&&pending.kind!=='assign'} onClick={()=>void act('assign')}><UserRoundCheck size={18}/>{pending?.kind==='assign'?t("Retry exact owner request"):t("Save owner")}</button>}
      </div>
      <details className="cd-settings-row cd-case-resolve" id="cd-resolve-section" ref={resolveDetails}>
        <summary ref={resolveSummary}><span className="cd-settings-copy"><strong>{t(data.status==='resolved'?'Recorded resolution':'Resolve case')}</strong><span>{t(data.status==='resolved'?'Review the recorded outcome and notes.':'Record the outcome and close this follow-up.')}</span></span><ChevronDown size={16} aria-hidden="true"/></summary>
        <div className="cd-settings-body">
          {resolved?<>
            <div className="cd-resolution-record"><span>{t('Follow-up outcome')}</span><strong>{recordedOutcome?outcomeText(recordedOutcome):t('No outcome was recorded.')}</strong></div>
            <div className="cd-resolution-record"><span>{t('Follow-up notes')}</span>{resolutionNotes(data.notes)?<p dir="auto">{resolutionNotes(data.notes)}</p>:<p className="muted">{t('No follow-up notes were recorded.')}</p>}</div>
          </>:<>
            <label className="field">{t('Follow-up outcome')}<select value={resolution} disabled={!editable} onChange={event=>setResolution(event.target.value)}><option value="">{t('Choose an outcome')}</option><option value="ready">{t('Explained; worker can continue')}</option><option value="blocked">{t('Work cannot proceed')}</option><option value="cancelled">{t('Work cancelled')}</option></select></label>{canWrite&&data.canRequestRepeat&&<p className="muted">{locale==='ar'?'لطلب إجابة أخرى، استخدم طلب التكرار واترك الحالة مفتوحة.':'For another answer, request a repeat and keep this case open.'}</p>}<label className="field">{t("Follow-up notes")}<textarea dir="auto" ref={notesInput} value={draft.notes} readOnly={!editable} onChange={event=>setDraft(old=>({...old,notes:event.target.value}))} rows={4} maxLength={950}/></label><p className="case-resolution-privacy">{t('Visible to authorized staff only.')}</p>{canWrite&&<button className="button primary" disabled={!editable||!resolution||draft.notes.trim().length<5||!!pending&&pending.kind!=='resolve'} onClick={()=>void act('resolve')}><ShieldCheck size={18}/>{pending?.kind==='resolve'?t("Retry exact resolution"):t("Resolve case")}</button>}<p className="muted">{t("Resolution records follow-up; it does not certify understanding.")}</p>
          </>}
        </div>
      </details>
    </section>
    {canWrite&&dirty&&<button ref={clearTrigger} className="button outline" disabled={busy} onClick={()=>{clearIntent.current=latest.current.draft;dialog.current?.showModal();}}><Trash2 size={18}/>{t("Reset case drafts")}</button>}
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby="case-draft-clear-title" aria-describedby="case-draft-clear-impact" onKeyDown={keepDialogFocus} onClose={()=>{clearIntent.current=null;(clearTrigger.current?.isConnected?clearTrigger.current:resolveSummary.current)?.focus();}}><h2 id="case-draft-clear-title">{t("Reset unsaved case drafts?")}</h2><p id="case-draft-clear-impact">{t("This restores the last loaded notes and owner on this screen. It does not cancel a pending action or delete a saved resolution.")}</p><div className="actions"><button className="button outline" autoFocus onClick={()=>dialog.current?.close()}>{t("Cancel")}</button><button className="button danger" onClick={()=>{if(current()&&!inFlight.current&&latest.current.draft===clearIntent.current){setDraft({notes:resolutionNotes(data.notes),notesBase:resolutionNotes(data.notes),owner:data.owner_staff_id||'',ownerBase:data.owner_staff_id||''});setResolution('');}dialog.current?.close();}}>{t("Reset drafts")}</button></div></dialog>
  </>;
}
