import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { NOW, transaction } from './db.mjs';
import { ensurePeopleSchema, validateWorkerInput } from './people.mjs';
import { csvCell } from './reports.mjs';
import {ensureDeletionSchema} from './deletions.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {requireWorkerCapacity} from './worker-capacity.mjs';

const deletionImportExpiry=`EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN workers w ON w.id=d.worker_id
  WHERE d.org_id=i.org_id AND (instr(i.filename,w.code)>0 OR EXISTS(
    SELECT 1 FROM json_each(COALESCE(i.rows_json,'[]')) entry WHERE json_extract(entry.value,'$.workerId')=w.code)))`;

export const importFilenameHash=(filename)=>createHash('sha256').update(filename).digest('hex');
export const importFilenameMatches=(row,filename)=>row.filename_hash ? row.filename_hash===importFilenameHash(filename) : row.filename===filename;

export function importLabelHashes(rows,filename=''){
  const hashes=new Set(rows.map((row)=>importFilenameHash(row.workerId))),chars=Array.from(filename);
  // Filenames are bounded to 120 characters; match reserved labels without retaining their plaintext.
  for(let start=0;start<chars.length;start++)if(/^[\p{L}\p{N}]$/u.test(chars[start])){
    let candidate='';
    for(let end=start;end<chars.length;end++){
      candidate+=chars[end];if(candidate.length>80)break;
      if(candidate.length>=2)hashes.add(importFilenameHash(candidate));
    }
  }
  return [...hashes];
}

const MAX_BYTES = 256 * 1024;
const MAX_ROWS = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ensureWorkerImportSchema(db) {
  ensurePeopleSchema(db);
  ensureDeletionSchema(db);
  const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='worker_imports_snapshot_frozen'").get();
  if(trigger && !trigger.sql.includes('filename_hash'))db.exec('DROP TRIGGER worker_imports_snapshot_frozen');
  db.exec(`CREATE TABLE IF NOT EXISTS worker_imports (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), site_id TEXT NOT NULL REFERENCES sites(id),
    requested_by TEXT NOT NULL REFERENCES staff(id), filename TEXT NOT NULL, sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('validated','imported','expired')),
    rows_json TEXT, errors_json TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, imported_count INTEGER NOT NULL DEFAULT 0,
    filename_hash TEXT CHECK(filename_hash IS NULL OR (length(filename_hash)=64 AND filename_hash NOT GLOB '*[^0-9a-f]*'))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_worker_imports_expiry ON worker_imports(expires_at,status);
  CREATE TRIGGER IF NOT EXISTS worker_imports_scope_insert BEFORE INSERT ON worker_imports
  WHEN NOT EXISTS (SELECT 1 FROM staff s WHERE s.id=NEW.requested_by AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)
  BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  `);
  if(!db.prepare('PRAGMA table_info(worker_imports)').all().some((column)=>column.name==='filename_hash'))
    db.exec("ALTER TABLE worker_imports ADD COLUMN filename_hash TEXT CHECK(filename_hash IS NULL OR (length(filename_hash)=64 AND filename_hash NOT GLOB '*[^0-9a-f]*'))");
  db.exec(`CREATE TRIGGER IF NOT EXISTS worker_imports_snapshot_frozen BEFORE UPDATE ON worker_imports
  WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
    OR NEW.requested_by IS NOT OLD.requested_by OR NEW.sha256 IS NOT OLD.sha256
    OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
    OR ((NEW.filename IS NOT OLD.filename OR NEW.filename_hash IS NOT OLD.filename_hash) AND NOT (
      OLD.filename_hash IS NULL AND NEW.filename='[Deleted].csv' AND NEW.filename_hash IS NOT NULL
      AND NEW.status='expired' AND NEW.rows_json IS NULL AND NEW.errors_json IS NULL AND NEW.imported_count IS OLD.imported_count AND EXISTS(
        SELECT 1 FROM worker_deletion_requests d JOIN workers w ON w.id=d.worker_id WHERE d.org_id=OLD.org_id
        AND (instr(OLD.filename,w.code)>0 OR EXISTS(SELECT 1 FROM json_each(COALESCE(OLD.rows_json,'[]')) entry
          WHERE json_extract(entry.value,'$.workerId')=w.code)))))
    OR (OLD.filename_hash IS NOT NULL AND (NEW.status<>'expired' OR NEW.rows_json IS NOT NULL
      OR NEW.errors_json IS NOT NULL OR NEW.imported_count IS NOT OLD.imported_count))
    OR (NEW.rows_json IS NOT OLD.rows_json AND NOT (NEW.status='expired' AND NEW.rows_json IS NULL
      AND (OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR EXISTS(
        SELECT 1 FROM worker_deletion_requests d JOIN workers w ON w.id=d.worker_id WHERE d.org_id=OLD.org_id
        AND (instr(OLD.filename,w.code)>0 OR EXISTS(SELECT 1 FROM json_each(COALESCE(OLD.rows_json,'[]')) entry
          WHERE json_extract(entry.value,'$.workerId')=w.code))))))
  BEGIN SELECT RAISE(ABORT,'Import snapshot is immutable'); END;`);
}

