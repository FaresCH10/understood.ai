import { createHash, randomUUID } from 'node:crypto';
import { NOW, transaction } from './db.mjs';
import { activityCsv,reportActivity } from './reports.mjs';
import {reportScope,exportInput,exportRetryInput,exportRequestId} from './report-input.mjs';
import {ensureDeletionSchema} from './deletions.mjs';

export const deletionExportExpiry=`EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id
  WHERE a.publication_id=e.publication_id AND d.org_id=e.org_id AND d.site_id=e.site_id
    AND (e.created_at<=d.created_at OR NOT EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.request_id=d.id)))`;

const MAX_BYTES = 2_000_000;

export function ensureExportSchema(db) {
  ensureDeletionSchema(db);
  const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='report_exports_snapshot_frozen'").get();
  if(trigger && !trigger.sql.includes('worker_deletion_pseudonyms'))db.exec('DROP TRIGGER report_exports_snapshot_frozen');
  db.exec(`CREATE TABLE IF NOT EXISTS report_exports (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
    site_id TEXT NOT NULL REFERENCES sites(id), publication_id TEXT NOT NULL REFERENCES publications(id),
    requested_by TEXT NOT NULL REFERENCES staff(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','processing','ready','failed','expired')),
    snapshot_json TEXT, csv TEXT, checksum TEXT, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
    lease_token TEXT, lease_until TEXT, error TEXT,
    CHECK(snapshot_json IS NULL OR length(snapshot_json)<=2000000), CHECK(csv IS NULL OR length(csv)<=2000000)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_report_exports_scope ON report_exports(org_id,site_id,created_at);
  CREATE INDEX IF NOT EXISTS idx_report_exports_jobs ON report_exports(status,lease_until);
  CREATE TRIGGER IF NOT EXISTS report_exports_scope_insert BEFORE INSERT ON report_exports
  WHEN NOT EXISTS (SELECT 1 FROM publications p WHERE p.id=NEW.publication_id AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id)
    OR NOT EXISTS (SELECT 1 FROM staff s WHERE s.id=NEW.requested_by AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)
  BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS report_exports_snapshot_frozen BEFORE UPDATE ON report_exports
  WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
    OR NEW.publication_id IS NOT OLD.publication_id OR NEW.requested_by IS NOT OLD.requested_by
    OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
    OR (NEW.snapshot_json IS NOT OLD.snapshot_json AND NOT
      (NEW.status='expired' AND NEW.snapshot_json IS NULL AND (OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        OR EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id
          WHERE a.publication_id=OLD.publication_id AND d.org_id=OLD.org_id AND d.site_id=OLD.site_id
            AND (OLD.created_at<=d.created_at OR NOT EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.request_id=d.id))))))
  BEGIN SELECT RAISE(ABORT,'Export snapshot is immutable'); END;`);
  if(!db.prepare('PRAGMA table_info(report_exports)').all().some(row=>row.name==='filters_json'))db.exec(`ALTER TABLE report_exports ADD COLUMN filters_json TEXT NOT NULL DEFAULT '{"crewId":"","responseFrom":"","responseThrough":""}'`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS report_filters_frozen BEFORE UPDATE ON report_exports
    WHEN NEW.filters_json IS NOT OLD.filters_json BEGIN SELECT RAISE(ABORT,'Export filters are immutable'); END;`);
  db.exec(`CREATE TABLE IF NOT EXISTS report_export_retries (
    request_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,site_id TEXT NOT NULL,export_id TEXT NOT NULL REFERENCES report_exports(id),
    requested_by TEXT NOT NULL REFERENCES staff(id),attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 2),created_at TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS export_retry_scope BEFORE INSERT ON report_export_retries
    WHEN NOT EXISTS(SELECT 1 FROM report_exports WHERE id=NEW.export_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
      OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.requested_by AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;`);
  for(const action of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS export_retry_${action.toLowerCase()} BEFORE ${action} ON report_export_retries BEGIN SELECT RAISE(ABORT,'Export retry evidence is immutable'); END;`);
}

function authority(db, session) {
  if (session.principal_type !== 'staff' || !['owner', 'supervisor', 'auditor'].includes(session.role)
    || !db.prepare('SELECT 1 FROM staff WHERE id=? AND org_id=? AND site_id=? AND active=1 AND role=?')
      .get(session.principal_id, session.org_id, session.site_id, session.role)) throw new Error('Forbidden');
}

export function publicExport(row) {
  const filters=typeof row.filters_json==='string'?JSON.parse(row.filters_json):row.filters_json;
  return { id: row.id, status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    attempts: row.attempts, error: row.error, filename: `briefing-activity-${row.id}.csv`,filters:filters??reportScope() };
}

function audit(db, row, actorType, actorId, action) {
  db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)')
    .run(randomUUID(), row.org_id, row.site_id, actorType, actorId, action, row.id, NOW());
}

