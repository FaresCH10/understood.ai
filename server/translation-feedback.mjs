import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {translationFeedbackInput,translationFeedbackDecisionInput,translationFeedbackFilters} from './translation-feedback-input.mjs';

const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function ensureTranslationFeedbackSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS translation_feedback (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    publication_id TEXT NOT NULL REFERENCES publications(id),briefing_id TEXT NOT NULL REFERENCES briefings(id),
    language TEXT NOT NULL,field TEXT NOT NULL CHECK(field IN ('title','text','question','audio','glossary')),
    note TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','resolved','dismissed')),
    reported_by TEXT NOT NULL REFERENCES staff(id),reported_at TEXT NOT NULL,
    resolved_by TEXT REFERENCES staff(id),resolved_at TEXT,resolution_note TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_translation_feedback_queue ON translation_feedback(org_id,site_id,status,reported_at DESC,id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_translation_feedback_open
    ON translation_feedback(org_id,site_id,publication_id,language,field) WHERE status='open';
  CREATE TRIGGER IF NOT EXISTS translation_feedback_scope BEFORE INSERT ON translation_feedback WHEN
    NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.reported_by AND org_id=NEW.org_id AND site_id=NEW.site_id)
    OR NOT EXISTS(SELECT 1 FROM publications p WHERE p.id=NEW.publication_id AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id AND p.briefing_id=NEW.briefing_id)
    OR NOT EXISTS(SELECT 1 FROM briefings b WHERE b.id=NEW.briefing_id AND b.org_id=NEW.org_id AND b.site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS translation_feedback_evidence BEFORE UPDATE OF id,org_id,site_id,publication_id,briefing_id,language,field,note,reported_by,reported_at ON translation_feedback
    WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id OR NEW.publication_id IS NOT OLD.publication_id
      OR NEW.briefing_id IS NOT OLD.briefing_id OR NEW.language IS NOT OLD.language OR NEW.field IS NOT OLD.field
      OR NEW.note IS NOT OLD.note OR NEW.reported_by IS NOT OLD.reported_by OR NEW.reported_at IS NOT OLD.reported_at
    BEGIN SELECT RAISE(ABORT,'Translation feedback evidence is immutable'); END;
  DROP TRIGGER IF EXISTS translation_feedback_decision;
  CREATE TRIGGER translation_feedback_decision BEFORE UPDATE ON translation_feedback
    WHEN (NEW.status IS NOT OLD.status OR NEW.resolved_by IS NOT OLD.resolved_by OR NEW.resolved_at IS NOT OLD.resolved_at OR NEW.resolution_note IS NOT OLD.resolution_note)
      AND (OLD.status<>'open' OR NEW.status='open' OR NEW.resolved_by IS NULL OR NEW.resolved_at IS NULL)
    BEGIN SELECT RAISE(ABORT,'Translation feedback decision is final'); END;
  CREATE TRIGGER IF NOT EXISTS translation_feedback_frozen_delete BEFORE DELETE ON translation_feedback
    BEGIN SELECT RAISE(ABORT,'Translation feedback evidence is immutable'); END;`);
}

function authority(db,session,manage=false) {
  const roles=manage?['owner','supervisor']:['owner','supervisor','auditor'];
  if(session?.principal_type!=='staff' || !roles.includes(session.role)
    || !db.prepare('SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1').get(session.principal_id,session.org_id,session.site_id,session.role)) throw new Error('Forbidden');
}
function feedbackAudit(db,session,action,id) {
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),session.org_id,session.site_id,'staff',session.principal_id,action,id,NOW());
}
function translationText(snapshot,language,field) {
  const value=snapshot?.languages?.[language] ?? snapshot?.deliveredTranslation;
  if(!value || typeof value!=='object') return '';
  const text=field==='title'?value.title:field==='question'?value.question:field==='audio'?(value.speech || value.text):field==='glossary'?'':value.text;
  return typeof text==='string' ? text.slice(0,2000) : '';
}
function feedbackRow(row) {
  return {id:row.id,publicationId:row.publication_id,briefingId:row.briefing_id,briefingTitle:row.briefing_title,
    publicationState:row.publication_state,publicationVersion:row.publication_version,language:row.language,field:row.field,
    note:row.note,status:row.status,reporter:row.reporter_name || '',reportedById:row.reported_by,createdAt:row.reported_at,
    resolvedBy:row.resolver_name || '',resolvedById:row.resolved_by || null,resolvedAt:row.resolved_at || null,
    resolutionNote:row.resolution_note || '',translation:translationText(row.snapshot_json ? JSON.parse(row.snapshot_json) : null,row.language,row.field)};
}
const queueQuery=`SELECT f.*,b.title AS briefing_title,p.state AS publication_state,p.version AS publication_version,json_set(p.snapshot_json,'$.deliveredTranslation',json((SELECT d.content_json FROM instruction_deliveries d JOIN instruction_sends snd ON snd.request_id=d.request_id AND snd.org_id=d.org_id AND snd.site_id=d.site_id WHERE snd.publication_id=f.publication_id AND d.org_id=f.org_id AND d.site_id=f.site_id AND d.language=f.language AND d.state='available' ORDER BY d.assignment_id LIMIT 1))) AS snapshot_json,
  reporter.name AS reporter_name,resolver.name AS resolver_name
  FROM translation_feedback f JOIN briefings b ON b.id=f.briefing_id AND b.org_id=f.org_id AND b.site_id=f.site_id
  JOIN publications p ON p.id=f.publication_id AND p.org_id=f.org_id AND p.site_id=f.site_id
  LEFT JOIN staff reporter ON reporter.id=f.reported_by AND reporter.org_id=f.org_id AND reporter.site_id=f.site_id
  LEFT JOIN staff resolver ON resolver.id=f.resolved_by AND resolver.org_id=f.org_id AND resolver.site_id=f.site_id`;
export function listTranslationFeedback(db,session,input={}) {
  throw new Error('Forbidden');
}

export function reportTranslationFeedback(db,session,input) {
  const value=translationFeedbackInput(input);
  return transaction(db,()=>{
    authority(db,session);
    const old=db.prepare('SELECT * FROM translation_feedback WHERE id=?').get(value.requestId);
    if(old) {
      if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.reported_by!==session.principal_id
        || old.publication_id!==value.publicationId || old.language!==value.language || old.field!==value.field || old.note!==value.note) throw new Error('Translation feedback request conflict');
      return {...feedbackRow(db.prepare(`${queueQuery} WHERE f.id=?`).get(old.id)),duplicate:true};
    }
    const publication=db.prepare(`SELECT p.id,p.briefing_id,p.snapshot_json,b.title AS briefing_title
      FROM publications p JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id AND b.site_id=p.site_id
      WHERE p.id=? AND p.org_id=? AND p.site_id=?`).get(value.publicationId,session.org_id,session.site_id);
    if(!publication) throw new Error('Publication unavailable');
    const languages=JSON.parse(publication.snapshot_json)?.languages;
    if(!languages?.[value.language] && !db.prepare(`SELECT 1 FROM instruction_deliveries d JOIN instruction_sends s ON s.request_id=d.request_id AND s.org_id=d.org_id AND s.site_id=d.site_id WHERE s.publication_id=? AND d.org_id=? AND d.site_id=? AND d.language=? AND d.state='available'`).get(value.publicationId,session.org_id,session.site_id,value.language))throw new Error('Translation language unavailable');
    if(db.prepare("SELECT 1 FROM translation_feedback WHERE org_id=? AND site_id=? AND publication_id=? AND language=? AND field=? AND status='open'")
      .get(session.org_id,session.site_id,value.publicationId,value.language,value.field)) throw new Error('Translation feedback already open');
    const now=NOW();
    db.prepare('INSERT INTO translation_feedback VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(value.requestId,session.org_id,session.site_id,
      value.publicationId,publication.briefing_id,value.language,value.field,value.note,'open',session.principal_id,now,null,null,null);
    feedbackAudit(db,session,'translation.feedback_reported',value.requestId);
    const row=db.prepare(`${queueQuery} WHERE f.id=?`).get(value.requestId);
    return {...feedbackRow(row),duplicate:false};
  });
}
export function decideTranslationFeedback(db,session,id,input) {
  throw new Error('Forbidden');
}