function authority(db, session) {
  if (session.principal_type !== 'staff' || !['owner', 'supervisor'].includes(session.role)
    || !db.prepare('SELECT 1 FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1')
      .get(session.principal_id, session.org_id, session.site_id, session.role)) throw new Error('Forbidden');
}

function audit(db, session, action, id) {
  db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), session.org_id, session.site_id, 'staff', session.principal_id, action, id, NOW());
}

export async function readImportBytes(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('CSV exceeds 256 KiB limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function expireWorkerImports(db) {
  ensureWorkerImportSchema(db);
  return transaction(db, () => {
    const rows = db.prepare(`SELECT i.id,i.org_id,i.site_id,i.filename,${deletionImportExpiry} AS deletion_expired FROM worker_imports i
      WHERE (i.expires_at<=? AND i.status!='expired') OR (${deletionImportExpiry} AND i.filename_hash IS NULL)`).all(NOW());
    for (const row of rows) {
      if(row.deletion_expired)db.prepare("UPDATE worker_imports SET status='expired',rows_json=NULL,errors_json=NULL,filename='[Deleted].csv',filename_hash=? WHERE id=?")
        .run(importFilenameHash(row.filename),row.id);
      else db.prepare("UPDATE worker_imports SET status='expired',rows_json=NULL,errors_json=NULL WHERE id=?").run(row.id);
      db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), row.org_id, row.site_id, 'system', 'import-worker', row.deletion_expired?'workers.import_deletion_purged':'workers.import_expired', row.id, NOW());
    }
    return rows.length;
  });
}

function revalidate(db, session, rows,filename='') {
  for(const hash of importLabelHashes(rows,filename))if(db.prepare('SELECT 1 FROM worker_deletion_pseudonyms WHERE org_id=? AND code_hash=?')
    .get(session.org_id,hash))throw new Error('CSV contains unavailable worker IDs');
  const seen = new Set();
  return rows.map((row) => {
    const errors = [];
    try { validateWorkerInput({ code: row.workerId, language: row.language }); }
    catch (err) { errors.push(err.message); }
    if (seen.has(row.workerId)) errors.push('Duplicate worker ID in file');
    seen.add(row.workerId);
    // Worker IDs are organization-unique; do not disclose the conflicting site's identity.
    if (db.prepare('SELECT 1 FROM workers WHERE org_id=? AND code=?').get(session.org_id, row.workerId)) errors.push('Worker ID already exists');
    if (row.crew && !db.prepare('SELECT 1 FROM crews WHERE org_id=? AND site_id=? AND name=? AND active=1')
      .get(session.org_id, session.site_id, row.crew)) errors.push('Crew is not available at this site');
    return { ...row, errors, valid: !errors.length };
  });
}

export function publicImport(row, rows, errors) {
  return { id: row.id, filename: row.filename, sha256: row.sha256, filenameHash: row.filename_hash || importFilenameHash(row.filename), status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    totalRows: rows.length, validRows: rows.filter((entry) => entry.valid).length,
    invalidRows: rows.filter((entry) => !entry.valid).length, rows, errors, imported: row.imported_count };
}

function scopedRow(db, session, id) {
  authority(db, session);
  const row = db.prepare('SELECT * FROM worker_imports WHERE id=? AND org_id=? AND site_id=?').get(id, session.org_id, session.site_id);
  if (!row) throw new Error('Import unavailable');
  return row;
}

export function getWorkerImport(db, session, id) {
  ensureWorkerImportSchema(db); authority(db, session); expireWorkerImports(db);
  const row = scopedRow(db, session, id);
  const rows = row.rows_json ? JSON.parse(row.rows_json) : [];
  const errors = row.errors_json ? JSON.parse(row.errors_json) : [];
  return publicImport(row, row.status === 'validated' ? revalidate(db, session, rows) : rows, errors);
}

export function importInput({requestId,filename,bytes}={}) {
  if (typeof requestId !== 'string' || !UUID.test(requestId) || typeof filename !== 'string'
    || !/^[^/\\\u0000-\u001f]{1,116}\.csv$/i.test(filename)) throw new Error('Invalid CSV request');
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw new Error('CSV must contain 1 byte to 256 KiB');
  return {requestId,filename,bytes,sha:createHash('sha256').update(bytes).digest('hex')};
}

