import {NOW,transaction} from './db.mjs';
import {randomUUID} from 'node:crypto';
import {ensureDeletionSchema} from './deletions.mjs';
import {createDraftInTransaction,briefingAudit,ensureBriefingSchema} from './preparation.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';
import {improvementSampleQuery,improvementCountQuery,improvementCounts,improvementNeeded,improvementDraftInput,improvementView,decodeImprovementSnapshot} from './self-healing-input.mjs';

export function ensureImprovementSchema(db) {
  ensureBriefingSchema(db);
  ensureDeletionSchema(db);
  const scopedCounts=improvementCountQuery.replace('a.publication_id=? AND a.org_id=? AND a.site_id=?',
    'a.publication_id=NEW.publication_id AND a.org_id=NEW.org_id AND a.site_id=NEW.site_id');
  db.exec(`CREATE TABLE IF NOT EXISTS instruction_improvements (
    publication_id TEXT PRIMARY KEY REFERENCES publications(id),org_id TEXT NOT NULL,site_id TEXT NOT NULL,
    briefing_id TEXT NOT NULL REFERENCES briefings(id),assessed INTEGER NOT NULL CHECK(assessed>=3),
    matched INTEGER NOT NULL CHECK(matched>=0),clarification INTEGER NOT NULL CHECK(clarification>=2),created_at TEXT NOT NULL,
    CHECK(matched+clarification<=assessed AND clarification*100>=assessed*30)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS improvement_scope BEFORE INSERT ON instruction_improvements
    WHEN NOT EXISTS(SELECT 1 FROM publications p WHERE p.id=NEW.publication_id AND p.org_id=NEW.org_id
      AND p.site_id=NEW.site_id AND p.briefing_id=NEW.briefing_id AND p.state='published')
      OR NOT EXISTS(SELECT 1 FROM (${scopedCounts}) c WHERE c.assessed=NEW.assessed AND c.matched=NEW.matched AND c.clarification=NEW.clarification)
    BEGIN SELECT RAISE(ABORT,'Improvement scope or evidence mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS improvement_frozen_update BEFORE UPDATE ON instruction_improvements
    BEGIN SELECT RAISE(ABORT,'Improvement is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS improvement_frozen_delete BEFORE DELETE ON instruction_improvements
    BEGIN SELECT RAISE(ABORT,'Improvement is immutable'); END;
  CREATE TABLE IF NOT EXISTS instruction_improvement_drafts (
    publication_id TEXT PRIMARY KEY REFERENCES instruction_improvements(publication_id),request_id TEXT NOT NULL UNIQUE,
    org_id TEXT NOT NULL,site_id TEXT NOT NULL,corrective_briefing_id TEXT NOT NULL UNIQUE REFERENCES briefings(id),
    request_hash TEXT NOT NULL CHECK(length(request_hash)=64),requested_by TEXT NOT NULL REFERENCES staff(id),created_at TEXT NOT NULL,
    CHECK(corrective_briefing_id=request_id)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS improvement_draft_scope BEFORE INSERT ON instruction_improvement_drafts
    WHEN NOT EXISTS(SELECT 1 FROM instruction_improvements i JOIN briefings b ON b.id=NEW.corrective_briefing_id
      AND b.org_id=i.org_id AND b.site_id=i.site_id JOIN staff s ON s.id=NEW.requested_by AND s.org_id=i.org_id
      AND s.site_id=i.site_id AND s.active=true AND s.role IN ('owner','supervisor')
      WHERE i.publication_id=NEW.publication_id AND i.org_id=NEW.org_id AND i.site_id=NEW.site_id
        AND b.id<>i.briefing_id AND b.state='draft')
    BEGIN SELECT RAISE(ABORT,'Improvement draft scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS improvement_draft_frozen_update BEFORE UPDATE ON instruction_improvement_drafts
    BEGIN SELECT RAISE(ABORT,'Improvement draft is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS improvement_draft_frozen_delete BEFORE DELETE ON instruction_improvement_drafts
    BEGIN SELECT RAISE(ABORT,'Improvement draft is immutable'); END;`);
}

function authority(db,session,write=false) {
  if(session?.principal_type!=='staff' || !(write?['owner','supervisor']:['owner','supervisor','auditor']).includes(session.role)
    || !db.prepare('SELECT 1 FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=true')
      .get(session.principal_id,session.org_id,session.site_id,session.role))throw Error('Forbidden');
  requireSiteOperational(db,session.org_id,session.site_id);
  if(write)requireWritableEntitlement(db,session.org_id);
}

