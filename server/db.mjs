import {ensureWorkspaceSchema} from './workspace-schema.mjs';
import {expandBriefingLanguageRequestCheck,expandGenerationLanguageChecks} from './generation-language-schema.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {createHash} from 'node:crypto';
import {upgradeStaffRoles,ensureStaffSchema} from './staff-schema.mjs';
import {ensureAccountSchema} from './account-schema.mjs';
import {ensureScheduleSchema} from './schedule-schema.mjs';
import {ensureReminderSchema} from './reminder-schema.mjs';
import {ensureSiteSchema} from './site-schema.mjs';
import {ensurePresentationSchema} from './presentation-schema.mjs';
import {ensureEntitlementSchema} from './entitlement-schema.mjs';
import {ensureNotificationEventSchema} from './notification-event-schema.mjs';
import {sqlLanguageList} from './languages.mjs';

export const NOW = () => new Date().toISOString();
const workerLanguageCheck=`language IN (${sqlLanguageList()})`;

function addMissingWorkerColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(workers)').all().map((column) => column.name));
  if (!columns.has('name')) db.exec('ALTER TABLE workers ADD COLUMN name TEXT');
  if (!columns.has('language_selection_required')) {
    db.exec("ALTER TABLE workers ADD COLUMN language_selection_required INTEGER NOT NULL DEFAULT 0 CHECK(language_selection_required IN (0,1))");
  }
  if (!columns.has('language_selected_at')) db.exec('ALTER TABLE workers ADD COLUMN language_selected_at TEXT');
  if (!columns.has('language_selected_by')) {
    db.exec("ALTER TABLE workers ADD COLUMN language_selected_by TEXT CHECK(language_selected_by IN ('worker','staff','migration'))");
  }
  if (!columns.has('language_selection_request_id')) db.exec('ALTER TABLE workers ADD COLUMN language_selection_request_id TEXT');
}

