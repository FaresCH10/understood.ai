import {checkedPresentationChoices} from './presentation-choice-input.mjs';
import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {ensurePresentationSchema} from './presentation-schema.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {workerCredentialSessionValid} from './auth.mjs';
import {entitlementState} from './entitlements.mjs';
import {translatePresentation} from './presentation-choices.mjs';
import {
  presentationRequest,presentationInstructionContent,presentationAnswerContent,
  presentationSourceHash,translatedPresentationContent,presentationArtifact,
} from './presentation-input.mjs';

const PROVIDER=/^[a-z0-9][a-z0-9._-]{1,79}$/i;
const UNAVAILABLE='Presentation unavailable';

function workerAuthority(db,session){
  if(session?.principal_type!=='worker')throw new Error('Forbidden');
  requireWorkerSiteAccess(db,session.org_id,session.site_id);
  if(session.access_mode==='credential' && !workerCredentialSessionValid(db,session))throw new Error('Sign in required');
  if(session.token_hash!==undefined && !db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND org_id=? AND site_id=?
    AND principal_type='worker' AND principal_id=? AND access_mode=? AND revoked_at IS NULL AND expires_at>?`)
    .get(session.token_hash,session.org_id,session.site_id,session.principal_id,session.access_mode,NOW()))throw new Error('Sign in required');
  const worker=db.prepare('SELECT id,language,active FROM workers WHERE id=? AND org_id=? AND site_id=?')
    .get(session.principal_id,session.org_id,session.site_id);
  if(!worker?.active)throw new Error('Forbidden');
  return worker;
}

function loadAssignment(db,session,assignmentId){
  if(typeof assignmentId!=='string' || !assignmentId || assignmentId.length>100)throw new Error(UNAVAILABLE);
  const row=db.prepare(`SELECT a.id,a.org_id,a.site_id,a.worker_id,a.publication_id,a.language,p.version,p.state,p.briefing_id,p.snapshot_json,
    w.language AS approved_language,w.active
    FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
    JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`)
    .get(assignmentId,session.org_id,session.site_id,session.principal_id);
  if(!row?.active)throw new Error(UNAVAILABLE);
  return row;
}

function contentAvailable(db,assignment){
  const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='briefing_content_purges'").get();
  return !table || !db.prepare('SELECT 1 FROM briefing_content_purges WHERE briefing_id=? AND org_id=? AND site_id=?')
    .get(assignment.briefing_id,assignment.org_id,assignment.site_id);
}

function deliveredContent(db,assignment){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='instruction_deliveries'").get())return null;
  const row=db.prepare(`SELECT content_json FROM instruction_deliveries WHERE assignment_id=? AND org_id=? AND site_id=?
    AND worker_id=? AND state='available'`).get(assignment.id,assignment.org_id,assignment.site_id,assignment.worker_id);
  if(!row?.content_json)return null;
  try{const value=JSON.parse(row.content_json);return value && typeof value==='object' ? value : null;}catch{return null;}
}

function sourceFor(db,session,assignment,input){
  const originalLanguage=assignment.language,approvedLanguage=assignment.approved_language;
  if(!contentAvailable(db,assignment))return {state:'unavailable',reason:'content_expired',originalLanguage,approvedLanguage};
  if(input.sourceKind==='instruction'){
    let snapshot;
    try{snapshot=JSON.parse(assignment.snapshot_json);}catch{return {state:'unavailable',reason:'content_unavailable',originalLanguage,approvedLanguage};}
    const original=snapshot?.languages?.[originalLanguage] || deliveredContent(db,assignment);
    let sourceContent;
    try{sourceContent=presentationInstructionContent(original);}catch{return {state:'unavailable',reason:'content_unavailable',originalLanguage,approvedLanguage};}
    let snapshotContent=null;
    if(snapshot?.languages?.[approvedLanguage]){
      try{snapshotContent=presentationInstructionContent(snapshot.languages[approvedLanguage]);}catch{snapshotContent=null;}
    }
    return {originalLanguage,approvedLanguage,sourceContent,snapshotContent,
      sourceHash:presentationSourceHash('instruction',originalLanguage,sourceContent)};
  }
  const attempt=db.prepare(`SELECT t.answer_text,COALESCE(b.presentation_language,?) AS original_language
    FROM attempts t JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id
    LEFT JOIN answer_presentation_bindings b ON b.attempt_id=t.id AND b.org_id=t.org_id
      AND b.site_id=a.site_id AND b.assignment_id=t.assignment_id
    WHERE t.assignment_id=? AND t.org_id=? AND a.site_id=? AND t.submission_id=?`)
    .get(assignment.language,assignment.id,session.org_id,session.site_id,input.sourceId);
  if(!attempt)return {state:'unavailable',reason:'answer_not_ready',originalLanguage,approvedLanguage};
  let sourceContent,answerLanguage=attempt.original_language;
  try{
    const snapshot=JSON.parse(assignment.snapshot_json);
    const choice=snapshot?.rubric?.mode==='multiple-choice'?snapshot.languages?.[assignment.language]?.choices?.find(item=>item.id===attempt.answer_text):null;
    if(choice)answerLanguage=assignment.language;
    sourceContent=presentationAnswerContent({text:choice?.text??attempt.answer_text});
  }catch{return {state:'unavailable',reason:'content_unavailable',originalLanguage,approvedLanguage};}
  return {originalLanguage:answerLanguage,approvedLanguage:assignment.approved_language,sourceContent,snapshotContent:null,
    sourceHash:presentationSourceHash('answer',answerLanguage,sourceContent)};
}

function findByIdentity(db,assignment,input,targetLanguage){
  return db.prepare(`SELECT * FROM presentation_artifacts WHERE assignment_id=? AND source_kind=? AND source_id=? AND target_language=?`)
    .get(assignment.id,input.sourceKind,input.sourceId,targetLanguage);
}
function findById(db,id){return db.prepare('SELECT * FROM presentation_artifacts WHERE id=?').get(id);}
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

function insertReady(db,assignment,input,source,content,provider,live,now){
  const id=randomUUID();
  db.prepare(`INSERT INTO presentation_artifacts(id,org_id,site_id,worker_id,assignment_id,publication_id,publication_version,
    source_kind,source_id,original_language,target_language,source_hash,status,title,text,question,provider,live,error_code,
    lease_token,lease_until,created_at,updated_at,ready_at,choices_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'ready',?,?,?,?,?,NULL,NULL,NULL,?,?,?,?)`)
    .run(id,assignment.org_id,assignment.site_id,assignment.worker_id,assignment.id,assignment.publication_id,
      assignment.version,input.sourceKind,input.sourceId,source.originalLanguage,source.approvedLanguage,source.sourceHash,
      content.title??null,content.text,content.question??null,provider,live?1:0,now,now,now,content.choices?JSON.stringify(content.choices):null);
  return findById(db,id);
}

function auditPresentation(db,session,action,id,now){
  db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)')
    .run(randomUUID(),session.org_id,session.site_id,'worker',session.principal_id,action,id,now);
}

export async function createPresentation(db,session,assignmentId,input,{translator=null,generationAllowed=true}={}){
  const request=presentationRequest(input);
  ensurePresentationSchema(db);
  let pending=null;
  const prepared=transaction(db,()=>{
    workerAuthority(db,session);
    const assignment=loadAssignment(db,session,assignmentId);
    const source=sourceFor(db,session,assignment,request);
    if(source.state)return {response:nonArtifact(source.state,{...source,kind:request.sourceKind,sourceId:request.sourceId},source.reason)};
    source.kind=request.sourceKind;source.sourceId=request.sourceId;
    if(source.originalLanguage===source.approvedLanguage)return {response:nonArtifact('not_required',source,null)};

    const byId=findById(db,request.requestId);
    if(byId){
      if(!matchesSource(byId,assignment,request,source))throw new Error('Presentation request conflict');
      return {response:resultFor(byId,source),choiceSource:source};
    }
    let existing=findByIdentity(db,assignment,request,source.approvedLanguage);
    if(existing){
      if(existing.source_hash!==source.sourceHash || existing.original_language!==source.originalLanguage)
        throw new Error('Presentation source conflict');
      if(existing.status!=='pending' || Date.parse(existing.lease_until||'')>Date.now())return {response:resultFor(existing,source),choiceSource:source};
      if(!entitlementState(db,assignment.org_id).writeAllowed)return {response:nonArtifact('deferred',source,'generation_paused')};
      const token=randomUUID(),now=NOW();
      const claimed=db.prepare(`UPDATE presentation_artifacts SET lease_token=?,lease_until=?,updated_at=?
        WHERE id=? AND status='pending' AND lease_until<=?`).run(token,new Date(Date.now()+120000).toISOString(),now,existing.id,now);
      if(!claimed.changes)return {response:resultFor(findByIdentity(db,assignment,request,source.approvedLanguage),source)};
      pending={row:findById(db,existing.id),source,token};
      return {pending:true};
    }

    if(source.snapshotContent){
      existing=insertReady(db,assignment,request,source,source.snapshotContent,'publication-snapshot-v1',false,NOW());
      return {response:resultFor(existing,source),choiceSource:source};
    }
    if(translator?.capabilities?.textLanguages && !translator.capabilities.textLanguages.includes(source.approvedLanguage))
      return {response:nonArtifact('unavailable',source,'language_capability_unavailable')};
    if(typeof translator?.translate!=='function')return {response:nonArtifact('unavailable',source,'translation_not_enabled')};
    if(generationAllowed!==true || !entitlementState(db,assignment.org_id).writeAllowed)
      return {response:nonArtifact('deferred',source,'generation_paused')};

    const id=request.requestId,token=randomUUID(),now=NOW();
    db.prepare(`INSERT INTO presentation_artifacts(id,org_id,site_id,worker_id,assignment_id,publication_id,publication_version,
      source_kind,source_id,original_language,target_language,source_hash,status,title,text,question,provider,live,error_code,
      lease_token,lease_until,created_at,updated_at,ready_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',NULL,NULL,NULL,NULL,NULL,NULL,?,?,?,?,NULL)`)
      .run(id,assignment.org_id,assignment.site_id,assignment.worker_id,assignment.id,assignment.publication_id,
        assignment.version,request.sourceKind,request.sourceId,source.originalLanguage,source.approvedLanguage,
        source.sourceHash,token,new Date(Date.now()+120000).toISOString(),now,now);
    pending={row:findById(db,id),source,token,assignment};
    return {pending:true};
  });
  if(prepared.response){
    const source=prepared.choiceSource,result=prepared.response;
    if(result.status!=='ready'||!source?.sourceContent.choices||result.presentation.content?.choices)return result;
    let choices=source.snapshotContent?.choices;
    if(!choices){
      if(generationAllowed!==true||!entitlementState(db,session.org_id).writeAllowed)return nonArtifact('deferred',source,'generation_paused');
      if(typeof translator?.translate!=='function')return nonArtifact('unavailable',source,'translation_not_enabled');
      try{choices=(await translatePresentation(translator,'instruction',source.originalLanguage,source.approvedLanguage,source.sourceContent)).content.choices;}
      catch{return nonArtifact('unavailable',source,'translation_invalid');}
    }
    choices=checkedPresentationChoices(choices,source.sourceContent.choices);
    return transaction(db,()=>{
      workerAuthority(db,session);
      const assignment=loadAssignment(db,session,assignmentId),current=sourceFor(db,session,assignment,request);
      if(current.state||current.sourceHash!==source.sourceHash||current.approvedLanguage!==source.approvedLanguage)throw new Error('Presentation source conflict');
      const changed=db.prepare(`UPDATE presentation_artifacts SET choices_json=? WHERE id=? AND status='ready'
        AND choices_json IS NULL AND text NOT IN ('[Deleted]','[Expired]')`).run(JSON.stringify(choices),result.presentation.id).changes;
      if(changed)auditPresentation(db,session,'presentation.choices_added',result.presentation.id,NOW());
      return resultFor(findById(db,result.presentation.id),source);
    });
  }
  if(!pending)throw new Error(UNAVAILABLE);

  const finish=(status,fields,errorCode=null)=>{
    const now=NOW();
    return transaction(db,()=>{
      const changes=db.prepare(`UPDATE presentation_artifacts SET status=?,title=?,text=?,question=?,provider=?,live=?,error_code=?,
        lease_token=NULL,lease_until=NULL,choices_json=?,updated_at=?,ready_at=? WHERE id=? AND status='pending' AND lease_token=?`)
        .run(status,fields.title??null,fields.text??null,fields.question??null,fields.provider??null,
          fields.live===undefined?null:(fields.live?1:0),errorCode,fields.choices?JSON.stringify(fields.choices):null,
          now,status==='ready'?now:null,pending.row.id,pending.token).changes;
      const row=findById(db,pending.row.id);
      if(changes===1)auditPresentation(db,session,status==='ready'?'presentation.ready':'presentation.failed',row.id,now);
      return resultFor(row,pending.source,status==='failed'?errorCode:null);
    });
  };

  let translated;
  try{
    translated=await translatePresentation(translator,request.sourceKind,pending.source.originalLanguage,pending.source.approvedLanguage,pending.source.sourceContent);
  }catch(error){return finish('failed',{},error.code==='translation_invalid'?'translation_invalid':'translation_failed');}
  let content;
  try{
    content=translatedPresentationContent(request.sourceKind,translated?.content,pending.source.approvedLanguage);
  }catch{return finish('failed',{},'translation_invalid');}
  const provider=typeof translated?.provider==='string' && PROVIDER.test(translated.provider)?translated.provider:null;
  if(!provider)return finish('failed',{},'translation_invalid');
  const live=translated?.live===true;
  return finish('ready',{...content,provider,live});
}

