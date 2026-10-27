import {generationLanguageCheck,guardGenerationLanguages} from './generation-language-schema.mjs';
import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {scheduleAuthority} from './schedules.mjs';
import {briefingAudit} from './preparation.mjs';
import {audioStore,verifySourceOriginal} from './private-storage.mjs';
import {inspectWav} from './audio.mjs';
import {reviewRequestId} from './briefing-input.mjs';
import {sourceAudioInput,sourceAudioReceipt,sourceAudioReplay,sourceAudioReferences,sourceAudioPage,sourceAudioListItem} from './source-audio-input.mjs';

export function ensureSourceAudioSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS source_audio_requests (
    request_id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    requested_by TEXT NOT NULL REFERENCES staff(id),request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 120),generation_languages_json TEXT,
    id TEXT NOT NULL UNIQUE,sha256 TEXT NOT NULL CHECK(length(sha256)=64),bytes INTEGER NOT NULL CHECK(bytes BETWEEN 8044 AND 2880044),
    duration_seconds REAL NOT NULL CHECK(duration_seconds BETWEEN 0.25 AND 90),
    original_id TEXT NOT NULL UNIQUE,original_sha256 TEXT NOT NULL CHECK(length(original_sha256)=64),
    original_bytes INTEGER NOT NULL CHECK(original_bytes BETWEEN 1 AND 10485760),original_type TEXT NOT NULL,
    authority_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('storing','received','processing','transcribed','failed','blocked')),
    created_at TEXT NOT NULL,received_at TEXT,briefing_id TEXT REFERENCES briefings(id),
    lease_token TEXT,lease_until TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),retry_at TEXT,
    CHECK(id!=original_id),CHECK(${generationLanguageCheck}),
    CHECK((status='storing' AND received_at IS NULL) OR (status!='storing' AND received_at IS NOT NULL))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS source_audio_status ON source_audio_requests(status,created_at);
  CREATE INDEX IF NOT EXISTS source_audio_history ON source_audio_requests(org_id,site_id,requested_by,received_at,request_id);
  CREATE TRIGGER IF NOT EXISTS source_audio_scope BEFORE INSERT ON source_audio_requests
    WHEN NOT EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND org_id=NEW.org_id)
      OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.requested_by AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS source_audio_frozen BEFORE UPDATE ON source_audio_requests
    WHEN NEW.request_id IS NOT OLD.request_id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
      OR NEW.requested_by IS NOT OLD.requested_by OR NEW.request_hash IS NOT OLD.request_hash OR NEW.title IS NOT OLD.title
      OR NEW.generation_languages_json IS NOT OLD.generation_languages_json OR NEW.id IS NOT OLD.id
      OR NEW.sha256 IS NOT OLD.sha256 OR NEW.bytes IS NOT OLD.bytes OR NEW.duration_seconds IS NOT OLD.duration_seconds
      OR NEW.original_id IS NOT OLD.original_id OR NEW.original_sha256 IS NOT OLD.original_sha256
      OR NEW.original_bytes IS NOT OLD.original_bytes OR NEW.original_type IS NOT OLD.original_type
      OR NEW.authority_json IS NOT OLD.authority_json OR NEW.created_at IS NOT OLD.created_at
      OR (OLD.received_at IS NOT NULL AND NEW.received_at IS NOT OLD.received_at)
      OR (OLD.briefing_id IS NOT NULL AND NEW.briefing_id IS NOT OLD.briefing_id)
      OR (NEW.briefing_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM briefings WHERE id=NEW.briefing_id AND org_id=NEW.org_id AND site_id=NEW.site_id))
    BEGIN SELECT RAISE(ABORT,'Source audio evidence is immutable'); END;
  CREATE TABLE IF NOT EXISTS source_audio_purges (
    request_id TEXT PRIMARY KEY REFERENCES source_audio_requests(request_id),org_id TEXT NOT NULL,site_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK(reason IN ('staged_expired','audio_retention')),status TEXT NOT NULL CHECK(status IN ('queued','processing','complete')),
    created_at TEXT NOT NULL,completed_at TEXT,verified_at TEXT,attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
    lease_token TEXT,lease_until TEXT,retry_at TEXT,error TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS source_audio_purges_due ON source_audio_purges(status,retry_at,lease_until,verified_at);
  CREATE TRIGGER IF NOT EXISTS source_audio_purges_scope BEFORE INSERT ON source_audio_purges
    WHEN NOT EXISTS(SELECT 1 FROM source_audio_requests WHERE request_id=NEW.request_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS source_audio_purges_frozen BEFORE UPDATE ON source_audio_purges
    WHEN NEW.request_id IS NOT OLD.request_id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
      OR NEW.reason IS NOT OLD.reason OR NEW.created_at IS NOT OLD.created_at
      OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS NOT OLD.completed_at)
    BEGIN SELECT RAISE(ABORT,'Source cleanup history is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS source_audio_purges_no_delete BEFORE DELETE ON source_audio_purges
    BEGIN SELECT RAISE(ABORT,'Source cleanup history is immutable'); END;`);
  guardGenerationLanguages(db,'source_audio_requests');
}

// Storage and SQL cannot commit together: keep the journal and verify objects on exact retries.
export async function receiveSourceAudioWithJournal(journal,session,input,original,wav,storage) {
  const content=sourceAudioInput(input,original,wav);
  if(!['save','read','saveOriginal','readOriginal'].every(method=>typeof storage?.[method]==='function'))throw Error('Private source storage unavailable');
  const staged=await journal.reserve(session,content);
  if(staged.received_at)return {...sourceAudioReceipt(staged),duplicate:true};
  const references=sourceAudioReferences(staged);
  try {
    try {await storage.saveOriginal(references.original,original);}
    catch { /* An exclusive write or lost acknowledgement is reconciled by read-back. */ }
    verifySourceOriginal(references.original,await storage.readOriginal(references.original));
    try {await storage.save(references.canonical,wav);}
    catch { /* An exclusive write or lost acknowledgement is reconciled by read-back. */ }
    const check=inspectWav(await storage.read(references.canonical));
    if(check.sha256!==staged.sha256 || check.bytes!==staged.bytes)throw Error('Private source integrity check failed');
    return {...sourceAudioReceipt(await journal.accept(session,staged)),duplicate:false};
  } catch {
    // Never delete an object on an uncertain COMMIT or storage acknowledgement.
    try {const current=await journal.lookup(session,content.requestId);if(current?.received_at)return {...sourceAudioReceipt(current),duplicate:true};}
    catch { /* Authority/database failure must not expose a protected receipt. */ }
    try {await journal.release(staged);}catch { /* The bounded lease will expire for exact recovery. */ }
    throw Error('Source audio upload could not be confirmed');
  }
}

export function sourceAudioJournal(db) {
  ensureSourceAudioSchema(db);
  return {
    reserve(session,content) {return transaction(db,()=>{
      const authority=JSON.stringify(scheduleAuthority(db,session));
      const old=db.prepare('SELECT * FROM source_audio_requests WHERE request_id=?').get(content.requestId);
      if(old) {
        sourceAudioReplay(old,session,content);
        if(db.prepare('SELECT 1 FROM source_audio_purges WHERE request_id=?').get(content.requestId))throw Error('Source audio expired');
        if(old.received_at)return old;
        if(old.authority_json!==authority)throw Error('Source audio authority changed');
        if(old.lease_until && old.lease_until>NOW())throw Error('Source audio upload is in progress');
        const token=randomUUID();
        db.prepare('UPDATE source_audio_requests SET lease_token=?,lease_until=?,error=NULL WHERE request_id=?')
          .run(token,new Date(Date.now()+180000).toISOString(),content.requestId);
        return {...old,lease_token:token};
      }
      const row={request_id:content.requestId,org_id:session.org_id,site_id:session.site_id,requested_by:session.principal_id,
        request_hash:content.requestHash,title:content.title,generation_languages_json:content.generationLanguages?JSON.stringify(content.generationLanguages):null,
        id:randomUUID(),sha256:content.sha256,bytes:content.bytes,duration_seconds:content.durationSeconds,
        original_id:randomUUID(),original_sha256:content.originalSha256,original_bytes:content.originalBytes,original_type:content.originalType,
        authority_json:authority,status:'storing',created_at:NOW(),received_at:null,briefing_id:null,
        lease_token:randomUUID(),lease_until:new Date(Date.now()+180000).toISOString(),error:null};
      db.prepare(`INSERT INTO source_audio_requests(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
      return row;
    });},
    accept(session,row) {return transaction(db,()=>{
      const authority=JSON.stringify(scheduleAuthority(db,session));
      const current=db.prepare('SELECT * FROM source_audio_requests WHERE request_id=?').get(row.request_id);
      if(!current || current.authority_json!==authority || current.requested_by!==session.principal_id
        || current.org_id!==session.org_id || current.site_id!==session.site_id)throw Error('Source audio authority changed');
      if(db.prepare('SELECT 1 FROM source_audio_purges WHERE request_id=?').get(row.request_id))throw Error('Source audio expired');
      if(current.received_at)return current;
      if(current.lease_token!==row.lease_token || current.lease_until<=NOW())throw Error('Source audio storage lease expired');
      db.prepare("UPDATE source_audio_requests SET status='received',received_at=?,lease_token=NULL,lease_until=NULL,error=NULL WHERE request_id=?").run(NOW(),row.request_id);
      briefingAudit(db,session,'briefing.source_audio_received',row.request_id);
      return db.prepare('SELECT * FROM source_audio_requests WHERE request_id=?').get(row.request_id);
    });},
    lookup(session,id) {return transaction(db,()=>{
      scheduleAuthority(db,session);reviewRequestId(id);
      return db.prepare(`SELECT r.*,p.completed_at AS audio_removed_at,p.request_id AS audio_cleanup_id FROM source_audio_requests r
        LEFT JOIN source_audio_purges p ON p.request_id=r.request_id WHERE r.request_id=? AND r.org_id=? AND r.site_id=? AND r.requested_by=?`)
        .get(id,session.org_id,session.site_id,session.principal_id) ?? null;
    });},
    release(row) {db.prepare("UPDATE source_audio_requests SET lease_token=NULL,lease_until=?,error='Private upload requires recovery' WHERE request_id=? AND status='storing' AND lease_token=?")
      .run(NOW(),row.request_id,row.lease_token);},
  };
}

