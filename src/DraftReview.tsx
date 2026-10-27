import {type WorkerLocaleCode} from '../server/languages.mjs';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Pencil,RefreshCw,Save,X,TriangleAlert} from 'lucide-react';
import {readPendingReview,savePendingReview,clearPendingReview,pendingReviewContent,checkedReviewResult,type PendingReview,type TranslationEdits} from './review-recovery';
import {sameReview} from '../server/briefing-input.mjs';
import {translationEdits} from '../server/translation-input.mjs';
import {useBriefingRequest,BriefingRequestError} from './BriefingControls';
import type {StaffRequestAuthority} from './useStaffRequest';
import {retainStaffRequest} from './staff-request';
type Review={revision:number;question:string;facts:string[];askedFacts:string[];translations?:TranslationEdits};
type Prepared={question:string;facts:string[];rubric?:{askedFacts:string[]}};
type TranslationTarget={code:Exclude<WorkerLocaleCode,'en'>;name:string;dir:'ltr'|'rtl';title:string;text:string;question:string};
class ReviewError extends Error {constructor(message:string,public uncertain=false){super(message);}}
const lines=(text:string)=>text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
export function useReviewRecovery(scope?:string|null) {
  return useState(()=>{try {return {pending:scope ? readPendingReview(sessionStorage,scope) : null,error:''};}catch(reason) {return {pending:null,error:(reason as Error).message};}});
}
export function DraftReviewRecovery({pending,scope,onResolved,authority}:{pending:PendingReview;scope:string;onResolved:(id:string)=>void;authority:StaffRequestAuthority}) {
  const {request,current:sessionCurrent,complete}=useBriefingRequest(authority);
  const [busy,setBusy]=useState(false),[checked,setChecked]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const sending=useRef(false),heading=useRef<HTMLHeadingElement>(null),resolved=useRef(onResolved);resolved.current=onResolved;
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setChecked(false);setError('');
    request<any>(`/briefing-review/receipts/${pending.requestId}`,'GET',undefined,controller.signal).then(value=>complete(value,async input=>{
      const value=input as any;
      if(value?.found===true) {
        checkedReviewResult(value,pending);
        if(value.contentExpired===true){
          const verified=await request<any>(`/briefing-review/receipts/${pending.requestId}/verify`,'POST',pending.body,controller.signal);
          checkedReviewResult(verified,pending);
          if(verified.found!==true || verified.matches!==true)throw new Error('Expired review receipt could not be verified.');
        }else if(value.id!==pending.briefingId || !value.request || !sameReview(value.request,pendingReviewContent(pending))) throw new Error('Saved receipt does not match this pending review request.');
        return value.id as string;
      } else if(value?.found===false)return null;else throw new Error('Review receipt response cannot be verified.');
    },id=>{if(controller.signal.aborted)return;if(id){clearPendingReview(sessionStorage,scope,pending.requestId);resolved.current(id);}else setChecked(true);} ))
      .catch(reason=>{if(!controller.signal.aborted && sessionCurrent())setError(reason.message);}).finally(()=>{if(!controller.signal.aborted && sessionCurrent())setBusy(false);});
    return ()=>controller.abort();
  },[refresh,pending,scope,request,sessionCurrent,complete]);
  async function retry() {
    if(sending.current || busy || !checked || !sessionCurrent()) return;sending.current=true;setBusy(true);setError('');
    try {
      savePendingReview(sessionStorage,scope,pending);
      const value=await request(`/briefings/${encodeURIComponent(pending.briefingId)}/review`,'POST',{...pending.body,requestId:pending.requestId});
      await complete(value,value=>checkedReviewResult(value,pending),result=>{clearPendingReview(sessionStorage,scope,pending.requestId);resolved.current(result.id);});
    } catch(reason) {if(sessionCurrent())setError((reason as Error).message);}
    finally {sending.current=false;if(sessionCurrent())setBusy(false);}
  }
  return <><h1 ref={heading} tabIndex={-1}>Recover draft review</h1><section className="panel"><h2>Review for source revision {pending.body.revision}</h2><p>{pending.body.question || 'Automatic question'}</p><p>{busy ? 'Checking saved review...' : checked ? 'No saved receipt was found. You can retry the original confirmed review.' : 'The pending review has not been resolved.'}</p>{error && <p role="alert" className="record-error">{error}</p>}<div className="actions"><button className="button outline" disabled={busy} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={18}/>Check saved review</button>{checked && <button className="button primary" disabled={busy} onClick={()=>void retry()}><Save size={18}/>Retry original review</button>}</div></section></>;
}
export function DraftReview({id,revision,review,prepared,canWrite,scope,disabled,failed,onChanged,onEditingChange,target,authority}:{id:string;revision:number;review:Review|null;prepared:Prepared|null;canWrite:boolean;scope?:string|null;disabled:boolean;failed:boolean;onChanged:()=>void;onEditingChange:(value:boolean)=>void;target?:TranslationTarget;authority:StaffRequestAuthority}) {
  const {request,current,complete}=useBriefingRequest(authority);
  const [editing,setEditing]=useState(false),[question,setQuestion]=useState(''),[facts,setFacts]=useState(''),[asked,setAsked]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
  const [translated,setTranslated]=useState({title:'',text:'',question:''}),[automatic,setAutomatic]=useState(false);
  const sending=useRef(false),pending=useRef<{key:string;id:string}|null>(null),locked=busy || uncertain;
  const trigger=useRef<HTMLButtonElement>(null),focusBack=useRef(false);
  const translations:TranslationEdits={...review?.translations};
  if(target) {if(automatic) delete translations[target.code];else translations[target.code]=translated;}
  let validTranslation=true;try {translationEdits(translations);}catch {validTranslation=false;}
  const factValues=lines(facts),askedValues=lines(asked),valid=validTranslation && factValues.length<=12 && askedValues.length<=6 && [...factValues,...askedValues].every(value=>value.length<=500) && new Set(factValues).size===factValues.length && new Set(askedValues).size===askedValues.length;
  useEffect(()=>{if(!editing && focusBack.current) {trigger.current?.focus();focusBack.current=false;}},[editing]);
  function open() {
    setQuestion(review?.question || '');setFacts(review?.facts.join('\n') || '');setAsked(review?.askedFacts.join('\n') || '');setError('');setConfirmed(false);setEditing(true);onEditingChange(true);
    if(target) {setTranslated(review?.translations?.[target.code] || {title:target.title,text:target.text,question:target.question});setAutomatic(false);}
  }
  async function submit(event:FormEvent) {
    event.preventDefault();if(sending.current || !confirmed || !valid || !current()) return;
    const body={revision,question:question.trim(),facts:lines(facts),askedFacts:lines(asked),...(Object.keys(translations).length ? {translations} : {}),confirmed:true},key=JSON.stringify(body);
    if(pending.current?.key!==key) pending.current={key,id:crypto.randomUUID()};
    sending.current=true;setBusy(true);setError('');let sent=false;
    try {
      if(!scope) throw new ReviewError('Review recovery scope is unavailable. Sign in again before saving.');
      savePendingReview(sessionStorage,scope,{requestId:pending.current.id,briefingId:id,body:{...body,confirmed:true}});sent=true;
      const submitted={requestId:pending.current.id,briefingId:id,body:{...body,confirmed:true as const}};
      const result=await request(`/briefings/${encodeURIComponent(id)}/review`,'POST',{...body,requestId:submitted.requestId});
      await complete(result,value=>checkedReviewResult(value,submitted),()=>{clearPendingReview(sessionStorage,scope,submitted.requestId);pending.current=null;setUncertain(false);setEditing(false);onEditingChange(false);onChanged();});
    } catch(reason) {
      if(!current())return;
      let unknown=retainStaffRequest(uncertain,sent,reason instanceof BriefingRequestError?reason:null);
      if(sent && !unknown && scope) {try {clearPendingReview(sessionStorage,scope,pending.current!.id);}catch {unknown=true;}}
      setUncertain(unknown);setError((reason as Error).message);
    }
    finally {sending.current=false;if(current())setBusy(false);}
  }
  return <div className="draft-review">
    {!target && (prepared ? <><p className="question">{prepared.question}</p><strong className="small-heading">Key facts</strong><ul>{prepared.facts.map((fact,index)=><li key={index}>{fact}</li>)}</ul>{canWrite && <details><summary>Private answer rubric</summary><ul>{prepared.rubric?.askedFacts.map((fact,index)=><li key={index}>{fact}</li>)}</ul></details>}</> : <p>No current prepared question or translations.</p>)}
    {failed && <p role="alert" className="record-error">The processor could not prepare this revision. It is not ready for publication.</p>}
    {!target && review && !editing && <details><summary>Saved review inputs · revision {review.revision}</summary><strong className="small-heading">Requested question</strong><p>{review.question || 'Automatic question'}</p><strong className="small-heading">Requested key facts</strong>{review.facts.length ? <ul>{review.facts.map((fact,index)=><li key={index}>{fact}</li>)}</ul> : <p>Automatic key facts</p>}{canWrite && <><strong className="small-heading">Private requested asked facts</strong>{review.askedFacts.length ? <ul>{review.askedFacts.map((fact,index)=><li key={index}>{fact}</li>)}</ul> : <p>Automatic asked facts</p>}</>}</details>}
    {canWrite && (editing ? <form onSubmit={event=>void submit(event)}>
      {target ? <>
        <label className="recipient-row"><input type="checkbox" checked={automatic} disabled={locked} onChange={event=>{setAutomatic(event.target.checked);setConfirmed(false);}}/><span>Use automatic {target.name} translation</span></label>
        {!automatic && (['title','text','question'] as const).map(field=><label className="field" key={field}>{target.name} {field==='text' ? 'instruction' : field}<textarea lang={target.code} dir={target.dir} rows={field==='text' ? 5 : 2} maxLength={{title:120,text:5000,question:500}[field]} disabled={locked} value={translated[field]} onChange={event=>{setTranslated(value=>({...value,[field]:event.target.value}));setConfirmed(false);}}/></label>)}
      </> : <>
      <label className="field">Question override (optional)<textarea rows={3} maxLength={500} disabled={locked} value={question} onChange={event=>{setQuestion(event.target.value);setConfirmed(false);}}/></label>
      <label className="field">Key facts override (optional)<textarea rows={4} maxLength={6011} disabled={locked} value={facts} onChange={event=>{setFacts(event.target.value);setConfirmed(false);}}/></label>
      <label className="field">Private asked facts override (optional)<textarea rows={3} maxLength={3005} disabled={locked} value={asked} onChange={event=>{setAsked(event.target.value);setConfirmed(false);}}/></label>
      </>}
      <div className="notice notice-blue"><TriangleAlert size={20}/><span>{target ? 'Saving creates a new draft revision. Automatic checks run against the source and glossary before new audio is generated from the exact edited text. Published versions and answers stay unchanged.' : 'Saving creates a new draft revision and regenerates dependent content. Published versions and answers stay unchanged. Blank overrides use automatic preparation. The local processor supports only the synthetic shelf example.'}</span></div>
      <label className="recipient-row publish-confirm"><input type="checkbox" checked={confirmed} disabled={locked} onChange={event=>setConfirmed(event.target.checked)}/><span>Save these review inputs and regenerate this draft</span></label>
      {!valid && <p role="alert" className="record-error">{target ? 'Provide a title, instruction and question in the selected language within the character limits.' : 'Use distinct facts: 12 key facts, 6 asked facts, 500 characters per fact.'}</p>}
      {error && <p role="alert" className="record-error">{error}</p>}<div className="actions"><button className="button primary" disabled={busy || !confirmed || !valid}><Save size={18}/>{busy ? 'Saving...' : uncertain ? 'Retry unchanged review' : 'Save and regenerate'}</button><button type="button" className="button outline" disabled={locked} onClick={()=>{focusBack.current=true;setEditing(false);onEditingChange(false);}}><X size={18}/>Cancel</button></div>
    </form> : <div className="actions"><button ref={trigger} className="button outline" disabled={disabled} onClick={open}><Pencil size={18}/>{target ? 'Edit translation (optional)' : 'Edit review'}</button>{!target && <button className="button outline" disabled={disabled} onClick={open}><RefreshCw size={18}/>Regenerate preparation</button>}</div>)}
  </div>;
}
