import {createHash} from 'node:crypto';

export const EVIDENCE_MODES=['none','photo'];
import {EVIDENCE_MAX_BYTES} from './evidence-policy.mjs';
export {EVIDENCE_MAX_BYTES} from './evidence-policy.mjs';

const EVIDENCE_MIME=[['image/jpeg',/^jpeg$/],['image/png',/^png$/],['image/webp',/^webp$/]];
const tableExists=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

function mimeOf(bytes){
  if(bytes.length>=3 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) return 'image/jpeg';
  if(bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(bytes.length>=12 && bytes.subarray(0,4).toString('latin1')==='RIFF' && bytes.subarray(8,12).toString('latin1')==='WEBP') return 'image/webp';
  return null;
}

export function evidencePhoto(photo){
  if(!photo || typeof photo!=='object' || Array.isArray(photo)) throw new Error('Attach a photo as evidence');
  const {mimeType,data}=photo;
  if(typeof mimeType!=='string' || !EVIDENCE_MIME.some(([mime])=>mime===mimeType)) throw new Error('Evidence photo must be a JPEG, PNG or WebP image');
  if(typeof data!=='string' || !data.length || data.length>7_000_000 || data.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    throw new Error('Invalid evidence photo');
  const bytes=Buffer.from(data,'base64');
  if(bytes.length>EVIDENCE_MAX_BYTES) throw new Error('Evidence photo is too large');
  if(!bytes.length || mimeOf(bytes)!==mimeType) throw new Error('Evidence photo does not match its image type');
  return {mime:mimeType,bytes:bytes.length,dataBase64:data,sha256:createHash('sha256').update(bytes).digest('hex')};
}

export function acknowledgmentEvidence(snapshot,photo) {
  if(snapshot?.evidenceMode==='photo' && !photo) throw new Error('Attach a photo as evidence');
  if(snapshot?.evidenceMode!=='photo' && photo!==undefined) throw new Error('This instruction does not request photo evidence');
  return snapshot?.evidenceMode==='photo'?evidencePhoto(photo):null;
}

export function ensureEvidenceSchema(db) {
  const deletionAuthority=tableExists(db,'worker_deletion_requests');
  db.exec(`CREATE TABLE IF NOT EXISTS assignment_evidence (
    request_id TEXT PRIMARY KEY REFERENCES acknowledgments(request_id),
    org_id TEXT NOT NULL REFERENCES organizations(id),
    site_id TEXT NOT NULL REFERENCES sites(id),
    assignment_id TEXT NOT NULL UNIQUE REFERENCES assignments(id),
    worker_id TEXT NOT NULL REFERENCES workers(id),
    mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
    bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 5242880),
    sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    data_base64 TEXT NOT NULL,
    received_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_assignment_evidence_org_time ON assignment_evidence(org_id,received_at);
  CREATE TRIGGER IF NOT EXISTS assignment_evidence_scope BEFORE INSERT ON assignment_evidence
    WHEN NOT EXISTS(SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id
      AND a.site_id=NEW.site_id AND a.worker_id=NEW.worker_id)
      OR NOT EXISTS(SELECT 1 FROM acknowledgments k WHERE k.request_id=NEW.request_id AND k.assignment_id=NEW.assignment_id
        AND k.org_id=NEW.org_id AND k.site_id=NEW.site_id AND k.worker_id=NEW.worker_id)
    BEGIN SELECT RAISE(ABORT,'Evidence scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS assignment_evidence_frozen_update BEFORE UPDATE ON assignment_evidence
    BEGIN SELECT RAISE(ABORT,'Evidence is immutable'); END;
  DROP TRIGGER IF EXISTS assignment_evidence_frozen_delete;
  CREATE TRIGGER assignment_evidence_frozen_delete BEFORE DELETE ON assignment_evidence
    WHEN ${deletionAuthority ? `NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=OLD.worker_id AND d.org_id=OLD.org_id)` : '1'}
    BEGIN SELECT RAISE(ABORT,'Evidence is immutable'); END;`);
}

export function assignmentEvidence(db,orgId,siteId,assignmentId) {
  return db.prepare(`SELECT request_id AS requestId,mime,bytes,sha256,received_at AS receivedAt
    FROM assignment_evidence WHERE assignment_id=? AND org_id=? AND site_id=?`)
    .get(assignmentId,orgId,siteId) || null;
}

export function assignmentEvidenceData(db,orgId,siteId,assignmentId) {
  return db.prepare(`SELECT mime,data_base64 AS dataBase64,received_at AS receivedAt
    FROM assignment_evidence WHERE assignment_id=? AND org_id=? AND site_id=?`)
    .get(assignmentId,orgId,siteId) || null;
}
