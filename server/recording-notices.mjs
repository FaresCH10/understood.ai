import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {recordingNoticeInput,noticeRequestId,sameNoticeRequest,noticeView} from './recording-notice-input.mjs';
import {staffRecoveryScope} from './staff-input.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {workerCredentialSessionValid} from './auth.mjs';

export function ensureRecordingNoticeSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS recording_notices (
    site_id TEXT PRIMARY KEY REFERENCES sites(id),org_id TEXT NOT NULL REFERENCES organizations(id),
    revision INTEGER NOT NULL CHECK(revision>0),notices_json TEXT NOT NULL CHECK(json_valid(notices_json)),updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS recording_notice_requests (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    actor_id TEXT NOT NULL REFERENCES staff(id),request_json TEXT NOT NULL CHECK(json_valid(request_json)),
    revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS recording_notice_scope BEFORE INSERT ON recording_notices WHEN
    NOT EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND org_id=NEW.org_id) BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS recording_notice_identity BEFORE UPDATE ON recording_notices WHEN
    NEW.site_id<>OLD.site_id OR NEW.org_id<>OLD.org_id BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS recording_notice_request_scope BEFORE INSERT ON recording_notice_requests WHEN
    NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.actor_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;`);
  for(const action of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS recording_notice_request_${action.toLowerCase()}
    BEFORE ${action} ON recording_notice_requests BEGIN SELECT RAISE(ABORT,'Recording notice receipt is immutable'); END;`);
}
function authority(db,session,write=false){
  if(!session || !['staff','worker'].includes(session.principal_type) || (write && (session.principal_type!=='staff' || !['owner','administrator'].includes(session.role))))throw Error('Forbidden');
  if(session.principal_type==='worker')requireWorkerSiteAccess(db,session.org_id,session.site_id);
  if(session.principal_type==='staff' && !['owner','administrator','supervisor','auditor'].includes(session.role))throw Error('Forbidden');
  const table=session.principal_type==='staff'?'staff':'workers';
  const row=db.prepare(`SELECT * FROM ${table} WHERE id=? AND org_id=? AND site_id=? AND active=1`).get(session.principal_id,session.org_id,session.site_id);
  if(!row || (session.principal_type==='staff' && row.role!==session.role))throw Error('Forbidden');
  if(session.token_hash!==undefined && !db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND org_id=? AND site_id=?
    AND principal_type=? AND principal_id=? AND revoked_at IS NULL AND expires_at>?`)
    .get(session.token_hash,session.org_id,session.site_id,session.principal_type,session.principal_id,NOW()))throw Error('Sign in required');
  if(session.principal_type==='worker' && session.access_mode==='credential' && !workerCredentialSessionValid(db, session))throw Error('Sign in required');
  return {...session,...(session.principal_type==='worker'?{language:row.language}:{})};
}
const current=(db,session)=>db.prepare('SELECT * FROM recording_notices WHERE org_id=? AND site_id=?').get(session.org_id,session.site_id);
export function getRecordingNotice(db,session,{language}={}){
  ensureRecordingNoticeSchema(db);return transaction(db,()=>{const principal=authority(db,session);return {...noticeView(current(db,session),principal,language),...(principal.principal_type==='staff'?{recoveryScope:staffRecoveryScope(principal)}:{})};});
}
export function recordingNoticeReceipt(db,session,requestId){
  noticeRequestId(requestId);ensureRecordingNoticeSchema(db);
  return transaction(db,()=>{authority(db,session,true);const row=db.prepare('SELECT * FROM recording_notice_requests WHERE id=? AND org_id=? AND site_id=? AND actor_id=?').get(requestId,session.org_id,session.site_id,session.principal_id);
    return row?{requestId:row.id,request:JSON.parse(row.request_json),revision:row.revision}:null;});
}
export function saveRecordingNotice(db,session,input){
  const parsed=recordingNoticeInput(input);ensureRecordingNoticeSchema(db);
  return transaction(db,()=>{
    authority(db,session,true);
    if(parsed.scope!==staffRecoveryScope(session))throw Error('Recording notice request conflict');
    const old=db.prepare('SELECT * FROM recording_notice_requests WHERE id=?').get(input.requestId);
    if(old){if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.actor_id!==session.principal_id || !sameNoticeRequest(JSON.parse(old.request_json),parsed))throw Error('Recording notice request conflict');return {requestId:old.id,revision:old.revision,duplicate:true};}
    if((current(db,session)?.revision || 0)!==parsed.revision)throw Error('Recording notice revision changed');
    const revision=parsed.revision+1,now=NOW();
    db.prepare(`INSERT INTO recording_notices VALUES(?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET
      revision=excluded.revision,notices_json=excluded.notices_json,updated_at=excluded.updated_at`).run(session.site_id,session.org_id,revision,JSON.stringify(parsed.notices),now);
    db.prepare('INSERT INTO recording_notice_requests VALUES(?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,session.principal_id,JSON.stringify(parsed),revision,now);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),session.org_id,session.site_id,'staff',session.principal_id,'recording.notice.updated',input.requestId,now);
    return {requestId:input.requestId,revision,duplicate:false};
  });
}
