import {briefingLanguageRequestCheck,generationLanguageCheck,guardBriefingLanguageRequest,guardGenerationLanguages} from './generation-language-schema.mjs';
import { randomUUID,createHash } from 'node:crypto';
import { NOW,transaction } from './db.mjs';
import { draftInput,expectedRevision,copyDraftInput,checkDraftCopyReplay,archiveBriefingInput } from './briefing-input.mjs';
import {ensureDraftReviewSchema} from './draft-review.mjs';
import {ensureGlossarySchema} from './glossary.mjs';
import {preparationRequestInput,preparationRequestId,preparationReference,preparationRequestReceipt} from './preparation-request-input.mjs';

export function briefingAuthority(db,session) {
  if (session?.principal_type!=='staff' || !['owner','supervisor'].includes(session.role)
    || !db.prepare('SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1').get(session.principal_id,session.org_id,session.site_id,session.role)) throw new Error('Forbidden');
}

export function ensureBriefingSchema(db) {
  ensureDraftReviewSchema(db);
  ensureGlossarySchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS preparation_requests (
    request_id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    briefing_id TEXT NOT NULL REFERENCES briefings(id),revision INTEGER NOT NULL CHECK(revision>0),job_id TEXT NOT NULL REFERENCES jobs(id),
    generation INTEGER NOT NULL CHECK(generation BETWEEN 0 AND 1000000),request_json TEXT NOT NULL CHECK(json_valid(request_json)),
    requested_by TEXT NOT NULL REFERENCES staff(id),created_at TEXT NOT NULL,UNIQUE(job_id,generation),
    CHECK(json_type(request_json)='object' AND json_remove(request_json,'$.revision','$.jobId','$.generation')='{}'),
    CHECK(json_type(request_json,'$.revision') IS 'integer' AND json_extract(request_json,'$.revision')=revision),
    CHECK(json_type(request_json,'$.generation') IS 'integer' AND json_extract(request_json,'$.generation')=generation),
    CHECK((json_type(request_json,'$.jobId') IS 'null' AND generation=0) OR (json_type(request_json,'$.jobId') IS 'text' AND json_extract(request_json,'$.jobId')=job_id))
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS preparation_request_scope BEFORE INSERT ON preparation_requests
    WHEN NOT EXISTS(SELECT 1 FROM jobs WHERE id=NEW.job_id AND org_id=NEW.org_id AND site_id=NEW.site_id AND briefing_id=NEW.briefing_id AND revision=NEW.revision)
      OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.requested_by AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS preparation_request_update BEFORE UPDATE ON preparation_requests BEGIN SELECT RAISE(ABORT,'Preparation request evidence is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS preparation_request_delete BEFORE DELETE ON preparation_requests BEGIN SELECT RAISE(ABORT,'Preparation request evidence is immutable'); END;`);
  db.exec(`CREATE TABLE IF NOT EXISTS briefing_language_requests (
    request_id TEXT NOT NULL,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    briefing_id TEXT NOT NULL REFERENCES briefings(id),accepted_revision INTEGER NOT NULL CHECK(accepted_revision>1),request_json TEXT NOT NULL,
    requested_by TEXT NOT NULL REFERENCES staff(id),occurred_at TEXT NOT NULL,PRIMARY KEY(org_id,site_id,request_id),UNIQUE(briefing_id,accepted_revision),
    CHECK(${briefingLanguageRequestCheck})
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS briefing_language_request_scope BEFORE INSERT ON briefing_language_requests
    WHEN NOT EXISTS(SELECT 1 FROM briefings WHERE id=NEW.briefing_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
      OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.requested_by AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS briefing_language_request_update BEFORE UPDATE ON briefing_language_requests BEGIN SELECT RAISE(ABORT,'Draft languages receipt is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS briefing_language_request_delete BEFORE DELETE ON briefing_language_requests BEGIN SELECT RAISE(ABORT,'Draft languages receipt is immutable'); END;`);
  guardBriefingLanguageRequest(db);
  db.exec(`CREATE TABLE IF NOT EXISTS draft_creations (
    request_id TEXT NOT NULL,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    briefing_id TEXT NOT NULL UNIQUE REFERENCES briefings(id),request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
    requested_by TEXT NOT NULL REFERENCES staff(id),occurred_at TEXT NOT NULL,
    PRIMARY KEY(org_id,site_id,request_id),CHECK(request_id=briefing_id)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS draft_creation_scope BEFORE INSERT ON draft_creations
    WHEN NOT EXISTS(SELECT 1 FROM briefings WHERE id=NEW.briefing_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
      OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.requested_by AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS draft_creation_frozen_update BEFORE UPDATE ON draft_creations BEGIN SELECT RAISE(ABORT,'Draft creation is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS draft_creation_frozen_delete BEFORE DELETE ON draft_creations BEGIN SELECT RAISE(ABORT,'Draft creation is immutable'); END;`);
  if(!db.prepare('PRAGMA table_info(draft_creations)').all().some(row=>row.name==='generation_languages_json'))db.exec(`ALTER TABLE draft_creations ADD COLUMN generation_languages_json TEXT
    CHECK(${generationLanguageCheck});`);
  guardGenerationLanguages(db,'draft_creations');
  db.exec(`CREATE TABLE IF NOT EXISTS briefing_archives (
    request_id TEXT NOT NULL,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    briefing_id TEXT NOT NULL UNIQUE REFERENCES briefings(id),request_json TEXT NOT NULL,publication_ids_json TEXT NOT NULL,
    archived_by TEXT NOT NULL REFERENCES staff(id),occurred_at TEXT NOT NULL,PRIMARY KEY(org_id,site_id,request_id)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS briefing_archive_scope BEFORE INSERT ON briefing_archives
    WHEN NOT EXISTS(SELECT 1 FROM briefings WHERE id=NEW.briefing_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
      OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.archived_by AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS briefing_archive_frozen_update BEFORE UPDATE ON briefing_archives BEGIN SELECT RAISE(ABORT,'Briefing archive is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS briefing_archive_frozen_delete BEFORE DELETE ON briefing_archives BEGIN SELECT RAISE(ABORT,'Briefing archive is immutable'); END;`);
  db.exec(`CREATE TABLE IF NOT EXISTS briefing_copies (
    request_id TEXT NOT NULL,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    source_briefing_id TEXT NOT NULL REFERENCES briefings(id),source_revision INTEGER NOT NULL CHECK(source_revision>0),
    copy_briefing_id TEXT NOT NULL UNIQUE REFERENCES briefings(id),title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 120),
    requested_by TEXT NOT NULL REFERENCES staff(id),occurred_at TEXT NOT NULL,
    PRIMARY KEY(org_id,site_id,request_id),CHECK(source_briefing_id!=copy_briefing_id)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS briefing_copy_scope BEFORE INSERT ON briefing_copies
    WHEN NOT EXISTS(SELECT 1 FROM briefings WHERE id=NEW.source_briefing_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
      OR NOT EXISTS(SELECT 1 FROM briefings WHERE id=NEW.copy_briefing_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
      OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.requested_by AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS briefing_copy_frozen_update BEFORE UPDATE ON briefing_copies BEGIN SELECT RAISE(ABORT,'Draft copy receipt is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS briefing_copy_frozen_delete BEFORE DELETE ON briefing_copies BEGIN SELECT RAISE(ABORT,'Draft copy receipt is immutable'); END;`);
  db.exec(`CREATE TABLE IF NOT EXISTS publication_requests (
    request_id TEXT NOT NULL,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    briefing_id TEXT NOT NULL REFERENCES briefings(id),publication_id TEXT NOT NULL UNIQUE REFERENCES publications(id),request_json TEXT NOT NULL,
    PRIMARY KEY(org_id,site_id,briefing_id,request_id)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS publication_request_scope BEFORE INSERT ON publication_requests
    WHEN NOT EXISTS(SELECT 1 FROM publications p WHERE p.id=NEW.publication_id AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id AND p.briefing_id=NEW.briefing_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS publication_request_frozen_update BEFORE UPDATE ON publication_requests BEGIN SELECT RAISE(ABORT,'Publication request is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS publication_request_frozen_delete BEFORE DELETE ON publication_requests BEGIN SELECT RAISE(ABORT,'Publication request is immutable'); END;
  CREATE TABLE IF NOT EXISTS publication_withdrawals (
    request_id TEXT NOT NULL,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    publication_id TEXT NOT NULL UNIQUE REFERENCES publications(id),version INTEGER NOT NULL CHECK(version>0),
    reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),withdrawn_by TEXT NOT NULL REFERENCES staff(id),occurred_at TEXT NOT NULL,
    PRIMARY KEY(org_id,site_id,request_id)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS publication_withdrawal_scope BEFORE INSERT ON publication_withdrawals
    WHEN NOT EXISTS(SELECT 1 FROM publications p WHERE p.id=NEW.publication_id AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id AND p.version=NEW.version)
      OR NOT EXISTS(SELECT 1 FROM staff s WHERE s.id=NEW.withdrawn_by AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS publication_withdrawal_frozen_update BEFORE UPDATE ON publication_withdrawals BEGIN SELECT RAISE(ABORT,'Withdrawal is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS publication_withdrawal_frozen_delete BEFORE DELETE ON publication_withdrawals BEGIN SELECT RAISE(ABORT,'Withdrawal is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS publication_frozen BEFORE UPDATE ON publications
    WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id OR NEW.briefing_id IS NOT OLD.briefing_id
      OR NEW.version IS NOT OLD.version OR NEW.snapshot_json IS NOT OLD.snapshot_json OR NEW.published_at IS NOT OLD.published_at
    BEGIN SELECT RAISE(ABORT,'Published snapshot is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS assignment_frozen BEFORE UPDATE ON assignments
    WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id OR NEW.publication_id IS NOT OLD.publication_id
      OR NEW.worker_id IS NOT OLD.worker_id OR NEW.created_at IS NOT OLD.created_at
    BEGIN SELECT RAISE(ABORT,'Assignment snapshot is immutable'); END;`);
}

export function briefingAudit(db,session,action,id) {
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),session.org_id,session.site_id,'staff',session.principal_id,action,id,NOW());
}

