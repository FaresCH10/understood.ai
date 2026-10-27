import {entitlementSummary} from '../entitlement-model.mjs';
import {queuePresentationJob} from './presentation-jobs.mjs';
import {checkedPresentationChoices} from '../presentation-choice-input.mjs';
import {randomUUID} from 'node:crypto';
import {domainTransaction,domainAudit,requirePrincipal} from './domain.mjs';
import {dispatchAllowed} from './operations-gates.mjs';
import {readEntitlement} from './entitlements.mjs';
import {translatePresentation} from '../presentation-choices.mjs';
import {
  presentationRequest,presentationInstructionContent,presentationAnswerContent,
  presentationSourceHash,translatedPresentationContent,presentationArtifact,
} from '../presentation-input.mjs';

const PROVIDER=/^[a-z0-9][a-z0-9._-]{1,79}$/i;
const UNAVAILABLE='Presentation unavailable';
const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadAssignment(client,session,assignmentId,{lock=false}={}){
  if(typeof assignmentId!=='string' || !assignmentId || assignmentId.length>100)throw new Error(UNAVAILABLE);
  const row=(await client.query(`SELECT a.id,a.org_id,a.site_id,a.worker_id,a.publication_id,a.language,
    p.version,p.state,p.briefing_id,p.snapshot_json,w.language AS approved_language,w.active
    FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
    JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3 AND a.worker_id=$4${lock?' FOR UPDATE OF a':''}`,
  [assignmentId,session.org_id,session.site_id,session.principal_id])).rows[0];
  if(!row?.active)throw new Error(UNAVAILABLE);
  return row;
}

async function contentAvailable(client,assignment){
  return !(await client.query('SELECT 1 FROM briefing_content_purges WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',
    [assignment.briefing_id,assignment.org_id,assignment.site_id])).rows.length;
}

async function sourceFor(client,session,assignment,input){
  const originalLanguage=assignment.language,approvedLanguage=assignment.approved_language;
  if(!await contentAvailable(client,assignment))return {state:'unavailable',reason:'content_expired',originalLanguage,approvedLanguage};
  if(input.sourceKind==='instruction'){
    const snapshot=assignment.snapshot_json;
    const original=snapshot?.languages?.[originalLanguage];
    let sourceContent;
    try{sourceContent=presentationInstructionContent(original);}catch{return {state:'unavailable',reason:'content_unavailable',originalLanguage,approvedLanguage};}
    let snapshotContent=null;
    if(snapshot?.languages?.[approvedLanguage]){
      try{snapshotContent=presentationInstructionContent(snapshot.languages[approvedLanguage]);}catch{snapshotContent=null;}
    }
    return {originalLanguage,approvedLanguage,sourceContent,snapshotContent,
      sourceHash:presentationSourceHash('instruction',originalLanguage,sourceContent)};
  }
  const attempt=(await client.query(`SELECT t.id,t.answer_text,COALESCE(b.presentation_language,a.language) AS original_language
    FROM attempts t JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id
    LEFT JOIN answer_presentation_bindings b ON b.attempt_id=t.id AND b.org_id=t.org_id
      AND b.site_id=a.site_id AND b.assignment_id=t.assignment_id
    WHERE t.assignment_id=$1 AND t.org_id=$2 AND a.site_id=$3 AND t.submission_id=$4`,
  [assignment.id,session.org_id,session.site_id,input.sourceId])).rows[0];
  if(!attempt)return {state:'unavailable',reason:'answer_not_ready',originalLanguage,approvedLanguage};
  const retained=(await client.query("SELECT 1 FROM text_retention_purges WHERE kind='attempt' AND reference_id=$1 AND org_id=$2 AND site_id=$3",
    [attempt.id,session.org_id,session.site_id])).rows.length;
  if(retained)return {state:'unavailable',reason:'content_expired',originalLanguage:attempt.original_language,approvedLanguage};
  let sourceContent,answerLanguage=attempt.original_language;
  try{
    const snapshot=assignment.snapshot_json;
    const choice=snapshot?.rubric?.mode==='multiple-choice'?snapshot.languages?.[assignment.language]?.choices?.find(item=>item.id===attempt.answer_text):null;
    if(choice)answerLanguage=assignment.language;
    sourceContent=presentationAnswerContent({text:choice?.text??attempt.answer_text});
  }catch{return {state:'unavailable',reason:'content_unavailable',originalLanguage,approvedLanguage};}
  return {originalLanguage:answerLanguage,approvedLanguage:assignment.approved_language,sourceContent,snapshotContent:null,
    sourceHash:presentationSourceHash('answer',answerLanguage,sourceContent)};
}