export async function receiveSourceAudio(db,session,input,original,wav,storage) {
  return receiveSourceAudioWithJournal(sourceAudioJournal(db),session,input,original,wav,audioStore(storage));
}
export function getSourceAudioReceipt(db,session,id) {
  const row=sourceAudioJournal(db).lookup(session,id);
  return row?{found:true,...sourceAudioReceipt(row)}:{found:false,requestId:id};
}
export function listSourceAudio(db,session,filters={}) {
  ensureSourceAudioSchema(db);const {page,pageSize}=sourceAudioPage(filters);
  return transaction(db,()=>{
    scheduleAuthority(db,session);const values=[session.org_id,session.site_id,session.principal_id];
    const where='org_id=? AND site_id=? AND requested_by=? AND received_at IS NOT NULL';
    const total=db.prepare(`SELECT count(*) n FROM source_audio_requests WHERE ${where}`).get(...values).n;
    const items=db.prepare(`SELECT request_id,request_hash,title,status,received_at,briefing_id,
      (SELECT p.request_id FROM source_audio_purges p WHERE p.request_id=source_audio_requests.request_id) AS audio_cleanup_id,
      (SELECT p.completed_at FROM source_audio_purges p WHERE p.request_id=source_audio_requests.request_id) AS audio_removed_at
      FROM source_audio_requests WHERE ${where} ORDER BY received_at DESC,request_id DESC LIMIT ? OFFSET ?`).all(...values,pageSize,(page-1)*pageSize).map(sourceAudioListItem);
    return {items,total,page,pageSize};
  });
}
export async function getSourceAudio(db,session,id,storage,kind='canonical') {
  if(!['canonical','original'].includes(kind))throw Error('Invalid source audio kind');
  const journal=sourceAudioJournal(db),row=journal.lookup(session,id);
  if(!row?.received_at || row.audio_cleanup_id)throw Error('Source audio unavailable');
  const store=audioStore(storage),reference=sourceAudioReferences(row)[kind];
  const bytes=await (kind==='original'?store.readOriginal(reference):store.read(reference));
  if(kind==='original')verifySourceOriginal(reference,bytes);
  else {const info=inspectWav(bytes);if(info.sha256!==reference.sha256 || info.bytes!==reference.bytes)throw Error('Private source integrity check failed');}
  const current=journal.lookup(session,id);
  if(!current?.received_at || current.audio_cleanup_id)throw Error('Source audio unavailable');
  return bytes;
}
