import {useStaffText as useStaffStaticText} from './staff-language';
import {useRef,useState} from 'react';
import {Activity,ChevronLeft,ChevronRight,RefreshCw} from 'lucide-react';
import {useArtifactRead} from './useArtifactRead';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {checkedProviderHistory,type ProviderHistory} from './processing-provenance';
import type {ProcessingJob} from './processing-state';
import {staffRequestBinding} from './staff-request';
const labels:Record<string,string>={'preparation':'Preparation','source-transcription':'Source transcription','recording-transcription':'Voice transcription','recording-assessment':'Voice answer check','typed-assessment':'Typed answer check'};
const states:Record<string,string>={started:'Unfinished receipt',accepted:'HTTP accepted',rejected:'HTTP rejected',uncertain:'Outcome unknown'};
export function ProcessingProvenance({authority,job,refresh}:{authority:StaffRequestAuthority;job:ProcessingJob;refresh:number}){
  const staffT=useStaffStaticText();
  const {current}=useStaffRequest(authority),[page,setPage]=useState(1),[tick,setTick]=useState(0);
  const read=useArtifactRead<unknown>(authority,`/api/processing/${encodeURIComponent(job.id)}/provenance?page=${page}&pageSize=10`,refresh+tick);
  const selection=JSON.stringify([staffRequestBinding(authority.session),job.id,job.kind,job.publication_id,job.publication_version,job.assignment_id,page,10]);
  const verified=useRef<{selection:string;data:ProviderHistory}|null>(null);
  let data:ProviderHistory|null=null,error=read.error;
  if(read.data)try{data=checkedProviderHistory(read.data,job,page);verified.current={selection,data};}catch(reason){error=(reason as Error).message;}
  else if(read.loading && current() && verified.current?.selection===selection)data=verified.current.data;
  if(error || !current()){verified.current=null;data=null;}
  const pages=Math.max(1,Math.ceil((data?.total || 0)/10)),change=(next:number)=>{if(current())setPage(next);};
  return <section className="panel processing-provider-history" aria-label={staffT("Provider request history")}><div className="people-panel-heading"><h2><Activity size={19}/> {staffT("Provider request history")}</h2>
    <button className="icon-button" title={staffT("Refresh provider history")} aria-label={staffT("Refresh provider history")} disabled={read.loading} onClick={()=>{if(current())setTick(value=>value+1);}}><RefreshCw size={18}/></button></div>
    {read.loading && data && <p className="muted" role="status">{staffT("Refreshing provider history...")}</p>}
    {read.loading && !data?<p role="status">{staffT("Loading provider history...")}</p>:error?<p role="alert">{staffT.error(error)}</p>:(data&&<>
      {!data.supported?<p>{staffT("No provider journal is available on this backend.")}</p>:!data.items.length?<p>{(page>pages?staffT("This page is no longer available."):staffT("No provider operation was recorded for this job."))}</p>:data.items.map(operation=><section key={operation.id} className="processing-provider-operation" aria-label={staffT("{p0} operation {p1}",{p0:staffT(labels[operation.kind]),p1:operation.id})}>
        <div className="processing-provider-heading"><h3>{staffT(labels[operation.kind])}{operation.stage?` · ${staffT.technical(operation.stage.name)}`:''}</h3><span className={`status status-${operation.currentRun?'amber':'blue'}`}>{(operation.currentRun?staffT("Current claim"):staffT("Historical claim"))}</span></div>
        <dl className="processing-details"><dt>{staffT("Operation")}</dt><dd>{operation.id}</dd><dt>{staffT("Run")}</dt><dd>{operation.runId}</dd><dt>{staffT("Reserved")}</dt><dd>{operation.reservedRequests} {staffT("requests ·")} {operation.requests.length} {staffT("recorded")}</dd><dt>{staffT("Model")}</dt><dd>{operation.model}</dd><dt>{staffT("Started")}</dt><dd><time dateTime={operation.startedAt}>{staffT.date(operation.startedAt)}</time></dd><dt>{staffT("Data class")}</dt><dd>{staffT("Synthetic")}</dd>
          {operation.provenance?<><dt>{staffT("Adapter")}</dt><dd>{operation.provenance.adapter}</dd><dt>{staffT("Prompt version")}</dt><dd>{operation.provenance.promptVersion}</dd><dt>{staffT("Schema version")}</dt><dd>{operation.provenance.schemaVersion}</dd></>:<><dt>{staffT("Input provenance")}</dt><dd>{staffT("Not recorded")}</dd></>}
          {operation.stage && <><dt>{staffT("Language")}</dt><dd>{operation.stage.language.toUpperCase()}{operation.stage.track?` · ${staffT.technical(operation.stage.track)}`:''}</dd></>}
          <dt>{staffT("Result reference")}</dt><dd>{(operation.resultReference?staffT("{p0}{p1} reference recorded",{p0:operation.resultReference[0].toUpperCase(),p1:operation.resultReference.slice(1)}):staffT("No result reference recorded"))}</dd>
        </dl>{operation.requests.length?<div className="table-wrap" tabIndex={0} aria-label={staffT("Request receipts for operation {p0}",{p0:operation.id})}><table><thead><tr><th>{staffT("Request")}</th><th>{staffT("Receipt")}</th><th>{staffT("HTTP")}</th><th>{staffT("Finished")}</th></tr></thead><tbody>{operation.requests.map(request=><tr key={request.sequence}><td>{request.sequence}{(request.cleanup?staffT(" · Cleanup"):'')}</td><td>{staffT(states[request.state])}</td><td>{request.httpStatus ?? '-'}</td><td>{(request.finishedAt?<time dateTime={request.finishedAt}>{staffT.date(request.finishedAt)}</time>:staffT("Not recorded"))}</td></tr>)}</tbody></table></div>:<p>{staffT("No request receipt was recorded for this reservation.")}</p>}
      </section>)}
      {data.supported && <div className="audit-pagination"><span>{staffT("Page")} {staffT.number(page)} {staffT("of")} {staffT.number(pages)} · {staffT.number(data.total)} {staffT("operations")}</span><div className="actions"><button className="icon-button" title={staffT("Previous provider page")} aria-label={staffT("Previous provider page")} disabled={page<=1} onClick={()=>change(page-1)}><ChevronLeft size={18}/></button><button className="icon-button" title={staffT("Next provider page")} aria-label={staffT("Next provider page")} disabled={page>=pages} onClick={()=>change(page+1)}><ChevronRight size={18}/></button>{page>pages && <button className="button outline" onClick={()=>change(1)}>{staffT("First page")}</button>}</div></div>}
    </>)}
    <p className="muted">{staffT("HTTP acceptance does not prove that content was valid, understood, or safe to act on.")}</p>
  </section>;
}