async function findByIdentity(client,assignment,input,targetLanguage){
  return (await client.query(`SELECT * FROM presentation_artifacts
    WHERE assignment_id=$1 AND source_kind=$2 AND source_id=$3 AND target_language=$4`,
  [assignment.id,input.sourceKind,input.sourceId,targetLanguage])).rows[0];
}
async function findById(client,id){
  return (await client.query('SELECT * FROM presentation_artifacts WHERE id=$1',[id])).rows[0];
}
function resultFor(row,source,reason=null){
  return {status:row.status,presentation:presentationArtifact(row),reason,originalLanguage:source.originalLanguage,
    targetLanguage:row.target_language,sourceKind:row.source_kind,sourceId:row.source_id};
}
function nonArtifact(state,source,reason){
  return {status:state,presentation:null,reason,originalLanguage:source.originalLanguage,
    targetLanguage:source.approvedLanguage,sourceKind:source.kind??'',sourceId:source.sourceId??''};
}
function matchesSource(row,assignment,input,source){
  return row.assignment_id===assignment.id && row.source_kind===input.sourceKind && row.source_id===input.sourceId
    && row.original_language===source.originalLanguage && row.source_hash===source.sourceHash
    && row.target_language===source.approvedLanguage;
}

async function insertReady(client,assignment,input,source,content,provider,live){
  const id=randomUUID();
  return (await client.query(`INSERT INTO presentation_artifacts(id,org_id,site_id,worker_id,assignment_id,publication_id,
    publication_version,source_kind,source_id,original_language,target_language,source_hash,status,title,text,question,
    provider,live,error_code,lease_token,lease_until,created_at,updated_at,ready_at,choices_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ready',$13,$14,$15,$16,$17,NULL,NULL,NULL,
      clock_timestamp(),clock_timestamp(),clock_timestamp(),$18) RETURNING *`,
  [id,assignment.org_id,assignment.site_id,assignment.worker_id,assignment.id,assignment.publication_id,
    assignment.version,input.sourceKind,input.sourceId,source.originalLanguage,source.approvedLanguage,source.sourceHash,
    content.title??null,content.text,content.question??null,provider,live,content.choices?JSON.stringify(content.choices):null])).rows[0];
}

