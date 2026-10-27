import {providerDataClass} from './ai/provider-policy.mjs';
import {checkedPreparationOperation} from './ai/preparation-provenance.mjs';
export const processingOperationKinds={prepare:['preparation'],source_transcription:['source-transcription'],response_transcription:['recording-transcription','recording-assessment'],answer_check:['typed-assessment']};
export function processingProvenanceFilters(input={}){
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['page','pageSize'].includes(key))
    || Object.values(input).some(value=>typeof value!=='number' && (typeof value!=='string' || !/^[1-9][0-9]{0,4}$/.test(value))))throw Error('Invalid provider history page');
  const page=Number(input.page ?? 1),pageSize=Number(input.pageSize ?? 10);
  if(!Number.isSafeInteger(page) || page<1 || page>5000 || !Number.isSafeInteger(pageSize) || pageSize<1 || pageSize>20)throw Error('Invalid provider history page');return {page,pageSize};
}
const slug=value=>typeof value==='string' && /^[a-z0-9-]{1,80}$/.test(value);
const model=value=>typeof value==='string' && /^[a-z0-9][a-z0-9.:/-]{2,79}$/.test(value);
const reference=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const keys=(value,names)=>!!value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===[...names].sort().join(',');
const iso=value=>{const parsed=new Date(value);if(value===null || value===undefined || !Number.isFinite(parsed.getTime()))throw Error('Provider history unavailable');return parsed.toISOString();};
export function processingOperation(row,job){
  if(!processingOperationKinds[job.kind]?.includes(row.kind) || !reference(row.id) || !reference(row.run_id) || !model(row.model) || !['synthetic','real'].includes(row.data_class)
    || !Number.isInteger(row.reserved_requests) || row.reserved_requests<1 || row.reserved_requests>64
    || !Array.isArray(row.requests) || row.requests.length>row.reserved_requests
    || row.result_reference!==null && row.result_reference!==undefined && !(row.kind==='preparation'?['bundle']:['recording-assessment','typed-assessment'].includes(row.kind)?['assessment']:['transcription']).includes(row.result_reference))throw Error('Provider history unavailable');
  const operationStarted=iso(row.created_at),runStarted=iso(row.run_started_at);
  if(runStarted>operationStarted)throw Error('Provider history unavailable');
  const raw=row.provenance_json;
  let attributed=typeof row.input_hash==='string' && /^[a-f0-9]{64}$/.test(row.input_hash) && keys(raw,['adapter','dataClass','model','promptVersion','schemaVersion'])
    && raw.model===row.model && raw.dataClass===row.data_class && providerDataClass(raw) && ['adapter','promptVersion','schemaVersion'].every(key=>slug(raw[key]));
  let stage=null;
  if(row.kind==='preparation' && attributed){
    try{const context=checkedPreparationOperation(row.preparation_context_json,raw,{orgId:job.org_id,referenceId:job.id,claimToken:row.claim_token,model:row.model,inputHash:row.input_hash});
      if(context.siteId!==job.site_id || context.briefingId!==job.briefing_id || context.revision!==job.revision)throw Error();
      stage={step:context.step,name:context.stage,language:context.language,track:context.track};
    }catch{attributed=false;}
  }
  const requests=row.requests.map((request,index)=>{
    if(request.sequence!==index+1 || typeof request.cleanup!=='boolean' || !['started','accepted','rejected','uncertain'].includes(request.state)
      || request.state==='started' && (request.http_status!==null || request.finished_at!==null)
      || request.state==='uncertain' && (request.http_status!==null || request.finished_at===null)
      || ['accepted','rejected'].includes(request.state) && (!Number.isInteger(request.http_status) || request.http_status<100 || request.http_status>599 || request.finished_at===null
        || (request.state==='accepted')!==(request.http_status>=200 && request.http_status<300)))throw Error('Provider history unavailable');
    const startedAt=iso(request.created_at),finishedAt=request.finished_at===null?null:iso(request.finished_at);
    if(startedAt<operationStarted || finishedAt && finishedAt<startedAt)throw Error('Provider history unavailable');
    return {sequence:request.sequence,cleanup:request.cleanup,state:request.state,httpStatus:request.http_status,startedAt,finishedAt};
  });
  return {id:row.id,kind:row.kind,model:row.model,dataClass:row.data_class,reservedRequests:row.reserved_requests,
    startedAt:operationStarted,runId:row.run_id,runStartedAt:runStarted,currentRun:row.current_run===true,
    provenance:attributed?{adapter:raw.adapter,promptVersion:raw.promptVersion,schemaVersion:raw.schemaVersion}:null,
    stage,resultReference:row.result_reference ?? null,requests};
}
export function processingProvenancePage(job,{page,pageSize},total,items,supported=true){
  return {jobId:job.id,kind:job.kind,publicationId:job.publication_id,publicationVersion:job.publication_version,assignmentId:job.assignment_id,supported,items,total,page,pageSize};
}