function publication(db,session,id) {
  const row=db.prepare('SELECT * FROM publications WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
  if(!row)throw Error('Publication unavailable');
  return row;
}
function samples(db,row) {return db.prepare(improvementSampleQuery).all(row.id,row.org_id,row.site_id);}
function currentPublication(db,row) {
  return row.state==='published' && !db.prepare('SELECT 1 FROM briefing_archives WHERE briefing_id=? AND org_id=? AND site_id=?').get(row.briefing_id,row.org_id,row.site_id)
    && !db.prepare('SELECT 1 FROM publication_withdrawals WHERE publication_id=? AND org_id=? AND site_id=?').get(row.id,row.org_id,row.site_id);
}

function detect(db,row) {
  if(!currentPublication(db,row))return false;
  const counts=improvementCounts(samples(db,row));
  if(!improvementNeeded(counts))return false;
  const changed=db.prepare(`INSERT INTO instruction_improvements VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(publication_id) DO NOTHING`)
    .run(row.id,row.org_id,row.site_id,row.briefing_id,counts.assessed,counts.matched,counts.clarification,NOW());
  if(changed.changes)db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),row.org_id,row.site_id,
    'system','instruction-improvement-worker','instruction.improvement_suggested',row.id,NOW());
  return changed.changes>0;
}

function read(db,session,id) {
  const row=publication(db,session,id),signal=db.prepare('SELECT * FROM instruction_improvements WHERE publication_id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
  const followup=db.prepare(`SELECT f.*,p.id AS followup_publication_id,p.state AS followup_publication_state FROM instruction_improvement_drafts f
    LEFT JOIN publications p ON p.briefing_id=f.corrective_briefing_id AND p.org_id=f.org_id AND p.site_id=f.site_id
    WHERE f.publication_id=? AND f.org_id=? AND f.site_id=? ORDER BY p.version DESC LIMIT 1`).get(id,session.org_id,session.site_id);
  const after=followup?.followup_publication_id?samples(db,{...row,id:followup.followup_publication_id})
    .filter(sample=>db.prepare('SELECT 1 FROM assignments WHERE publication_id=? AND org_id=? AND site_id=? AND worker_id=?').get(id,session.org_id,session.site_id,sample.worker_id)):[];
  const result=improvementView(row,signal,samples(db,row),followup,after);
  if(!currentPublication(db,row))result.eligible=false;
  return result;
}

export function readInstructionImprovement(db,session,id) {
  ensureImprovementSchema(db);
  return transaction(db,()=>{authority(db,session);return read(db,session,id);});
}
export function analyzeInstructionImprovement(db,session,id) {
  ensureImprovementSchema(db);
  return transaction(db,()=>{authority(db,session,true);const row=publication(db,session,id);detect(db,row);return read(db,session,id);});
}
export function createImprovementDraft(db,session,id,input) {
  const change=improvementDraftInput(input);ensureImprovementSchema(db);
  return transaction(db,()=>{
    authority(db,session,true);const row=publication(db,session,id);
    const old=db.prepare('SELECT * FROM instruction_improvement_drafts WHERE publication_id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
    if(old){if(old.request_id!==change.requestId || old.request_hash!==change.hash)throw Error('Improvement request conflict');return {...read(db,session,id),duplicate:true};}
    const view=read(db,session,id);
    if(!view.eligible || !view.signal || !view.suggestion)throw Error('Improvement not available');
    const snapshot=decodeImprovementSnapshot(row.snapshot_json);
    const draft=createDraftInTransaction(db,session,{requestId:change.requestId,title:change.title,source:change.source,generationLanguages:Object.keys(snapshot.languages)});
    if(draft.duplicate)throw Error('Improvement request conflict');
    db.prepare('INSERT INTO instruction_improvement_drafts VALUES(?,?,?,?,?,?,?,?)')
      .run(id,change.requestId,session.org_id,session.site_id,draft.id,change.hash,session.principal_id,NOW());
    briefingAudit(db,session,'instruction.improvement_drafted',id);
    return {...read(db,session,id),duplicate:false};
  });
}
export function processOneInstructionImprovement(db) {
  ensureImprovementSchema(db);
  return transaction(db,()=>{
    const rows=db.prepare(`SELECT p.* FROM publications p WHERE p.state='published'
      AND NOT EXISTS(SELECT 1 FROM instruction_improvements i WHERE i.publication_id=p.id)
      AND EXISTS(SELECT 1 FROM attempts t JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id WHERE a.publication_id=p.id)
      ORDER BY p.published_at,p.id`).all();
    for(const row of rows){
      try{requireWritableEntitlement(db,row.org_id);requireSiteOperational(db,row.org_id,row.site_id);}catch(error){if(['Workspace is read-only','Site archived'].includes(error.message))continue;throw error;}
      if(detect(db,row))return true;
    }
    return false;
  });
}