export async function createPresentation(pool,session,assignmentId,input,{schema='public',translator=null,generationAllowed=true,queueGeneration=false}={}){
  const request=presentationRequest(input);
  let pending=null;
  const prepared=await domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'worker');
    const assignment=await loadAssignment(client,session,assignmentId,{lock:true});
    const source=await sourceFor(client,session,assignment,request);
    if(source.state)return {response:nonArtifact(source.state,{...source,kind:request.sourceKind,sourceId:request.sourceId},source.reason)};
    source.kind=request.sourceKind;source.sourceId=request.sourceId;
    if(source.originalLanguage===source.approvedLanguage)return {response:nonArtifact('not_required',source,null)};

    const byId=await findById(client,request.requestId);
    if(byId){
      if(!matchesSource(byId,assignment,request,source))throw new Error('Presentation request conflict');
      if(byId.status!=='pending'||byId.lease_until?.getTime()>Date.now()||queueGeneration)return {response:resultFor(byId,source),choiceSource:source};
    }
    let existing=await findByIdentity(client,assignment,request,source.approvedLanguage);
    if(existing){
      if(existing.source_hash!==source.sourceHash || existing.original_language!==source.originalLanguage)
        throw new Error('Presentation source conflict');
      if(existing.status!=='pending' || (existing.lease_until && existing.lease_until.getTime()>Date.now()))
        return {response:resultFor(existing,source),choiceSource:source};
      if(!entitlementSummary(await readEntitlement(client,assignment.org_id)).writeAllowed)
        return {response:nonArtifact('deferred',source,'generation_paused')};
      const token=randomUUID();
      const claimed=(await client.query(`UPDATE presentation_artifacts SET lease_token=$2,
        lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
        WHERE id=$1 AND status='pending' AND lease_until<=clock_timestamp() RETURNING id`,[existing.id,token])).rows[0];
      if(!claimed)return {response:resultFor(await findByIdentity(client,assignment,request,source.approvedLanguage),source)};
      pending={id:existing.id,source,token};
      return {pending:true};
    }

    if(source.snapshotContent){
      existing=await insertReady(client,assignment,request,source,source.snapshotContent,'publication-snapshot-v1',false);
      return {response:resultFor(existing,source),choiceSource:source};
    }
    if(translator?.capabilities?.textLanguages && !translator.capabilities.textLanguages.includes(source.approvedLanguage))
      return {response:nonArtifact('unavailable',source,'language_capability_unavailable')};
    if(typeof translator?.translate!=='function'&&!queueGeneration)return {response:nonArtifact('unavailable',source,'translation_not_enabled')};
    if(generationAllowed!==true || !entitlementSummary(await readEntitlement(client,assignment.org_id)).writeAllowed)
      return {response:nonArtifact('deferred',source,'generation_paused')};
    if(!await dispatchAllowed(client,session.org_id,{provider:true}))
      return {response:nonArtifact('deferred',source,'generation_paused')};

    const token=randomUUID();
    await client.query(`INSERT INTO presentation_artifacts(id,org_id,site_id,worker_id,assignment_id,publication_id,
      publication_version,source_kind,source_id,original_language,target_language,source_hash,status,title,text,question,
      provider,live,error_code,lease_token,lease_until,created_at,updated_at,ready_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',NULL,NULL,NULL,NULL,NULL,NULL,$13,
        clock_timestamp()+$14*interval '1 second',clock_timestamp(),clock_timestamp(),NULL)`,
    [request.requestId,assignment.org_id,assignment.site_id,assignment.worker_id,assignment.id,assignment.publication_id,
      assignment.version,request.sourceKind,request.sourceId,source.originalLanguage,source.approvedLanguage,
      source.sourceHash,token,queueGeneration?0:120]);
    pending={id:request.requestId,source,token};
    return {pending:true};
  });
  if(prepared.response){
    if(queueGeneration&&prepared.response.presentation&&(prepared.response.status==='pending'||prepared.response.status==='ready'&&prepared.choiceSource?.sourceContent.choices&&!prepared.response.presentation.content?.choices)){await domainTransaction(pool,schema,client=>queuePresentationJob(client,prepared.response.presentation.id,session));return prepared.response;}
    const source=prepared.choiceSource,result=prepared.response;
    if(result.status!=='ready'||!source?.sourceContent.choices||result.presentation.content?.choices)return result;
    const allowed=await domainTransaction(pool,schema,async client=>{
      await requirePrincipal(client,session,'worker');
      return entitlementSummary(await readEntitlement(client,session.org_id)).writeAllowed && await dispatchAllowed(client,session.org_id,{provider:true});
    });
    let choices=source.snapshotContent?.choices;
    if(!choices){
      if(generationAllowed!==true||!allowed)return nonArtifact('deferred',source,'generation_paused');
      if(typeof translator?.translate!=='function')return nonArtifact('unavailable',source,'translation_not_enabled');
      try{choices=(await translatePresentation(translator,'instruction',source.originalLanguage,source.approvedLanguage,source.sourceContent)).content.choices;}
      catch(error){if(error.code==='presentation_deferred')throw error;return nonArtifact('unavailable',source,'translation_invalid');}
    }
    choices=checkedPresentationChoices(choices,source.sourceContent.choices);
    return domainTransaction(pool,schema,async client=>{
      await requirePrincipal(client,session,'worker');
      const assignment=await loadAssignment(client,session,assignmentId,{lock:true}),current=await sourceFor(client,session,assignment,request);
      if(current.state||current.sourceHash!==source.sourceHash||current.approvedLanguage!==source.approvedLanguage)throw new Error('Presentation source conflict');
      const updated=(await client.query(`UPDATE presentation_artifacts SET choices_json=$2 WHERE id=$1 AND status='ready'
        AND choices_json IS NULL AND text NOT IN ('[Deleted]','[Expired]') RETURNING id`,[result.presentation.id,JSON.stringify(choices)])).rows[0];
      if(updated)await domainAudit(client,session,'presentation.choices_added',result.presentation.id);
      return resultFor(await findById(client,result.presentation.id),source);
    });
  }
  if(!pending)throw new Error(UNAVAILABLE);
  if(queueGeneration)return domainTransaction(pool,schema,async client=>{await queuePresentationJob(client,pending.id,session);return resultFor(await findById(client,pending.id),pending.source);});

  const finish=(status,fields,errorCode=null)=>domainTransaction(pool,schema,async client=>{
    if(status==='ready'){await requirePrincipal(client,session,'worker');const assignment=await loadAssignment(client,session,assignmentId),current=await sourceFor(client,session,assignment,request);if(current.state||current.sourceHash!==pending.source.sourceHash||current.approvedLanguage!==pending.source.approvedLanguage){status='failed';fields={};errorCode='presentation_source_changed';}}
    const row=(await client.query(`UPDATE presentation_artifacts SET status=$2,title=$3,text=$4,question=$5,provider=$6,
      live=$7,error_code=$8,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp(),
      choices_json=$10,ready_at=CASE WHEN $2='ready' THEN clock_timestamp() ELSE NULL END
      WHERE id=$1 AND status='pending' AND lease_token=$9 RETURNING *`,
    [pending.id,status,fields.title??null,fields.text??null,fields.question??null,fields.provider??null,
      fields.live===undefined?null:fields.live===true,errorCode,pending.token,fields.choices?JSON.stringify(fields.choices):null])).rows[0];
    if(row)await domainAudit(client,session,status==='ready'?'presentation.ready':'presentation.failed',row.id);
    const current=row ?? await findById(client,pending.id);
    if(!current)throw new Error(UNAVAILABLE);
    return resultFor(current,pending.source,current.status==='failed'?current.error_code:null);
  });

  let translated;
  try{
    translated=await translatePresentation(translator,request.sourceKind,pending.source.originalLanguage,pending.source.approvedLanguage,pending.source.sourceContent);
  }catch(error){if(error.code==='presentation_deferred'){await domainTransaction(pool,schema,client=>client.query("UPDATE presentation_artifacts SET lease_until=clock_timestamp() WHERE id=$1 AND status='pending' AND lease_token=$2",[pending.id,pending.token]));throw error;}return finish('failed',{},error.code==='translation_invalid'?'translation_invalid':'translation_failed');}
  let content;
  try{
    content=translatedPresentationContent(request.sourceKind,translated?.content,pending.source.approvedLanguage);
  }catch{return finish('failed',{},'translation_invalid');}
  const provider=typeof translated?.provider==='string' && PROVIDER.test(translated.provider)?translated.provider:null;
  if(!provider)return finish('failed',{},'translation_invalid');
  const live=translated?.live===true;
  return finish('ready',{...content,provider,live});
}