export function listPresentations(db,session,assignmentId){
  ensurePresentationSchema(db);
  return transaction(db,()=>{
    workerAuthority(db,session);
    const assignment=loadAssignment(db,session,assignmentId);
    const rows=db.prepare(`SELECT * FROM presentation_artifacts WHERE org_id=? AND site_id=? AND worker_id=? AND assignment_id=?
      ORDER BY created_at,id`).all(session.org_id,session.site_id,session.principal_id,assignment.id);
    return {assignmentId:assignment.id,originalLanguage:assignment.language,approvedLanguage:assignment.approved_language,
      items:rows.map(presentationArtifact)};
  });
}

export function checkedPresentationBinding(db,session,assignmentId,presentationId){
  if(presentationId===null||presentationId===undefined)return null;
  if(typeof presentationId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(presentationId))
    throw new Error('Presentation unavailable');
  const row=db.prepare(`SELECT p.*,w.language AS approved_language FROM presentation_artifacts p
    JOIN assignments a ON a.id=p.assignment_id AND a.org_id=p.org_id AND a.site_id=p.site_id
    JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    WHERE p.id=? AND p.org_id=? AND p.site_id=? AND p.worker_id=? AND p.assignment_id=?`)
    .get(presentationId,session.org_id,session.site_id,session.principal_id,assignmentId);
  if(!row || row.source_kind!=='instruction' || row.status!=='ready' || !row.question)
    throw new Error('Presentation unavailable');
  if(row.target_language!==row.approved_language)throw new Error('Presentation language changed');
  return row;
}

export function recordPresentationBinding(db,attemptId,row,now){
  if(!row)return false;
  db.prepare(`INSERT INTO answer_presentation_bindings(attempt_id,org_id,site_id,assignment_id,presentation_id,
    presentation_language,presented_question,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(attemptId,row.org_id,row.site_id,row.assignment_id,row.id,row.target_language,row.question,now);
  return true;
}
