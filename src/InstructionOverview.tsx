import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useState,type FormEvent} from 'react';
import {ArrowRight,MessageCircle,RefreshCw} from 'lucide-react';
import {usePublicationDetail} from './PublicationHistory';
import type {PublicationSummary} from './publication-history';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {workerLocale} from '../server/languages.mjs';

type Draft={id:string;source:string;state:string;next_version:number;revision:number;competency_validity_days?:number|null;contentExpired?:boolean;archive?:unknown};
type Props={draft:Draft;publication:PublicationSummary|null;context:string;refresh:number;onResponses:()=>void;onLanguages:()=>void;canWrite:boolean;authority:StaffRequestAuthority;onChanged:()=>void};
export function InstructionOverview({draft,publication,context,refresh,onResponses,onLanguages,canWrite,authority,onChanged}:Props){
  const staffT=useStaffStaticText();
  const [tick,setTick]=useState(0);
  const read=usePublicationDetail(draft.id,!draft.contentExpired?publication?.id||null:null,context,refresh+tick);
  const snapshot=read.data?.snapshot,metrics=read.data?.metrics;
  const source=publication?(typeof snapshot?.source==='string'?snapshot.source:''):draft.source;
  const question=typeof snapshot?.question==='string'?snapshot.question:'';
  const facts=Array.isArray(snapshot?.facts)?snapshot.facts.filter((value):value is string=>typeof value==='string'):[];
  const languages=Object.entries(snapshot?.languages||{}).filter(([,value])=>typeof value?.text==='string'&&value.text.trim()).map(([code])=>code);
  return <div className="instruction-overview-grid"><section className="panel instruction-content-panel">
    <div className="instruction-section-heading"><h2>{publication?staffT("Published instruction"):staffT("Instruction draft")}</h2><span className="instruction-version-label">{staffT("Version {p0}",{p0:publication?.version??draft.next_version})}</span></div>
    {(publication&&<p className="instruction-section-note">{staffT("Sent")} {staffT.date(publication.published_at)}{staffT(". This is the saved text for this version.")}</p>)}
    {draft.contentExpired?<p>{staffT("Instruction content is no longer retained. Version and response records remain in History.")}</p>:publication&&read.loading?<p data-page-loading role="status">{staffT("Loading the published instruction...")}</p>:publication&&read.error?<div><p role="alert">{staffT("The published instruction could not be loaded.")}</p><button className="button outline" onClick={()=>setTick(n=>n+1)}><RefreshCw size={17}/>{staffT("Try again")}</button></div>:<>
      {source?<p className="instruction-body-text">{source}</p>:<p>{staffT("No instruction text is stored for this version.")}</p>}
      {!publication&&<p className="instruction-section-note">{staffT("This draft has not been sent to workers. Prepare it before publishing.")}</p>}
      {snapshot?.responseMode==='acknowledge'?<div className="instruction-question"><h3>{staffT("Worker confirmation")}</h3><p>{staffT("Workers confirm they have read or listened to this instruction. No question is asked.")}</p></div>:question&&<div className="instruction-question"><h3>{staffT("Question for workers")}</h3><p>{question}</p>{facts.length>0&&<details className="instruction-secondary-details"><summary>{staffT("Expected key facts")}</summary><ul>{facts.map((fact,index)=><li key={index}>{fact}</li>)}</ul></details>}</div>}
      {languages.length>0&&<div className="instruction-language-summary"><h3>{staffT("Instruction languages")}</h3><div className="instruction-language-list">{languages.map(code=><span key={code}>{staffT.language(code)}</span>)}</div><button className="text-link" onClick={onLanguages}>{staffT("Review translations and audio")}<ArrowRight size={16}/></button></div>}
    </>}
  </section><aside className="instruction-overview-aside">
    <section className="panel instruction-response-summary"><h2>{staffT("Responses")}</h2>{!publication?<p>{staffT("No responses yet. Workers can respond after the instruction is sent.")}</p>:read.loading?<p data-page-loading role="status">{staffT("Loading response summary...")}</p>:metrics?<><div className="instruction-response-total"><strong>{staffT.number(metrics.responses)}<span> / {staffT.number(metrics.assigned)}</span></strong><span>{staffT("workers responded")}</span></div><div className="progress" role="progressbar" aria-label={staffT("Workers responded")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={metrics.completion}><span style={{width:`${metrics.completion}%`}}/></div><dl><div><dt>{staffT("Match key facts")}</dt><dd>{staffT.number(metrics.matches)}</dd></div>{!!metrics.acknowledged&&<div><dt>{staffT("Confirmed receipt")}</dt><dd>{metrics.acknowledged}</dd></div>}<div><dt>{staffT("Need clarification")}</dt><dd className={metrics.clarifications?'instruction-attention':''}>{staffT.number(metrics.clarifications)}</dd></div>{metrics.unassessed>0&&<div><dt>{staffT("Awaiting AI check")}</dt><dd>{staffT.number(metrics.unassessed)}</dd></div>}<div><dt>{staffT("Waiting to respond")}</dt><dd>{staffT.number(metrics.pending)}</dd></div></dl><button className="button outline full" onClick={onResponses}><MessageCircle size={17}/>{staffT("View responses")}</button><p className="instruction-section-note">{staffT("Matching answers reflect the key facts checked, not proof of safe work.")}</p></>:<p>{staffT("Response counts are unavailable. Open Responses to try again.")}</p>}</section>
    <section className="instruction-next-version"><h2>{publication?staffT("Preparing an update?"):staffT("Next step")}</h2><p>{publication?staffT("Changes go into draft v{p0}. The sent instruction and its responses stay unchanged.",{p0:draft.next_version}):staffT("Use Prepare draft to review the text, prepare translations and choose recipients.")}</p></section>
  </aside><CompetencyCertificate briefingId={draft.id} revision={draft.revision} validityDays={draft.competency_validity_days ?? null} canWrite={canWrite && !draft.archive && !draft.contentExpired} authority={authority} onChanged={onChanged}/></div>;
}

function CompetencyCertificate({briefingId,revision,validityDays,canWrite,authority,onChanged}:{briefingId:string;revision:number;validityDays:number|null;canWrite:boolean;authority:StaffRequestAuthority;onChanged:()=>void}) {
  const staffT=useStaffStaticText();
  const {request,current}=useStaffRequest(authority);
  const [value,setValue]=useState(validityDays?String(validityDays):''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  useEffect(()=>{setValue(validityDays?String(validityDays):'');},[validityDays]);
  const days=value.trim()===''?null:Number(value),valid=days===null || (Number.isSafeInteger(days) && days>=1 && days<=3650);
  async function save(event:FormEvent) {
    event.preventDefault();
    if(busy || !valid || !current())return;
    setBusy(true);setError('');setSaved('');
    try {
      await request(`/api/briefings/${encodeURIComponent(briefingId)}/competency`,{revision,validityDays:days});
      if(current()){setSaved(days?staffT("Certificate expiry saved."):staffT("Certificate expiry turned off."));onChanged();}
    } catch(reason) {if(current())setError((reason as Error).message);}
    finally {if(current())setBusy(false);}
  }
  return <section className="panel competency-setting-panel">
    <div className="instruction-section-heading"><h2>{staffT("Competency certificate")}</h2><span className="instruction-version-label">{validityDays?staffT("{p0} days",{p0:staffT.number(validityDays)}):staffT("Not configured")}</span></div>
    <p className="instruction-section-note">{staffT("Workers earn this certificate when their answer matches the key facts. It is not proof of safe work.")}</p>
    {canWrite ? <form onSubmit={event=>void save(event)}>
      <label className="field">{staffT("Certificate validity (days)")}<input type="number" inputMode="numeric" min={1} max={3650} step={1} value={value} placeholder={staffT("Empty turns the certificate off")} disabled={busy} onChange={event=>{setValue(event.target.value);setSaved('');setError('');}}/></label>
      <p className="instruction-section-note">{staffT("The certificate uses the instruction title. Changes apply to versions published after saving; already-sent versions keep their settings.")}</p>
      {!valid && <p role="alert" className="record-error">{staffT("Use a whole number of days from 1 to 3650, or leave empty to turn the certificate off.")}</p>}
      {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
      {saved && <p role="status" className="notice notice-green">{saved}</p>}
      <div className="actions"><button type="submit" className="button primary" disabled={busy || !valid}>{busy?staffT("Saving..."):staffT("Save certificate setting")}</button></div>
    </form> : <p className="competency-readonly">{validityDays?staffT("This instruction awards a certificate valid for {p0} days.",{p0:staffT.number(validityDays)}):staffT("No certificate expiry is configured for new versions.")}</p>}
  </section>;
}