function expandWorkerLanguageCheck(db) {
  const table=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='workers'").get();
  if(!table?.sql || table.sql.includes("'pa-Arab'"))return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`CREATE TABLE workers_language_upgrade (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), code TEXT NOT NULL,
      language TEXT NOT NULL CHECK(${workerLanguageCheck}),
      active INTEGER NOT NULL DEFAULT 1,
      name TEXT,
      language_selection_required INTEGER NOT NULL DEFAULT 0 CHECK(language_selection_required IN (0,1)),
      language_selected_at TEXT,
      language_selected_by TEXT CHECK(language_selected_by IN ('worker','staff','migration')),
      language_selection_request_id TEXT, UNIQUE(org_id, code)
    ) STRICT`);
    db.exec(`INSERT INTO workers_language_upgrade(id,org_id,site_id,code,language,active,name,language_selection_required,
      language_selected_at,language_selected_by,language_selection_request_id)
      SELECT id,org_id,site_id,code,language,active,name,language_selection_required,
      language_selected_at,language_selected_by,language_selection_request_id FROM workers`);
    db.exec('DROP TABLE workers');
    db.exec('ALTER TABLE workers_language_upgrade RENAME TO workers');
    const violations=db.prepare('PRAGMA foreign_key_check').all();
    if(violations.length)throw new Error('Worker language upgrade broke foreign keys');
    db.exec('COMMIT');
  } catch(error) {
    try{db.exec('ROLLBACK');}catch{}
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function expandAssignmentLanguageCheck(db) {
  const table=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='assignments'").get();
  if(!table?.sql || table.sql.includes("'pa-Arab'"))return;
  if(!db.prepare('PRAGMA table_info(assignments)').all().some(column=>column.name==='language'))return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`CREATE TABLE assignments_language_upgrade (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), publication_id TEXT NOT NULL REFERENCES publications(id),
      worker_id TEXT NOT NULL REFERENCES workers(id), due_at TEXT, created_at TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en' CHECK(${workerLanguageCheck}),
      UNIQUE(publication_id, worker_id)
    ) STRICT`);
    db.exec(`INSERT INTO assignments_language_upgrade(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language)
      SELECT id,org_id,site_id,publication_id,worker_id,due_at,created_at,language FROM assignments`);
    db.exec('DROP TABLE assignments');
    db.exec('ALTER TABLE assignments_language_upgrade RENAME TO assignments');
    db.exec('CREATE INDEX IF NOT EXISTS idx_assignments_worker ON assignments(worker_id, publication_id)');
    const violations=db.prepare('PRAGMA foreign_key_check').all();
    if(violations.length)throw new Error('Assignment language upgrade broke foreign keys');
    db.exec('COMMIT');
  } catch(error) {
    try{db.exec('ROLLBACK');}catch{}
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function openDatabase(path = process.env.UNDERSTOOD_DB || 'data/understood.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.function('sha256',{deterministic:true},(value)=>createHash('sha256').update(value).digest('hex'));
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL, timezone TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','administrator','supervisor','auditor')), active INTEGER NOT NULL DEFAULT 1
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), code TEXT NOT NULL,
      language TEXT NOT NULL CHECK(${workerLanguageCheck}),
      active INTEGER NOT NULL DEFAULT 1,
      name TEXT,
      language_selection_required INTEGER NOT NULL DEFAULT 0 CHECK(language_selection_required IN (0,1)),
      language_selected_at TEXT,
      language_selected_by TEXT CHECK(language_selected_by IN ('worker','staff','migration')),
      language_selection_request_id TEXT, UNIQUE(org_id, code)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS briefings (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), title TEXT NOT NULL,
      source TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      next_version INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL CHECK(state IN ('draft','processing','ready','failed')),
      prepared_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS publications (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), briefing_id TEXT NOT NULL REFERENCES briefings(id),
      version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, published_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('published','withdrawn','superseded','archived')),
      UNIQUE(briefing_id, version)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), publication_id TEXT NOT NULL REFERENCES publications(id),
      worker_id TEXT NOT NULL REFERENCES workers(id), due_at TEXT, created_at TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en' CHECK(${workerLanguageCheck}),
      UNIQUE(publication_id, worker_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      assignment_id TEXT NOT NULL REFERENCES assignments(id),
      submission_id TEXT NOT NULL, answer_text TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('matched','clarification','unassessable')),
      reasons_json TEXT NOT NULL, received_at TEXT NOT NULL,
      UNIQUE(assignment_id, submission_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS clarifications (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      assignment_id TEXT NOT NULL REFERENCES assignments(id),
      attempt_id TEXT REFERENCES attempts(id), reason TEXT NOT NULL,
      owner_staff_id TEXT REFERENCES staff(id), status TEXT NOT NULL CHECK(status IN ('open','resolved')),
      notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      UNIQUE(attempt_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), briefing_id TEXT NOT NULL REFERENCES briefings(id),
      revision INTEGER NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','processing','ready','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, due_at TEXT NOT NULL,
      lease_until TEXT, error TEXT, created_at TEXT NOT NULL,
      UNIQUE(briefing_id, revision, kind)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), principal_type TEXT NOT NULL CHECK(principal_type IN ('staff','worker')),
      principal_id TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT,
      grant_id TEXT REFERENCES worker_grants(id),
      access_mode TEXT NOT NULL DEFAULT 'demo' CHECK(access_mode IN ('demo','credential')),
      credential_revision INTEGER CHECK(credential_revision IS NULL OR credential_revision>0)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS staff_credentials (
      staff_id TEXT PRIMARY KEY REFERENCES staff(id), email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
      changed_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS worker_grants (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), worker_id TEXT NOT NULL REFERENCES workers(id),
      token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
      redeemed_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS worker_credentials (
      worker_id TEXT PRIMARY KEY REFERENCES workers(id),
      org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      login_id TEXT NOT NULL CHECK(login_id=trim(login_id) AND length(login_id) BETWEEN 2 AND 80),
      state TEXT NOT NULL CHECK(state IN ('setup','active')),
      password_salt TEXT, password_hash TEXT,
      credential_revision INTEGER NOT NULL DEFAULT 0 CHECK(credential_revision>=0),
      setup_issued_at TEXT, password_changed_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(org_id,login_id),
      CHECK((state='setup' AND password_salt IS NULL AND password_hash IS NULL AND password_changed_at IS NULL)
        OR (state='active' AND length(password_salt)=32 AND length(password_hash)=128 AND password_changed_at IS NOT NULL))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS worker_setup_tokens (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), worker_id TEXT NOT NULL REFERENCES workers(id),
      token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
      expires_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT,
      created_by TEXT NOT NULL REFERENCES staff(id), created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS auth_attempts (
      key_hash TEXT PRIMARY KEY, count INTEGER NOT NULL CHECK(count >= 0),
      window_started_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL, action TEXT NOT NULL, object_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_assignments_worker ON assignments(worker_id, publication_id);
    CREATE INDEX IF NOT EXISTS idx_attempts_assignment ON attempts(assignment_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_clarifications_org_status ON clarifications(org_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_status_due ON jobs(status, due_at);
    CREATE INDEX IF NOT EXISTS idx_worker_grants_worker ON worker_grants(worker_id, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_worker_setup_tokens_worker ON worker_setup_tokens(worker_id, revoked_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_scope_time ON audit(org_id,site_id,occurred_at DESC,id);
    CREATE TRIGGER IF NOT EXISTS audit_frozen_update BEFORE UPDATE ON audit
      BEGIN SELECT RAISE(ABORT,'Audit events are read-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_frozen_delete BEFORE DELETE ON audit
      BEGIN SELECT RAISE(ABORT,'Audit events are read-only'); END;
  `);
  addMissingWorkerColumns(db);
  expandWorkerLanguageCheck(db);
  expandAssignmentLanguageCheck(db);
  upgradeStaffRoles(db,path);
  ensureStaffSchema(db);
  if (!db.prepare("PRAGMA table_info(sessions)").all().some((column) => column.name === 'grant_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN grant_id TEXT REFERENCES worker_grants(id)');
  }
  if (!db.prepare("PRAGMA table_info(sessions)").all().some((column) => column.name === 'access_mode')) {
    db.exec("ALTER TABLE sessions ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'demo' CHECK(access_mode IN ('demo','credential'))");
  }
  if (!db.prepare("PRAGMA table_info(sessions)").all().some((column) => column.name === 'credential_revision')) {
    db.exec('ALTER TABLE sessions ADD COLUMN credential_revision INTEGER CHECK(credential_revision IS NULL OR credential_revision>0)');
  }
  addMissingWorkerColumns(db);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_workers_language_selection_request
      ON workers(language_selection_request_id) WHERE language_selection_request_id IS NOT NULL;
    CREATE TRIGGER IF NOT EXISTS worker_language_selection_receipt_frozen
      BEFORE UPDATE OF language_selection_request_id ON workers
      WHEN OLD.language_selection_request_id IS NOT NULL AND NEW.language_selection_request_id IS NOT OLD.language_selection_request_id
      BEGIN SELECT RAISE(ABORT,'Language selection receipt is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS worker_language_selection_reopen_frozen
      BEFORE UPDATE OF language_selection_required ON workers
      WHEN OLD.language_selection_required=0 AND NEW.language_selection_required=1
      BEGIN SELECT RAISE(ABORT,'Language selection cannot be reopened'); END;`);
  if (!db.prepare('PRAGMA table_info(assignments)').all().some((column) => column.name === 'language')) {
    transaction(db, () => {
      const legacy = db.prepare(`SELECT a.id,w.language,p.snapshot_json FROM assignments a
        JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
        JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id`).all();
      if (legacy.length !== db.prepare('SELECT COUNT(*) AS n FROM assignments').get().n) throw new Error('Legacy assignment scope mismatch');
      const values = legacy.map((row) => {
        const languages = JSON.parse(row.snapshot_json).languages;
        const language = languages?.[row.language] ? row.language : languages?.en ? 'en' : null;
        if (!language) throw new Error('Legacy assignment language unavailable');
        return [language,row.id];
      });
      db.exec(`ALTER TABLE assignments ADD COLUMN language TEXT NOT NULL DEFAULT 'en' CHECK(${workerLanguageCheck})`);
      const update = db.prepare('UPDATE assignments SET language=? WHERE id=?');
      for (const value of values) update.run(...value);
    });
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS assignment_language_frozen BEFORE UPDATE OF language ON assignments
    WHEN NEW.language IS NOT OLD.language BEGIN SELECT RAISE(ABORT,'Assignment language is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS assignment_language_available BEFORE INSERT ON assignments
    WHEN NOT EXISTS(SELECT 1 FROM publications p WHERE p.id=NEW.publication_id
      AND json_type(p.snapshot_json,'$.languages.'||NEW.language)='object')
    BEGIN SELECT RAISE(ABORT,'Assignment language unavailable'); END;
    CREATE TRIGGER IF NOT EXISTS assignment_recipient_language_selected BEFORE INSERT ON assignments
    WHEN NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id
      AND w.language_selection_required=0)
    BEGIN SELECT RAISE(ABORT,'Recipient language not selected'); END;`);
  db.exec(`CREATE TABLE IF NOT EXISTS notification_reads (
    event_id TEXT NOT NULL REFERENCES audit(id),staff_id TEXT NOT NULL REFERENCES staff(id),
    org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),read_at TEXT NOT NULL,
    PRIMARY KEY(event_id,staff_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS notification_reads_staff ON notification_reads(org_id,site_id,staff_id,event_id);
  CREATE TRIGGER IF NOT EXISTS notification_reads_immutable_update BEFORE UPDATE ON notification_reads
    BEGIN SELECT RAISE(ABORT,'Notification read receipt is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS notification_reads_immutable_delete BEFORE DELETE ON notification_reads
    BEGIN SELECT RAISE(ABORT,'Notification read receipt is immutable'); END;`);
  const scopedRelations = {
    notification_reads: `NOT EXISTS (SELECT 1 FROM audit e WHERE e.id=NEW.event_id AND e.org_id=NEW.org_id AND e.site_id=NEW.site_id)
      OR NOT EXISTS (SELECT 1 FROM staff s WHERE s.id=NEW.staff_id AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)`,
    staff: `NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=NEW.site_id AND s.org_id=NEW.org_id)`,
    workers: `NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=NEW.site_id AND s.org_id=NEW.org_id)`,
    briefings: `NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=NEW.site_id AND s.org_id=NEW.org_id)`,
    publications: `NOT EXISTS (SELECT 1 FROM briefings b WHERE b.id=NEW.briefing_id AND b.org_id=NEW.org_id AND b.site_id=NEW.site_id)`,
    assignments: `NOT EXISTS (SELECT 1 FROM publications p WHERE p.id=NEW.publication_id AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id)
      OR NOT EXISTS (SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id)`,
    attempts: `NOT EXISTS (SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id)`,
    clarifications: `NOT EXISTS (SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id)
      OR (NEW.attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM attempts t WHERE t.id=NEW.attempt_id AND t.org_id=NEW.org_id AND t.assignment_id=NEW.assignment_id))
      OR (NEW.owner_staff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff s JOIN assignments a ON a.id=NEW.assignment_id WHERE s.id=NEW.owner_staff_id AND s.org_id=NEW.org_id AND s.site_id=a.site_id))`,
    jobs: `NOT EXISTS (SELECT 1 FROM briefings b WHERE b.id=NEW.briefing_id AND b.org_id=NEW.org_id AND b.site_id=NEW.site_id)`,
    worker_grants: `NOT EXISTS (SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id)`,
    worker_credentials: `NOT EXISTS (SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id)`,
    worker_setup_tokens: `NOT EXISTS (SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id)
      OR NOT EXISTS (SELECT 1 FROM staff s WHERE s.id=NEW.created_by AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)`,
    sessions: `NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=NEW.site_id AND s.org_id=NEW.org_id)
      OR (NEW.principal_type='staff' AND NOT EXISTS (SELECT 1 FROM staff p WHERE p.id=NEW.principal_id AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id))
      OR (NEW.principal_type='worker' AND NOT EXISTS (SELECT 1 FROM workers p WHERE p.id=NEW.principal_id AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id))
      OR (NEW.grant_id IS NOT NULL AND (NEW.principal_type!='worker' OR NOT EXISTS
        (SELECT 1 FROM worker_grants g WHERE g.id=NEW.grant_id AND g.worker_id=NEW.principal_id AND g.org_id=NEW.org_id AND g.site_id=NEW.site_id)))
      OR (NEW.credential_revision IS NOT NULL AND (NEW.principal_type!='worker' OR NEW.grant_id IS NOT NULL
        OR NOT EXISTS (SELECT 1 FROM worker_credentials c WHERE c.worker_id=NEW.principal_id AND c.org_id=NEW.org_id
          AND c.site_id=NEW.site_id AND c.credential_revision=NEW.credential_revision)))`,
    audit: `NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=NEW.site_id AND s.org_id=NEW.org_id)`,
  };
  db.exec('DROP TRIGGER IF EXISTS sessions_scope_insert; DROP TRIGGER IF EXISTS sessions_scope_update;');
  for (const [table, invalid] of Object.entries(scopedRelations)) {
    for (const operation of ['INSERT', 'UPDATE']) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_scope_${operation.toLowerCase()}
        BEFORE ${operation} ON ${table} WHEN ${invalid}
        BEGIN SELECT RAISE(ABORT, 'Scope mismatch'); END;`);
    }
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS worker_credential_identity_frozen
      BEFORE UPDATE OF worker_id,org_id,site_id ON worker_credentials
      WHEN NEW.worker_id IS NOT OLD.worker_id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
      BEGIN SELECT RAISE(ABORT,'Worker credential identity is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS worker_credential_revision_monotonic
      BEFORE UPDATE OF credential_revision ON worker_credentials
      WHEN NEW.credential_revision<OLD.credential_revision
      BEGIN SELECT RAISE(ABORT,'Worker credential revision cannot decrease'); END;
    CREATE TRIGGER IF NOT EXISTS worker_credential_password_replacement
      BEFORE UPDATE OF password_salt,password_hash ON worker_credentials
      WHEN OLD.state='active' AND NEW.state='active'
        AND (NEW.password_salt IS NOT OLD.password_salt OR NEW.password_hash IS NOT OLD.password_hash)
      BEGIN SELECT RAISE(ABORT,'Worker credential change requires setup'); END;
    CREATE TRIGGER IF NOT EXISTS worker_setup_token_immutable
      BEFORE UPDATE ON worker_setup_tokens
      WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
        OR NEW.worker_id IS NOT OLD.worker_id OR NEW.token_hash IS NOT OLD.token_hash
        OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_by IS NOT OLD.created_by
        OR NEW.created_at IS NOT OLD.created_at
        OR (OLD.used_at IS NOT NULL AND NEW.used_at IS NOT OLD.used_at)
        OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
      BEGIN SELECT RAISE(ABORT,'Setup credential is immutable'); END;`);
  ensureAccountSchema(db);
  ensureSiteSchema(db);
  ensureScheduleSchema(db);
  ensureReminderSchema(db);
  ensurePresentationSchema(db);
  ensureEntitlementSchema(db);
  ensureNotificationEventSchema(db);
  ensureWorkspaceSchema(db);
  expandGenerationLanguageChecks(db);
  expandBriefingLanguageRequestCheck(db);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