export function parseWorkerCsv(bytes) {
  const errors = []; let rows = [];
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const records = parse(text, { bom: true, skip_empty_lines: true, trim: true, max_record_size: 4096 });
    const header = records.shift();
    if (!header || ![JSON.stringify(['worker_id', 'language']), JSON.stringify(['worker_id', 'language', 'crew'])].includes(JSON.stringify(header))) throw new Error('Header must be worker_id,language with optional crew column');
    if (!records.length || records.length > MAX_ROWS) throw new Error('CSV must contain 1 to 1,000 worker rows');
    rows = records.map((cells, index) => ({ row: index + 2,
      workerId: cells[0].trim(), language: cells[1].trim(), crew: (cells[2] || '').trim() }));
  } catch (err) {
    errors.push(err.code === 'ERR_ENCODING_INVALID_ENCODED_DATA' ? 'CSV must use UTF-8 encoding'
      : err.code ? 'Malformed CSV: check quoting, column counts and field lengths' : err.message);
  }
  return {rows,errors};
}

export function previewWorkerImport(db, session, input) {
  ensureWorkerImportSchema(db); authority(db, session); expireWorkerImports(db);
  const {requestId,filename,bytes,sha}=importInput(input);
  const old = db.prepare('SELECT * FROM worker_imports WHERE id=?').get(requestId);
  if (old) {
    if (old.org_id !== session.org_id || old.site_id !== session.site_id || old.requested_by !== session.principal_id
      || old.sha256 !== sha || !importFilenameMatches(old,filename)) throw new Error('Import request ID conflict');
    return { ...getWorkerImport(db, session, requestId), duplicate: true };
  }
  const parsed=parseWorkerCsv(bytes),errors=parsed.errors;
  transaction(db, () => {
    const rows=revalidate(db,session,parsed.rows,filename);
    const now = NOW();
    db.prepare(`INSERT INTO worker_imports(id,org_id,site_id,requested_by,filename,sha256,status,rows_json,errors_json,created_at,expires_at)
      VALUES (?,?,?,?,?,?,'validated',?,?,?,?)`).run(requestId, session.org_id, session.site_id, session.principal_id,
        filename, sha, JSON.stringify(rows), JSON.stringify(errors), now, new Date(Date.now() + 24 * 60 * 60_000).toISOString());
    audit(db, session, 'workers.import_validated', requestId);
  });
  return getWorkerImport(db, session, requestId);
}

export function confirmWorkerImport(db, session, id) {
  ensureWorkerImportSchema(db); authority(db, session); expireWorkerImports(db);
  return transaction(db, () => {
    const row = scopedRow(db, session, id);
    if (row.status === 'imported') return { id, status: 'imported', imported: row.imported_count, duplicate: true };
    if (row.status === 'expired') throw new Error('Import expired');
    requireWritableEntitlement(db, session.org_id);
    const rows = revalidate(db, session, JSON.parse(row.rows_json));
    if (JSON.parse(row.errors_json).length || !rows.length || rows.some((entry) => !entry.valid)) throw new Error('Fix CSV errors before importing');
    requireWorkerCapacity(db, session.org_id, rows.length);
    const insertWorker = db.prepare('INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES (?,?,?,?,?,1)');
    for (const entry of rows) {
      const workerId = randomUUID();
      insertWorker.run(workerId, session.org_id, session.site_id, entry.workerId, entry.language);
      if (entry.crew) {
        const crew = db.prepare('SELECT id FROM crews WHERE org_id=? AND site_id=? AND name=? AND active=1').get(session.org_id, session.site_id, entry.crew);
        db.prepare('INSERT INTO crew_memberships(worker_id,org_id,site_id,crew_id,joined_at) VALUES (?,?,?,?,?)')
          .run(workerId, session.org_id, session.site_id, crew.id, NOW());
      }
    }
    db.prepare("UPDATE worker_imports SET status='imported',imported_count=? WHERE id=?").run(rows.length, id);
    audit(db, session, 'workers.imported', id);
    return { id, status: 'imported', imported: rows.length, duplicate: false };
  });
}

export function workerImportErrorsCsv(db, session, id) {
  const preview = getWorkerImport(db, session, id);
  const csv=importErrorsCsv(preview);
  audit(db, session, 'workers.import_errors_downloaded', id);
  return csv;
}

export function importErrorsCsv(preview) {
  if (preview.status === 'expired') throw new Error('Import expired');
  const rows = [['row', 'worker_id', 'language', 'crew', 'notes'], ...preview.rows.filter((row) => !row.valid)
    .map((row) => [row.row, row.workerId, row.language, row.crew, row.errors.join('; ')]),
    ...preview.errors.map((error) => ['', '', '', '', error])];
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