export async function listPresentations(pool,session,assignmentId,{schema='public'}={}){
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'worker');
    const assignment=await loadAssignment(client,session,assignmentId);
    const rows=(await client.query(`SELECT * FROM presentation_artifacts
      WHERE org_id=$1 AND site_id=$2 AND worker_id=$3 AND assignment_id=$4 ORDER BY created_at,id`,
    [session.org_id,session.site_id,session.principal_id,assignment.id])).rows;
    return {assignmentId:assignment.id,originalLanguage:assignment.language,approvedLanguage:assignment.approved_language,
      items:rows.map(presentationArtifact)};
  });
}

export async function checkedPresentationBinding(client,session,assignmentId,presentationId){
  if(presentationId===null||presentationId===undefined)return null;
  if(typeof presentationId!=='string' || !UUID_V4.test(presentationId))throw new Error(UNAVAILABLE);
  const row=(await client.query(`SELECT p.*,w.language AS approved_language FROM presentation_artifacts p
    JOIN assignments a ON a.id=p.assignment_id AND a.org_id=p.org_id AND a.site_id=p.site_id
    JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    WHERE p.id=$1 AND p.org_id=$2 AND p.site_id=$3 AND p.worker_id=$4 AND p.assignment_id=$5`,
  [presentationId,session.org_id,session.site_id,session.principal_id,assignmentId])).rows[0];
  if(!row || row.source_kind!=='instruction' || row.status!=='ready' || !row.question)
    throw new Error(UNAVAILABLE);
  if(row.target_language!==row.approved_language)throw new Error('Presentation language changed');
  return row;
}

export async function recordPresentationBinding(client,attemptId,row){
  if(!row)return false;
  await client.query(`INSERT INTO answer_presentation_bindings(attempt_id,org_id,site_id,assignment_id,presentation_id,
    presentation_language,presented_question) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [attemptId,row.org_id,row.site_id,row.assignment_id,row.id,row.target_language,row.question]);
  return true;
}