export function assertBriefingActive(db,session,id) {
  if(db.prepare('SELECT 1 FROM briefing_archives WHERE briefing_id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id)) throw new Error('Briefing is archived');
}

export function archiveBriefing(db,session,id,input) {
  const change=archiveBriefingInput(input),requestJson=JSON.stringify(change);
  return transaction(db,()=>{
    briefingAuthority(db,session);
    const row=db.prepare('SELECT revision,next_version FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
    if(!row) throw new Error('Briefing unavailable');
    const old=db.prepare('SELECT * FROM briefing_archives WHERE request_id=? AND org_id=? AND site_id=?').get(input.requestId,session.org_id,session.site_id);
    if(old) {
      if(old.briefing_id!==id || old.request_json!==requestJson) throw new Error('Briefing archive request conflict');
      return {id,state:'archived',occurredAt:old.occurred_at,closedPublicationIds:JSON.parse(old.publication_ids_json),duplicate:true};
    }
    assertBriefingActive(db,session,id);
    if(row.revision!==change.revision || row.next_version!==change.nextVersion) throw new Error('Draft revision changed');
    const closed=db.prepare("SELECT id FROM publications WHERE briefing_id=? AND org_id=? AND site_id=? AND state='published' ORDER BY id").all(id,session.org_id,session.site_id).map(row=>row.id),now=NOW();
    db.prepare("UPDATE publications SET state='archived' WHERE briefing_id=? AND org_id=? AND site_id=? AND state='published'").run(id,session.org_id,session.site_id);
    db.prepare("UPDATE jobs SET status='failed',lease_until=NULL,error='Briefing archived' WHERE briefing_id=? AND org_id=? AND site_id=? AND kind='prepare' AND status IN ('queued','processing')").run(id,session.org_id,session.site_id);
    db.prepare("UPDATE briefings SET state=CASE WHEN state='processing' THEN 'failed' ELSE state END,updated_at=? WHERE id=? AND org_id=? AND site_id=?").run(now,id,session.org_id,session.site_id);
    db.prepare('INSERT INTO briefing_archives VALUES(?,?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,id,requestJson,JSON.stringify(closed),session.principal_id,now);
    briefingAudit(db,session,'briefing.archived',id);
    return {id,state:'archived',occurredAt:now,closedPublicationIds:closed,duplicate:false};
  });
}

export function createDraft(db,session,input) {
  return transaction(db,()=>createDraftInTransaction(db,session,input));
}

export function createDraftInTransaction(db,session,input) {
  const content=draftInput(input,'create');
  const requestHash=createHash('sha256').update(JSON.stringify(content)).digest('hex');
    briefingAuthority(db,session);
    const receipt=db.prepare('SELECT briefing_id,request_hash FROM draft_creations WHERE request_id=? AND org_id=? AND site_id=?').get(input.requestId,session.org_id,session.site_id);
    if(receipt) {
      if(receipt.request_hash!==requestHash) throw new Error('Draft request conflict');
      return {id:receipt.briefing_id,state:'draft',revision:1,requestHash,duplicate:true};
    }
    const old=db.prepare('SELECT id,title,source,state,revision FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(input.requestId,session.org_id,session.site_id);
    if (old) {
      if (old.title!==content.title || old.source!==content.source || content.generationLanguages!==undefined) throw new Error('Draft request conflict');
      return {id:old.id,state:old.state,revision:old.revision,duplicate:true};
    }
    const now=NOW();
    db.prepare('INSERT INTO briefings VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,content.title,content.source,1,1,'draft',null,now,now);
    db.prepare('INSERT INTO draft_creations(request_id,org_id,site_id,briefing_id,request_hash,requested_by,occurred_at,generation_languages_json) VALUES(?,?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,input.requestId,requestHash,session.principal_id,now,content.generationLanguages?JSON.stringify(content.generationLanguages):null);
    briefingAudit(db,session,'briefing.created',input.requestId);
    return {id:input.requestId,state:'draft',revision:1,requestHash,duplicate:false};
}

export function copyDraft(db,session,id,input) {
  const change=copyDraftInput(input);
  return transaction(db,() => {
    briefingAuthority(db,session);
    const source=db.prepare('SELECT revision,source FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
    if (!source) throw new Error('Briefing unavailable');
    const old=db.prepare('SELECT * FROM briefing_copies WHERE request_id=? AND org_id=? AND site_id=?').get(change.requestId,session.org_id,session.site_id);
    if (old) {
      checkDraftCopyReplay(old,id,change);
      const row=db.prepare('SELECT id,state,revision FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(old.copy_briefing_id,session.org_id,session.site_id);
      return {...row,duplicate:true};
    }
    if(source.revision!==change.revision) throw new Error('Draft revision changed');
    const content=draftInput({requestId:change.requestId,title:change.title,source:source.source},'create');
    if(db.prepare('SELECT id FROM briefings WHERE id=?').get(change.requestId)) throw new Error('Draft copy request conflict');
    const now=NOW();
    db.prepare('INSERT INTO briefings VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(change.requestId,session.org_id,session.site_id,content.title,content.source,1,1,'draft',null,now,now);
    db.prepare('INSERT INTO briefing_copies VALUES(?,?,?,?,?,?,?,?,?)').run(change.requestId,session.org_id,session.site_id,id,change.revision,change.requestId,content.title,session.principal_id,now);
    briefingAudit(db,session,'briefing.copied',change.requestId);
    return {id:change.requestId,state:'draft',revision:1,duplicate:false};
  });
}

export function editDraft(db,session,id,input) {
  const content=draftInput(input,'edit');
  return transaction(db,() => {
    briefingAuthority(db,session);
    const row=db.prepare('SELECT revision,title,source FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
    if (!row) throw new Error('Briefing unavailable');
    assertBriefingActive(db,session,id);
    if (row.revision!==input.revision) throw new Error('Draft revision changed');
    if (row.title===content.title && row.source===content.source) return {id,revision:row.revision,unchanged:true};
    db.prepare("UPDATE briefings SET title=?,source=?,revision=revision+1,state='draft',prepared_json=NULL,updated_at=? WHERE id=? AND org_id=? AND site_id=?").run(content.title,content.source,NOW(),id,session.org_id,session.site_id);
    db.prepare('DELETE FROM draft_reviews WHERE briefing_id=? AND org_id=? AND site_id=?').run(id,session.org_id,session.site_id);
    db.prepare("UPDATE jobs SET status='failed',lease_until=NULL,error='Obsolete draft revision' WHERE briefing_id=? AND org_id=? AND site_id=? AND revision=? AND kind='prepare' AND status IN ('queued','processing')").run(id,session.org_id,session.site_id,row.revision);
    briefingAudit(db,session,'briefing.edited',id);
    return {id,revision:row.revision+1,state:'draft',unchanged:false};
  });
}

export function queuePreparation(db,session,id,revision) {
  expectedRevision(revision);
  return transaction(db,() => queuePreparationTransaction(db,session,id,revision));
}
export function queuePreparationInTransaction(db,session,id,revision) {
  return queuePreparationTransaction(db,session,id,revision);
}
function queuePreparationTransaction(db,session,id,revision) {
    briefingAuthority(db,session);
    const row=db.prepare('SELECT revision,state FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
    if (!row) throw new Error('Briefing unavailable');
    assertBriefingActive(db,session,id);
    if (row.revision!==revision) throw new Error('Draft revision changed');
    const old=db.prepare("SELECT id,status FROM jobs WHERE briefing_id=? AND org_id=? AND site_id=? AND revision=? AND kind='prepare'").get(id,session.org_id,session.site_id,revision);
    if (row.state==='processing' && ['queued','processing'].includes(old?.status)) return {id:old.id,state:'processing',duplicate:true};
    if (!['draft','failed'].includes(row.state)) throw new Error('Draft cannot be processed now');
    const jobId=old?.id || randomUUID(),now=NOW();
    db.prepare(`INSERT INTO jobs VALUES(?,?,?,?,?,'prepare','queued',0,?,NULL,NULL,?)
      ON CONFLICT(briefing_id,revision,kind) DO UPDATE SET status='queued',attempts=0,due_at=excluded.due_at,lease_until=NULL,error=NULL`).run(jobId,session.org_id,session.site_id,id,revision,now,now);
    db.prepare("UPDATE briefings SET state='processing',prepared_json=NULL,updated_at=? WHERE id=? AND org_id=? AND site_id=?").run(now,id,session.org_id,session.site_id);
    briefingAudit(db,session,'briefing.processing_requested',jobId);
    return {id:jobId,state:'processing',duplicate:false};
}

function preparationContext(db,session,id) {
  briefingAuthority(db,session);preparationReference(id);
  const row=db.prepare('SELECT revision,state FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
  if(!row)throw Error('Briefing unavailable');
  assertBriefingActive(db,session,id);
  const job=db.prepare("SELECT id,status FROM jobs WHERE briefing_id=? AND org_id=? AND site_id=? AND revision=? AND kind='prepare'").get(id,session.org_id,session.site_id,row.revision);
  const generation=job?db.prepare('SELECT count(*) AS n FROM preparation_requests WHERE job_id=?').get(job.id).n:0;
  return {briefingId:id,revision:row.revision,state:row.state,job:job?{...job,generation}:null};
}
export function getPreparationRequestContext(db,session,id) {
  return transaction(db,()=>preparationContext(db,session,id));
}
const sqlitePreparationReceipt=row=>preparationRequestReceipt({...row,request_json:JSON.parse(row.request_json)});
export function getPreparationRequestReceipt(db,session,id,requestId) {
  briefingAuthority(db,session);preparationReference(id);preparationRequestId(requestId);
  const row=db.prepare('SELECT * FROM preparation_requests WHERE request_id=? AND briefing_id=? AND org_id=? AND site_id=? AND requested_by=?').get(requestId,id,session.org_id,session.site_id,session.principal_id);
  return row?sqlitePreparationReceipt(row):{found:false};
}
export function requestPreparation(db,session,id,value) {
  const input=preparationRequestInput(id,value),{requestId,briefingId,...body}=input;
  return transaction(db,()=>{
    briefingAuthority(db,session);
    const saved=db.prepare('SELECT * FROM preparation_requests WHERE request_id=?').get(requestId);
    if(saved) {
      if(saved.org_id!==session.org_id || saved.site_id!==session.site_id || saved.requested_by!==session.principal_id
        || saved.briefing_id!==id || JSON.stringify(preparationRequestInput(saved.briefing_id,{...JSON.parse(saved.request_json),requestId:saved.request_id}))!==JSON.stringify(input))throw Error('Preparation request conflict');
      return {...sqlitePreparationReceipt(saved).result,duplicate:true};
    }
    const context=preparationContext(db,session,id);
    if(context.revision!==input.revision || (context.job?.id ?? null)!==input.jobId || (context.job?.generation ?? 0)!==input.generation
      || !['draft','failed'].includes(context.state) || context.job && context.job.status!=='failed')throw Error('Preparation request state changed');
    const result=queuePreparationTransaction(db,session,id,input.revision),createdAt=NOW();
    db.prepare('INSERT INTO preparation_requests VALUES(?,?,?,?,?,?,?,?,?,?)').run(requestId,session.org_id,session.site_id,id,input.revision,result.id,input.generation,JSON.stringify(body),session.principal_id,createdAt);
    return {id:result.id,state:'processing',acceptedAt:createdAt,duplicate:false};
  });
}