export function expireExports(db) {
  ensureExportSchema(db);
  return transaction(db, () => {
    const rows = db.prepare(`SELECT e.id,e.org_id,e.site_id,${deletionExportExpiry} AS deletion_expired FROM report_exports e
      WHERE (e.expires_at<=? OR ${deletionExportExpiry}) AND e.status!='expired'`).all(NOW());
    for (const row of rows) {
      db.prepare("UPDATE report_exports SET status='expired',snapshot_json=NULL,csv=NULL,checksum=NULL,lease_token=NULL,lease_until=NULL,error=NULL WHERE id=?").run(row.id);
      audit(db, row, 'system', 'export-worker', row.deletion_expired?'export.deletion_purged':'export.expired');
    }
    return rows.length;
  });
}

export function requestExport(db, session, body) {
  body=exportInput(body);
  ensureExportSchema(db); authority(db, session); expireExports(db);
  const filters=reportScope(body.filters);
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM report_exports WHERE id=?').get(body.requestId);
    if (existing) {
      if (existing.org_id !== session.org_id || existing.site_id !== session.site_id
        || existing.requested_by !== session.principal_id || existing.publication_id !== body.publicationId) throw new Error('Export request ID conflict');
      const {timezone,...oldFilters}=JSON.parse(existing.filters_json);
      if(JSON.stringify(reportScope(oldFilters))!==JSON.stringify(filters))throw Error('Export request ID conflict');
      return { ...publicExport(existing), duplicate: true };
    }
    const publication = db.prepare('SELECT * FROM publications WHERE id=? AND org_id=? AND site_id=?')
      .get(body.publicationId, session.org_id, session.site_id);
    if (!publication) throw new Error('Publication unavailable');
    if(db.prepare(`SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id
      WHERE a.publication_id=? AND NOT EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.request_id=d.id)`).get(publication.id))
      throw new Error('Worker deletion pending');
    const rows = reportActivity(db,session,publication,filters).rows;
    const snapshot = JSON.stringify(rows);
    if (Buffer.byteLength(snapshot) > MAX_BYTES) throw new Error('Report exceeds export limit');
    const now = NOW(), expires = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const timezone=db.prepare('SELECT timezone FROM sites WHERE id=? AND org_id=?').get(session.site_id,session.org_id).timezone;
    db.prepare(`INSERT INTO report_exports(id,org_id,site_id,publication_id,requested_by,created_at,expires_at,status,snapshot_json,filters_json)
      VALUES (?,?,?,?,?,?,?,'queued',?,?)`).run(body.requestId, session.org_id, session.site_id, publication.id, session.principal_id, now, expires, snapshot,JSON.stringify({...filters,timezone}));
    const row = db.prepare('SELECT * FROM report_exports WHERE id=?').get(body.requestId);
    audit(db, row, 'staff', session.principal_id, 'export.requested');
    return { ...publicExport(row), duplicate: false };
  });
}

export function listExports(db, session) {
  ensureExportSchema(db); authority(db, session); expireExports(db);
  return db.prepare('SELECT * FROM report_exports WHERE org_id=? AND site_id=? ORDER BY created_at DESC,id LIMIT 50')
    .all(session.org_id, session.site_id).map(publicExport);
}

function scopedExport(db, session, id) {
  authority(db, session);
  const row = db.prepare('SELECT * FROM report_exports WHERE id=? AND org_id=? AND site_id=?').get(id, session.org_id, session.site_id);
  if (!row) throw new Error('Export unavailable');
  return row;
}

export function exportReceipt(db,session,kind,requestId) {
  if(!['create','retry'].includes(kind))throw Error('Invalid export request');exportRequestId(requestId);
  ensureExportSchema(db);authority(db,session);
  if(kind==='retry') {
    const row=db.prepare('SELECT * FROM report_export_retries WHERE request_id=? AND org_id=? AND site_id=? AND requested_by=?').get(requestId,session.org_id,session.site_id,session.principal_id);
    return row?{found:true,request:{requestId:row.request_id,exportId:row.export_id,attempts:row.attempts},result:{requestId:row.request_id,id:row.export_id,attempts:row.attempts,acceptedAt:row.created_at}}:{found:false};
  }
  const row=db.prepare('SELECT * FROM report_exports WHERE id=? AND org_id=? AND site_id=? AND requested_by=?').get(requestId,session.org_id,session.site_id,session.principal_id);
  if(!row)return {found:false};
  const {timezone,...filters}=JSON.parse(row.filters_json);
  return {found:true,request:{requestId:row.id,publicationId:row.publication_id,filters:reportScope(filters)},result:publicExport(row)};
}

export function retryExport(db, session, id,body) {
  const input=exportRetryInput(id,body);
  ensureExportSchema(db); expireExports(db);
  return transaction(db, () => {
    authority(db,session);
    const saved=exportReceipt(db,session,'retry',input.requestId),old=db.prepare('SELECT * FROM report_export_retries WHERE request_id=?').get(input.requestId);
    if(old){if(!saved.found || JSON.stringify(saved.request)!==JSON.stringify(input))throw Error('Export request ID conflict');return {...saved.result,duplicate:true};}
    const row = scopedExport(db, session, id);
    if (row.status !== 'failed' || row.attempts !== input.attempts || row.attempts >= 3 || !row.snapshot_json) throw new Error('Export cannot be retried');
    db.prepare("UPDATE report_exports SET status='queued',error=NULL WHERE id=?").run(id);
    db.prepare('INSERT INTO report_export_retries VALUES(?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,id,session.principal_id,input.attempts,NOW());
    audit(db, row, 'staff', session.principal_id, 'export.retried');
    return {...exportReceipt(db,session,'retry',input.requestId).result,duplicate:false};
  });
}

export function downloadExport(db, session, id) {
  ensureExportSchema(db); expireExports(db);
  return transaction(db, () => {
    const row = scopedExport(db, session, id);
    if (row.status === 'expired') throw new Error('Export expired');
    if (row.status !== 'ready' || !row.csv) throw new Error('Export is not ready');
    if (createHash('sha256').update(row.csv).digest('hex') !== row.checksum) throw new Error('Export integrity failed');
    audit(db, row, 'staff', session.principal_id, 'export.downloaded');
    return { csv: row.csv, filename: publicExport(row).filename };
  });
}

export function processOneExport(db) {
  ensureExportSchema(db); expireExports(db);
  const lease = randomUUID();
  const row = transaction(db, () => {
    const due = db.prepare(`SELECT * FROM report_exports WHERE expires_at>? AND
      (status='queued' OR (status='processing' AND lease_until<=?)) ORDER BY created_at,id LIMIT 1`).get(NOW(), NOW());
    if (!due) return null;
    if (due.attempts >= 3) {
      db.prepare("UPDATE report_exports SET status='failed',error='Export retry limit reached',lease_token=NULL,lease_until=NULL WHERE id=?").run(due.id);
      audit(db, due, 'system', 'export-worker', 'export.failed');
      return { exhausted: true };
    }
    db.prepare("UPDATE report_exports SET status='processing',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?")
      .run(lease, new Date(Date.now() + 30_000).toISOString(), due.id);
    return due;
  });
  if (!row) return false;
  if (row.exhausted) return true;
  try {
    const csv = exportCsv(JSON.parse(row.snapshot_json));
    transaction(db, () => {
      const active = db.prepare('SELECT 1 FROM staff WHERE id=? AND org_id=? AND site_id=? AND active=1')
        .get(row.requested_by, row.org_id, row.site_id);
      if (!active) throw new Error('Requester unavailable');
      const changed = db.prepare(`UPDATE report_exports SET status='ready',csv=?,checksum=?,error=NULL,lease_token=NULL,lease_until=NULL
        WHERE id=? AND status='processing' AND lease_token=? AND lease_until>? AND expires_at>?`)
        .run(csv, createHash('sha256').update(csv).digest('hex'), row.id, lease, NOW(), NOW());
      if (changed.changes) audit(db, row, 'system', 'export-worker', 'export.ready');
    });
  } catch {
    transaction(db, () => {
      const changed = db.prepare(`UPDATE report_exports SET status='failed',error='Export generation failed',lease_token=NULL,lease_until=NULL
        WHERE id=? AND status='processing' AND lease_token=?`).run(row.id, lease);
      if (changed.changes) audit(db, row, 'system', 'export-worker', 'export.failed');
    });
  }
  return true;
}

export function exportCsv(rows) {
  if (!Array.isArray(rows) || rows.length > 5000 || rows.some((entry) => !Array.isArray(entry) || ![6,8,9].includes(entry.length)
    || entry.some((cell) => !['string', 'number'].includes(typeof cell)))
    || (rows.length>0 && rows.some((entry) => entry.length!==rows[0].length))) throw new Error('Invalid snapshot');
  const csv=activityCsv(rows);
  if (Buffer.byteLength(csv)>MAX_BYTES) throw new Error('Export limit exceeded');
  return csv;
}
