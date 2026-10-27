import { randomUUID } from 'node:crypto';
import { NOW, transaction } from './db.mjs';
import {normalizeWorkerLogin} from './worker-credentials-input.mjs';
import {isWorkerLanguage,WORKER_LANGUAGE_CODES,sqlLanguageList} from './languages.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {requireWorkerCapacity} from './worker-capacity.mjs';
import {recordStaffPushEvent,recordWorkerEvent} from './notification-events.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const languageCheck=`language IN (${sqlLanguageList()})`;

export function requirePeopleStaff(db,session) {
  if (session?.principal_type !== 'staff' || !['owner', 'supervisor'].includes(session.role)
    || !db.prepare('SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1')
      .get(session.principal_id,session.org_id,session.site_id,session.role)) throw new Error('Forbidden');
}

export function inputKeys(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('Invalid input');
}

export function name(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,79}$/u.test(text)) throw new Error(`Invalid ${label}`);
  return text;
}

function language(value) {
  if (!isWorkerLanguage(value)) throw new Error('Invalid language');
  return value;
}

function languageRequestNote(value) {
  const note = typeof value === 'string' ? value.trim() : '';
  if (note.length > 500) throw new Error('Invalid language request note');
  return note;
}

function requestReason(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error('Invalid language request reason');
  const reason = value.trim();
  if (reason.length > 500) throw new Error('Invalid language request reason');
  return reason;
}

function requestUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid language request');
  return value;
}

function auditActor(db, session, actorType, action, objectId) {
  const auditId=randomUUID();
  db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(
    auditId, session.org_id, session.site_id, actorType, session.principal_id, action, objectId, NOW(),
  );
  recordStaffPushEvent(db,{orgId:session.org_id,siteId:session.site_id,auditId,action,objectId});
}

function audit(db, session, action, objectId) {
  auditActor(db, session, 'staff', action, objectId);
}

function requireWorkerSelf(db, session) {
  if (session?.principal_type !== 'worker' || typeof session.principal_id !== 'string') throw new Error('Forbidden');
  const row = db.prepare('SELECT * FROM workers WHERE id=? AND org_id=? AND site_id=? AND active=1')
    .get(session.principal_id, session.org_id, session.site_id);
  if (!row) throw new Error('Forbidden');
  return row;
}

function languageRequestRow(row) {
  return { id: row.id, workerId: row.worker_id, workerCode: row.worker_code ?? null,
    workerName: row.worker_name ?? null, currentLanguage: row.current_language,
    requestedLanguage: row.requested_language, reason: row.reason, state: row.state,
    requestedAt: row.requested_at, decidedAt: row.decided_at ?? null,
    decidedBy: row.decided_by ?? null, decisionNote: row.decision_note ?? null,
    ...(row.worker_active === undefined ? {} : { workerActive: !!row.worker_active }) };
}

function expandWorkerLanguageRequestLocales(db) {
  const table=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='worker_language_requests'").get();
  if(!table?.sql || table.sql.includes("'pa-Arab'"))return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`CREATE TABLE worker_language_requests_locale_upgrade (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), worker_id TEXT NOT NULL REFERENCES workers(id),
      current_language TEXT NOT NULL CHECK(current_language IN (${sqlLanguageList()})),
      requested_language TEXT NOT NULL CHECK(requested_language IN (${sqlLanguageList()})),
      reason TEXT NOT NULL DEFAULT '' CHECK(length(reason)<=500),
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
      requested_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT REFERENCES staff(id),
      decision_note TEXT CHECK(decision_note IS NULL OR length(decision_note)<=500),
      CHECK(requested_language<>current_language),
      CHECK((state='pending' AND decided_at IS NULL AND decided_by IS NULL AND decision_note IS NULL)
        OR (state<>'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL))
    ) STRICT`);
    db.exec(`INSERT INTO worker_language_requests_locale_upgrade(id,org_id,site_id,worker_id,current_language,requested_language,
      reason,state,requested_at,decided_at,decided_by,decision_note)
      SELECT id,org_id,site_id,worker_id,current_language,requested_language,reason,state,requested_at,decided_at,decided_by,decision_note
      FROM worker_language_requests`);
    db.exec('DROP TABLE worker_language_requests');
    db.exec('ALTER TABLE worker_language_requests_locale_upgrade RENAME TO worker_language_requests');
    const violations=db.prepare('PRAGMA foreign_key_check').all();
    if(violations.length)throw new Error('Language request locale upgrade broke foreign keys');
    db.exec('COMMIT');
  } catch(error) {
    try{db.exec('ROLLBACK');}catch{}
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function ensurePeopleSchema(db) {
  expandWorkerLanguageRequestLocales(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS crews (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      UNIQUE(org_id,site_id,name)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS crew_memberships (
      worker_id TEXT PRIMARY KEY REFERENCES workers(id),
      org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      crew_id TEXT NOT NULL REFERENCES crews(id), joined_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_crews_scope ON crews(org_id,site_id,active,name);
    CREATE INDEX IF NOT EXISTS idx_crew_memberships_crew ON crew_memberships(crew_id,org_id,site_id);
    CREATE TABLE IF NOT EXISTS directory_reactivations (
      request_id TEXT NOT NULL,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
      worker_id TEXT REFERENCES workers(id),crew_id TEXT REFERENCES crews(id),expected_label TEXT NOT NULL CHECK(length(trim(expected_label)) BETWEEN 2 AND 80),
      requested_by TEXT NOT NULL REFERENCES staff(id),occurred_at TEXT NOT NULL,
      PRIMARY KEY(org_id,site_id,request_id),CHECK((worker_id IS NULL) != (crew_id IS NULL))
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS directory_reactivation_scope BEFORE INSERT ON directory_reactivations
      WHEN NOT EXISTS(SELECT 1 FROM staff s WHERE s.id=NEW.requested_by AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)
        OR (NEW.worker_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id))
        OR (NEW.crew_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crews c WHERE c.id=NEW.crew_id AND c.org_id=NEW.org_id AND c.site_id=NEW.site_id))
      BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS directory_reactivation_frozen_update BEFORE UPDATE ON directory_reactivations
      BEGIN SELECT RAISE(ABORT,'Reactivation receipt is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS directory_reactivation_frozen_delete BEFORE DELETE ON directory_reactivations
      BEGIN SELECT RAISE(ABORT,'Reactivation receipt is immutable'); END;
    CREATE TABLE IF NOT EXISTS worker_language_requests (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), worker_id TEXT NOT NULL REFERENCES workers(id),
      current_language TEXT NOT NULL CHECK(current_language IN (${sqlLanguageList()})),
      requested_language TEXT NOT NULL CHECK(requested_language IN (${sqlLanguageList()})),
      reason TEXT NOT NULL DEFAULT '' CHECK(length(reason)<=500),
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
      requested_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT REFERENCES staff(id),
      decision_note TEXT CHECK(decision_note IS NULL OR length(decision_note)<=500),
      CHECK(requested_language<>current_language),
      CHECK((state='pending' AND decided_at IS NULL AND decided_by IS NULL AND decision_note IS NULL)
        OR (state<>'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL))
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_language_requests_pending
      ON worker_language_requests(org_id,site_id,worker_id) WHERE state='pending';
    CREATE INDEX IF NOT EXISTS idx_worker_language_requests_history
      ON worker_language_requests(org_id,site_id,worker_id,requested_at DESC,id);
    CREATE TRIGGER IF NOT EXISTS worker_language_request_scope_insert BEFORE INSERT ON worker_language_requests
      WHEN NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id)
      BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS worker_language_request_immutable
      BEFORE UPDATE OF id,org_id,site_id,worker_id,current_language,requested_language,requested_at ON worker_language_requests
      WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
        OR NEW.worker_id IS NOT OLD.worker_id OR NEW.current_language IS NOT OLD.current_language
        OR NEW.requested_language IS NOT OLD.requested_language OR NEW.requested_at IS NOT OLD.requested_at
      BEGIN SELECT RAISE(ABORT,'Language request is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS worker_language_request_reason_redaction BEFORE UPDATE OF reason ON worker_language_requests
      WHEN NOT (NEW.reason='[Deleted]' AND OLD.reason<>'[Deleted]'
        AND EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=OLD.worker_id
          AND d.org_id=OLD.org_id AND d.site_id=OLD.site_id))
      BEGIN SELECT RAISE(ABORT,'Language request reason is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS worker_language_request_decision_frozen
      BEFORE UPDATE OF state,decided_at,decided_by,decision_note ON worker_language_requests
      WHEN OLD.state<>'pending' OR NEW.state NOT IN ('approved','rejected')
        OR NEW.decided_at IS NULL OR NEW.decided_by IS NULL
        OR NOT EXISTS(SELECT 1 FROM staff s WHERE s.id=NEW.decided_by AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)
      BEGIN SELECT RAISE(ABORT,'Language request decision conflict'); END;
    DROP TRIGGER IF EXISTS worker_language_request_approval_current;
    CREATE TRIGGER IF NOT EXISTS worker_language_request_approval_current BEFORE UPDATE ON worker_language_requests
      WHEN OLD.state='pending' AND NEW.state='approved' AND NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.worker_id
        AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id AND w.active=1 AND w.language=NEW.current_language
        AND w.language_selection_required=0)
      BEGIN SELECT RAISE(ABORT,'Worker language changed'); END;
    CREATE TRIGGER IF NOT EXISTS worker_language_request_frozen_delete BEFORE DELETE ON worker_language_requests
      BEGIN SELECT RAISE(ABORT,'Language request is immutable'); END;
  `);
  for (const operation of ['INSERT', 'UPDATE']) {
    const op = operation.toLowerCase();
    db.exec(`CREATE TRIGGER IF NOT EXISTS crews_scope_${op}
      BEFORE ${operation} ON crews
      WHEN NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=NEW.site_id AND s.org_id=NEW.org_id)
      BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS crew_memberships_scope_${op}
      BEFORE ${operation} ON crew_memberships
      WHEN NOT EXISTS (SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id)
        OR NOT EXISTS (SELECT 1 FROM crews c WHERE c.id=NEW.crew_id AND c.org_id=NEW.org_id AND c.site_id=NEW.site_id)
      BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;`);
  }
}

const workerSelect = `SELECT w.id,w.org_id,w.site_id,w.code,w.name,w.language,w.language_selection_required,
    w.language_selected_at,w.language_selected_by,w.active,
    lr.id AS pending_request_id,lr.requested_language AS pending_requested_language,
    lr.current_language AS pending_current_language,lr.reason AS pending_reason,lr.requested_at AS pending_requested_at,
    cm.crew_id,c.name AS crew_name FROM workers w
    LEFT JOIN worker_language_requests lr ON lr.worker_id=w.id AND lr.org_id=w.org_id AND lr.site_id=w.site_id AND lr.state='pending'
    LEFT JOIN crew_memberships cm ON cm.worker_id=w.id AND cm.org_id=w.org_id AND cm.site_id=w.site_id
    LEFT JOIN crews c ON c.id=cm.crew_id AND c.org_id=w.org_id AND c.site_id=w.site_id`;

function workerDto(row) {
  const { pending_request_id, pending_requested_language, pending_current_language, pending_reason,
    pending_requested_at, language_selection_required, ...rest } = row;
  return { ...rest, name: row.name ?? null, active: !!row.active,
    language_selection_required: !!language_selection_required,
    language_selected: !language_selection_required,
    language_selected_at: row.language_selected_at ?? null, language_selected_by: row.language_selected_by ?? null,
    pending_language_request: pending_request_id ? { id: pending_request_id, currentLanguage: pending_current_language,
      requestedLanguage: pending_requested_language, reason: pending_reason, requestedAt: pending_requested_at } : null };
}

function workerRow(db, session, id) {
  const row = db.prepare(`${workerSelect} WHERE w.id=? AND w.org_id=? AND w.site_id=?`)
    .get(id, session.org_id, session.site_id);
  if (!row) throw new Error('Worker unavailable');
  return workerDto(row);
}

export function listWorkers(db, session, filters = {}) {
  return transaction(db,() => {
  requirePeopleStaff(db,session);
  const {page,pageSize,search,selectedLanguage,status,crewId,workerId}=workerFilters(filters);
  const where = ['w.org_id=?', 'w.site_id=?'];
  const args = [session.org_id, session.site_id];
  if(workerId!==null){where.push('w.id=?');args.push(workerId);}
  if (search.trim()) {
    where.push('(instr(lower(w.code),lower(?))>0 OR instr(lower(COALESCE(w.name,\'\')),lower(?))>0)');
    args.push(search.trim(), search.trim());
  }
  if (selectedLanguage === 'unset') where.push('w.language_selection_required=1');
  else if (selectedLanguage !== 'all') {
    where.push('w.language=? AND w.language_selection_required=0');
    args.push(selectedLanguage);
  }
  if (status !== 'all') { where.push('w.active=?'); args.push(status === 'active' ? 1 : 0); }
  if(crewId!=='all') {
    if(crewId!=='none') crewRow(db,session,crewId);
    where.push(`${crewId==='none' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM crew_memberships filter_membership
      WHERE filter_membership.worker_id=w.id AND filter_membership.org_id=w.org_id AND filter_membership.site_id=w.site_id${crewId==='none' ? '' : ' AND filter_membership.crew_id=?'})`);
    if(crewId!=='none') args.push(crewId);
  }
  const clause = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM workers w WHERE ${clause}`).get(...args).n;
  const items = db.prepare(`${workerSelect} WHERE ${clause} ORDER BY w.code COLLATE NOCASE,w.id LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize).map(workerDto);
  return { items, total, page, pageSize };
  });
}

export function workerFilters(filters={}) {
  inputKeys(filters, ['search', 'language', 'status', 'page', 'pageSize','crewId','workerId']);
  const page = filters.page === undefined ? 1 : Number(filters.page);
  const pageSize = filters.pageSize === undefined ? 5 : Number(filters.pageSize);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      page > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) throw new Error('Invalid page');
  const search = filters.search === undefined ? '' : filters.search;
  if (typeof search !== 'string' || search.length > 80) throw new Error('Invalid search');
  const selectedLanguage = filters.language ?? 'all';
  if (!['all', ...WORKER_LANGUAGE_CODES, 'unset'].includes(selectedLanguage)) throw new Error('Invalid language');
  const status = filters.status ?? 'active';
  if (!['all', 'active', 'inactive'].includes(status)) throw new Error('Invalid status');
  const crewId=filters.crewId===undefined ? 'all' : filters.crewId;
  if(typeof crewId!=='string' || !crewId || crewId.length>100) throw new Error('Invalid crew');
  const workerId=filters.workerId??null;
  if(workerId!==null && (typeof workerId!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(workerId)))throw Error('Invalid worker');
  return {page,pageSize,search,selectedLanguage,status,crewId,workerId};
}

export function createWorkerInput(input) {
  inputKeys(input, ['code', 'name', 'language']);
  const workerName = input.name === undefined || input.name === null ? null : name(input.name, 'worker name');
  return {
    code: name(input.code, 'worker code'),
    name: workerName,
    ...(input.language === undefined ? {} : { language: language(input.language) }),
  };
}

export function createWorker(db, session, input) {
  requirePeopleStaff(db,session);
  const value = createWorkerInput(input);
  const login = normalizeWorkerLogin(value.code);
  const id = randomUUID();
  transaction(db, () => {
    const now = NOW();
    requireWritableEntitlement(db,session.org_id);
    if (db.prepare('SELECT id FROM workers WHERE org_id=? AND upper(code)=?').get(session.org_id, login)
      || db.prepare('SELECT worker_id FROM worker_credentials WHERE org_id=? AND login_id=?').get(session.org_id, login)) {
      throw new Error('Worker ID already in use');
    }
    requireWorkerCapacity(db, session.org_id);
    if (value.language === undefined) {
      db.prepare(`INSERT INTO workers (id,org_id,site_id,code,name,language,active,language_selection_required)
        VALUES (?,?,?,?,?,'en',1,1)`)
        .run(id, session.org_id, session.site_id, value.code, value.name);
    } else {
      db.prepare(`INSERT INTO workers (id,org_id,site_id,code,name,language,active,language_selection_required,
          language_selected_at,language_selected_by) VALUES (?,?,?,?,?,?,1,0,?,'staff')`)
        .run(id, session.org_id, session.site_id, value.code, value.name, value.language, now);
    }
    audit(db, session, 'worker.created', id);
  });
  return workerRow(db, session, id);
}

export function validateWorkerInput(input) {
  inputKeys(input, ['code', 'language']);
  return { code: name(input.code, 'worker code'), language: language(input.language) };
}

export function updateWorker(db, session, id, input) {
  requirePeopleStaff(db,session);
  inputKeys(input, ['code', 'name', 'language']);
  if (!Object.keys(input).length) throw new Error('Invalid input');
  const before = workerRow(db, session, id);
  const code = input.code === undefined ? before.code : name(input.code, 'worker code');
  const workerName = input.name === undefined ? before.name
    : input.name === null ? null : name(input.name, 'worker name');
  const codeChanged = code !== before.code, nameChanged = workerName !== before.name;
  const requestedLanguage = input.language === undefined ? before.language : language(input.language);
  const languageChanged = requestedLanguage !== before.language;
  const selecting = input.language !== undefined && before.language_selection_required;
  if (codeChanged || nameChanged || languageChanged || selecting) {
    transaction(db, () => {
      const now = NOW();
      if (codeChanged) {
        const login = normalizeWorkerLogin(code);
        if (db.prepare('SELECT id FROM workers WHERE org_id=? AND upper(code)=? AND id<>?').get(session.org_id, login, id)
          || db.prepare('SELECT worker_id FROM worker_credentials WHERE org_id=? AND login_id=? AND worker_id<>?').get(session.org_id, login, id)) {
          throw new Error('Worker ID already in use');
        }
        db.prepare('UPDATE worker_credentials SET login_id=?,updated_at=? WHERE worker_id=? AND org_id=? AND site_id=?')
          .run(login, now, id, session.org_id, session.site_id);
      }
      if (languageChanged || selecting) {
        db.prepare(`UPDATE worker_language_requests SET state='rejected',decided_at=?,decided_by=?,decision_note=?
          WHERE org_id=? AND site_id=? AND worker_id=? AND state='pending'`)
          .run(now, session.principal_id, 'Superseded by direct supervisor correction',
            session.org_id, session.site_id, id);
        db.prepare(`UPDATE workers SET code=?,name=?,language=?,language_selection_required=0,
            language_selected_at=?,language_selected_by='staff' WHERE id=? AND org_id=? AND site_id=?`)
          .run(code, workerName, requestedLanguage, now, id, session.org_id, session.site_id);
        audit(db, session, 'worker.language_corrected', id);
      } else {
        db.prepare('UPDATE workers SET code=?,name=? WHERE id=? AND org_id=? AND site_id=?')
          .run(code, workerName, id, session.org_id, session.site_id);
      }
      if (codeChanged || nameChanged) audit(db, session, 'worker.updated', id);
    });
  }
  return workerRow(db, session, id);
}

export function readWorkerLanguageState(db, session) {
  const worker = requireWorkerSelf(db, session);
  const pending = db.prepare(`SELECT * FROM worker_language_requests
    WHERE org_id=? AND site_id=? AND worker_id=? AND state='pending'`).get(session.org_id, session.site_id, worker.id);
  return { workerId: worker.id, language: worker.language, selected: !worker.language_selection_required,
    selectedAt: worker.language_selected_at ?? null, selectedBy: worker.language_selected_by ?? null,
    pendingRequest: pending ? languageRequestRow(pending) : null };
}

export function workerLanguageState(db, session) {
  return readWorkerLanguageState(db, session);
}

export function selectWorkerLanguageInput(input) {
  inputKeys(input, ['requestId', 'language']);
  return { requestId: requestUuid(input.requestId), language: language(input.language) };
}

export function selectWorkerLanguage(db, session, input) {
  const value = selectWorkerLanguageInput(input);
  return transaction(db, () => {
    const worker = requireWorkerSelf(db, session);
    if (!worker.language_selection_required) {
      if (worker.language_selection_request_id === value.requestId && worker.language === value.language) {
        return { ...readWorkerLanguageState(db, session), duplicate: true };
      }
      throw new Error('Language already selected');
    }
    const now = NOW();
    const changed = db.prepare(`UPDATE workers SET language=?,language_selection_required=0,
      language_selected_at=?,language_selected_by='worker',language_selection_request_id=?
      WHERE id=? AND org_id=? AND site_id=? AND language_selection_required=1`)
      .run(value.language, now, value.requestId, worker.id, session.org_id, session.site_id).changes;
    if (changed !== 1) throw new Error('Language selection conflict');
    auditActor(db, session, 'worker', 'worker.language_selected', worker.id);
    return { ...readWorkerLanguageState(db, session), duplicate: false };
  });
}

export function requestWorkerLanguageInput(input) {
  inputKeys(input, ['requestId', 'language', 'reason']);
  return { requestId: requestUuid(input.requestId), language: language(input.language),
    reason: requestReason(input.reason) };
}

export function requestWorkerLanguage(db, session, input) {
  const value = requestWorkerLanguageInput(input);
  return transaction(db, () => {
    const worker = requireWorkerSelf(db, session);
    if (worker.language_selection_required) throw new Error('Select your language first');
    const old = db.prepare('SELECT * FROM worker_language_requests WHERE id=?').get(value.requestId);
    if (old) {
      if (old.org_id !== session.org_id || old.site_id !== session.site_id || old.worker_id !== worker.id
        || old.requested_language !== value.language || old.reason !== value.reason) {
        throw new Error('Language request conflict');
      }
      return { ...languageRequestRow(old), duplicate: true };
    }
    if (value.language === worker.language) throw new Error('Language already selected');
    if (db.prepare(`SELECT 1 FROM worker_language_requests
      WHERE org_id=? AND site_id=? AND worker_id=? AND state='pending'`)
      .get(session.org_id, session.site_id, worker.id)) throw new Error('Language change already pending');
    const now = NOW();
    db.prepare(`INSERT INTO worker_language_requests
      (id,org_id,site_id,worker_id,current_language,requested_language,reason,state,requested_at,decided_at,decided_by,decision_note)
      VALUES (?,?,?,?,?,?,?,'pending',?,NULL,NULL,NULL)`)
      .run(value.requestId, session.org_id, session.site_id, worker.id, worker.language, value.language, value.reason, now);
    auditActor(db, session, 'worker', 'worker.language_requested', value.requestId);
    const row = db.prepare('SELECT * FROM worker_language_requests WHERE id=?').get(value.requestId);
    return { ...languageRequestRow(row), duplicate: false };
  });
}

export function workerLanguageHistory(db, session) {
  const worker = requireWorkerSelf(db, session);
  return { items: db.prepare(`SELECT * FROM worker_language_requests
    WHERE org_id=? AND site_id=? AND worker_id=? ORDER BY requested_at DESC,id DESC LIMIT 50`)
    .all(session.org_id, session.site_id, worker.id).map(languageRequestRow) };
}

export function staffWorkerLanguageHistory(db, session, workerId) {
  return transaction(db, () => {
    requirePeopleStaff(db, session);
    const worker = workerRow(db, session, workerId);
    const items = db.prepare(`SELECT * FROM worker_language_requests
      WHERE org_id=? AND site_id=? AND worker_id=? ORDER BY requested_at DESC,id DESC LIMIT 50`)
      .all(session.org_id, session.site_id, workerId).map(languageRequestRow);
    return { worker: { id: worker.id, code: worker.code, name: worker.name,
      language: worker.language, languageSelected: worker.language_selected }, items };
  });
}

export function languageRequestFilters(filters = {}) {
  inputKeys(filters, ['status', 'page', 'pageSize']);
  const status = filters.status ?? 'pending';
  if (!['all', 'pending', 'approved', 'rejected'].includes(status)) throw new Error('Invalid language request filter');
  const page = filters.page === undefined ? 1 : Number(filters.page);
  const pageSize = filters.pageSize === undefined ? 20 : Number(filters.pageSize);
  if (!Number.isInteger(page) || page < 1 || page > 5000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('Invalid language request filter');
  }
  return { status, page, pageSize };
}

export function listLanguageRequests(db, session, filters = {}) {
  const { status, page, pageSize } = languageRequestFilters(filters);
  return transaction(db, () => {
    requirePeopleStaff(db, session);
    const where = "r.org_id=? AND r.site_id=? AND (?='all' OR r.state=?)";
    const args = [session.org_id, session.site_id, status, status];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM worker_language_requests r WHERE ${where}`).get(...args).n;
    const items = db.prepare(`SELECT r.*,w.code AS worker_code,w.name AS worker_name,w.active AS worker_active
      FROM worker_language_requests r JOIN workers w ON w.id=r.worker_id AND w.org_id=r.org_id AND w.site_id=r.site_id
      WHERE ${where} ORDER BY r.requested_at DESC,r.id DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize).map(languageRequestRow);
    return { items, total, page, pageSize };
  });
}

export function languageDecisionInput(input) {
  inputKeys(input, ['action', 'expectedRequestedLanguage', 'note']);
  if (!['approve', 'reject'].includes(input.action)) throw new Error('Invalid language decision');
  return { action: input.action, expectedRequestedLanguage: language(input.expectedRequestedLanguage),
    note: languageRequestNote(input.note) };
}

export function decideWorkerLanguageRequest(db, session, id, input) {
  requestUuid(id);
  const value = languageDecisionInput(input);
  return transaction(db, () => {
    requirePeopleStaff(db, session);
    const row = db.prepare(`SELECT r.*,w.code AS worker_code,w.name AS worker_name,w.active AS worker_active,
      w.language AS worker_language,w.language_selection_required
      FROM worker_language_requests r JOIN workers w ON w.id=r.worker_id AND w.org_id=r.org_id AND w.site_id=r.site_id
      WHERE r.id=? AND r.org_id=? AND r.site_id=?`).get(id, session.org_id, session.site_id);
    if (!row) throw new Error('Language request unavailable');
    if (row.requested_language !== value.expectedRequestedLanguage) throw new Error('Language request changed');
    const state = value.action === 'approve' ? 'approved' : 'rejected';
    if (row.state !== 'pending') {
      if (row.state === state && row.decided_by === session.principal_id
        && (row.decision_note ?? '') === value.note) return { ...languageRequestRow(row), duplicate: true };
      throw new Error('Language request already decided');
    }
    if (value.action === 'approve') {
      if (!row.worker_active) throw new Error('Worker unavailable');
      if (row.language_selection_required || row.worker_language !== row.current_language) {
        throw new Error('Worker language changed');
      }
    }
    const now = NOW();
    const changed = db.prepare(`UPDATE worker_language_requests SET state=?,decided_at=?,decided_by=?,decision_note=?
      WHERE id=? AND state='pending'`).run(state, now, session.principal_id, value.note || null, id).changes;
    if (changed !== 1) throw new Error('Language request already decided');
    if (value.action === 'approve') {
      const updated = db.prepare(`UPDATE workers SET language=?,language_selected_at=?,language_selected_by='staff'
        WHERE id=? AND org_id=? AND site_id=? AND language=? AND language_selection_required=0`)
        .run(row.requested_language, now, row.worker_id, session.org_id, session.site_id, row.current_language).changes;
      if (updated !== 1) throw new Error('Worker language changed');
    }
    audit(db, session, value.action === 'approve' ? 'worker.language_request_approved'
      : 'worker.language_request_rejected', id);
    const decisionKind=value.action==='approve'?'language.approved':'language.rejected';
    recordWorkerEvent(db,{orgId:session.org_id,siteId:session.site_id,workerId:row.worker_id,kind:decisionKind,
      objectType:'language_request',objectId:id,dedupeKey:`${decisionKind}:${id}`,now});
    return { ...languageRequestRow(db.prepare('SELECT * FROM worker_language_requests WHERE id=?').get(id)), duplicate: false };
  });
}

export function disableWorker(db, session, id) {
  requirePeopleStaff(db,session);
  return transaction(db, () => {
    const worker = workerRow(db, session, id);
    if (worker.active) {
      const now = NOW();
      db.prepare('UPDATE workers SET active=0 WHERE id=? AND org_id=? AND site_id=?')
        .run(id, session.org_id, session.site_id);
      db.prepare('UPDATE worker_grants SET revoked_at=? WHERE worker_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL')
        .run(now, id, session.org_id, session.site_id);
      db.prepare('UPDATE worker_setup_tokens SET revoked_at=? WHERE worker_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL')
        .run(now, id, session.org_id, session.site_id);
      db.prepare("UPDATE sessions SET revoked_at=? WHERE principal_type='worker' AND principal_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL")
        .run(now, id, session.org_id, session.site_id);
      audit(db, session, 'worker.disabled', id);
    }
    return workerRow(db, session, id);
  });
}

export function reactivationInput(id,input,kind) {
  const label=kind==='worker' ? 'expectedCode' : 'expectedName';
  inputKeys(input,['requestId',label,'confirmed']);
  if(typeof id!=='string' || !id || id.length>100 || input.confirmed!==true
    || typeof input.requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw new Error('Invalid reactivation request');
  return {requestId:input.requestId,expectedLabel:name(input[label],kind==='worker' ? 'worker code' : 'crew name')};
}

export function reactivationReplay(old,id,change,kind) {
  if(!old) return false;
  if(old[`${kind}_id`]!==id || old.expected_label!==change.expectedLabel) throw new Error('Reactivation request conflict');
  return true;
}

function recordReactivation(db,session,id,change,kind) {
  db.prepare('INSERT INTO directory_reactivations VALUES(?,?,?,?,?,?,?,?)')
    .run(change.requestId,session.org_id,session.site_id,kind==='worker' ? id : null,kind==='crew' ? id : null,change.expectedLabel,session.principal_id,NOW());
}

export function reenableWorker(db,session,id,input) {
  const change=reactivationInput(id,input,'worker');
  return transaction(db,() => {
    requirePeopleStaff(db,session);
    const before=workerRow(db,session,id);
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='worker_deletion_requests'").get()
      && db.prepare('SELECT 1 FROM worker_deletion_requests WHERE worker_id=?').get(id))throw new Error('Worker deletion pending');
    const old=db.prepare('SELECT * FROM directory_reactivations WHERE request_id=? AND org_id=? AND site_id=?').get(change.requestId,session.org_id,session.site_id);
    if(reactivationReplay(old,id,change,'worker')) return {...before,duplicate:true};
    requireWritableEntitlement(db,session.org_id);
    if(before.code!==change.expectedLabel) throw new Error('Worker code changed');
    if(!before.active) {
      requireWorkerCapacity(db,session.org_id);
      db.prepare('UPDATE workers SET active=1 WHERE id=? AND org_id=? AND site_id=?').run(id,session.org_id,session.site_id);
      const now=NOW();
      db.prepare('UPDATE worker_grants SET revoked_at=? WHERE worker_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL').run(now,id,session.org_id,session.site_id);
      db.prepare('UPDATE worker_setup_tokens SET revoked_at=? WHERE worker_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL').run(now,id,session.org_id,session.site_id);
      db.prepare("UPDATE sessions SET revoked_at=? WHERE principal_type='worker' AND principal_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL").run(now,id,session.org_id,session.site_id);
      audit(db,session,'worker.reenabled',id);
    }
    recordReactivation(db,session,id,change,'worker');
    return {...workerRow(db,session,id),duplicate:false};
  });
}

export function crewFilters(filters={}) {
  inputKeys(filters,['search','status','page','pageSize']);
  const page=filters.page===undefined ? 1 : Number(filters.page),pageSize=filters.pageSize===undefined ? 5 : Number(filters.pageSize);
  const search=filters.search===undefined ? '' : filters.search,status=filters.status===undefined ? 'all' : filters.status;
  if([filters.page,filters.pageSize].some((value) => value!==undefined && !['number','string'].includes(typeof value)) ||
    !Number.isInteger(page) || page<1 || page>5000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw new Error('Invalid page');
  if(typeof search!=='string' || search.length>80) throw new Error('Invalid search');
  if(!['all','active','inactive'].includes(status)) throw new Error('Invalid status');
  return {page,pageSize,search:search.trim(),status};
}

export function listCrews(db, session, filters={}) {
  const {page,pageSize,search,status}=crewFilters(filters);
  return transaction(db,()=>readCrewPage(db,session,{page,pageSize,search,status}));
}

export function readCrewPage(db,session,{page,pageSize,search,status}) {
    requirePeopleStaff(db,session);
    const where="c.org_id=? AND c.site_id=? AND (?='' OR instr(lower(c.name),lower(?))>0) AND (?='all' OR c.active=?)";
    const args=[session.org_id,session.site_id,search,search,status,status==='active' ? 1 : 0];
    const total=db.prepare(`SELECT COUNT(*) AS n FROM crews c WHERE ${where}`).get(...args).n;
    const items=db.prepare(`SELECT c.id,c.name,c.active,
      (SELECT COUNT(*) FROM crew_memberships cm JOIN workers w ON w.id=cm.worker_id
        AND w.org_id=cm.org_id AND w.site_id=cm.site_id WHERE cm.crew_id=c.id
        AND cm.org_id=c.org_id AND cm.site_id=c.site_id AND w.active=1) AS member_count
      FROM crews c WHERE ${where} ORDER BY c.name COLLATE NOCASE,c.id LIMIT ? OFFSET ?`)
      .all(...args,pageSize,(page-1)*pageSize).map((row) => ({...row,active:!!row.active}));
    return {items,total,page,pageSize};
}

export function crewRecipientId(id,filters={}) {
  inputKeys(filters,[]);
  if(typeof id!=='string' || !id || id.length>100)throw Error('Invalid crew');
  return id;
}

export function listCrewRecipients(db,session,id,filters={}) {
  crewRecipientId(id,filters);
  return transaction(db,()=>{
    requirePeopleStaff(db,session);
    if(session.token_hash!==undefined && !db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND principal_type='staff' AND principal_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL AND expires_at>?`).get(session.token_hash,session.principal_id,session.org_id,session.site_id,NOW()))throw Error('Sign in required');
    const crew=crewRow(db,session,id);
    if(!crew.active)throw Error('Crew unavailable');
    const items=db.prepare(`SELECT w.id,w.code,w.name,w.language,c.name AS crew_name FROM crew_memberships cm
      JOIN crews c ON c.id=cm.crew_id AND c.org_id=cm.org_id AND c.site_id=cm.site_id
      JOIN workers w ON w.id=cm.worker_id AND w.org_id=cm.org_id AND w.site_id=cm.site_id
      WHERE cm.crew_id=? AND cm.org_id=? AND cm.site_id=? AND w.active=1 AND w.language_selection_required=0
      ORDER BY w.code COLLATE NOCASE,w.id LIMIT 5001`).all(id,session.org_id,session.site_id);
    if(items.length>5000)throw Error('Crew recipient limit exceeded');
    return {crew:{id:crew.id,name:crew.name},items,asOf:NOW()};
  });
}

export function createCrew(db, session, input) {
  requirePeopleStaff(db,session);
  inputKeys(input, ['name']);
  const crewName = name(input.name, 'crew name');
  const id = randomUUID();
  transaction(db, () => {
    db.prepare('INSERT INTO crews (id,org_id,site_id,name,active) VALUES (?,?,?,?,1)')
      .run(id, session.org_id, session.site_id, crewName);
    audit(db, session, 'crew.created', id);
  });
  return crewRow(db, session, id);
}

export function crewChangeInput(id, input, action) {
  if (typeof id !== 'string' || !id || id.length > 100) throw new Error('Invalid crew');
  inputKeys(input, action === 'rename' ? ['name', 'expectedName'] : ['expectedName', 'confirmed']);
  const expectedName = name(input.expectedName, 'crew name');
  if (action === 'archive' && input.confirmed !== true) throw new Error('Invalid input');
  return { expectedName, ...(action === 'rename' ? { name: name(input.name, 'crew name') } : {}) };
}

function crewRow(db, session, id) {
  const row = db.prepare(`SELECT c.id,c.org_id,c.site_id,c.name,c.active,
    (SELECT COUNT(*) FROM crew_memberships cm JOIN workers w ON w.id=cm.worker_id
      AND w.org_id=cm.org_id AND w.site_id=cm.site_id WHERE cm.crew_id=c.id
      AND cm.org_id=c.org_id AND cm.site_id=c.site_id AND w.active=1) AS member_count
    FROM crews c WHERE c.id=? AND c.org_id=? AND c.site_id=?`).get(id, session.org_id, session.site_id);
  if (!row) throw new Error('Crew unavailable');
  return { ...row, active: !!row.active };
}

export function getCrew(db,session,id){
  crewRecipientId(id);requirePeopleStaff(db,session);return crewRow(db,session,id);
}

export function renameCrew(db, session, id, input) {
  const change = crewChangeInput(id, input, 'rename');
  return transaction(db, () => {
    requirePeopleStaff(db, session);
    const before = crewRow(db, session, id);
    if (!before.active) throw new Error('Crew is archived');
    if (before.name === change.name) return before;
    if (before.name !== change.expectedName) throw new Error('Crew name changed');
    db.prepare('UPDATE crews SET name=? WHERE id=? AND org_id=? AND site_id=?')
      .run(change.name, id, session.org_id, session.site_id);
    audit(db, session, 'crew.renamed', id);
    return crewRow(db, session, id);
  });
}

export function archiveCrew(db, session, id, input) {
  const change = crewChangeInput(id, input, 'archive');
  return transaction(db, () => {
    requirePeopleStaff(db, session);
    const before = crewRow(db, session, id);
    if (before.name !== change.expectedName) throw new Error('Crew name changed');
    if (before.active) {
      db.prepare('UPDATE crews SET active=0 WHERE id=? AND org_id=? AND site_id=?')
        .run(id, session.org_id, session.site_id);
      audit(db, session, 'crew.archived', id);
    }
    return crewRow(db, session, id);
  });
}

export function restoreCrew(db,session,id,input) {
  const change=reactivationInput(id,input,'crew');
  return transaction(db,() => {
    requirePeopleStaff(db,session);
    const before=crewRow(db,session,id);
    const old=db.prepare('SELECT * FROM directory_reactivations WHERE request_id=? AND org_id=? AND site_id=?').get(change.requestId,session.org_id,session.site_id);
    if(reactivationReplay(old,id,change,'crew')) return {...before,duplicate:true};
    if(before.name!==change.expectedLabel) throw new Error('Crew name changed');
    if(!before.active) {
      db.prepare('UPDATE crews SET active=1 WHERE id=? AND org_id=? AND site_id=?').run(id,session.org_id,session.site_id);
      audit(db,session,'crew.restored',id);
    }
    recordReactivation(db,session,id,change,'crew');
    return {...crewRow(db,session,id),duplicate:false};
  });
}

export function moveWorkerToCrew(db, session, workerId, crewId) {
  requirePeopleStaff(db,session);
  if (crewId !== null && (typeof crewId !== 'string' || !crewId || crewId.length > 100)) throw new Error('Invalid crew');
  return transaction(db, () => {
    const worker = workerRow(db, session, workerId);
    if (!worker.active) throw new Error('Worker unavailable');
    if (crewId !== null && !db.prepare('SELECT 1 FROM crews WHERE id=? AND org_id=? AND site_id=? AND active=1')
      .get(crewId, session.org_id, session.site_id)) throw new Error('Crew unavailable');
    if (worker.crew_id !== crewId) {
      if (crewId === null) db.prepare('DELETE FROM crew_memberships WHERE worker_id=? AND org_id=? AND site_id=?')
        .run(workerId, session.org_id, session.site_id);
      else db.prepare(`INSERT INTO crew_memberships (worker_id,org_id,site_id,crew_id,joined_at) VALUES (?,?,?,?,?)
        ON CONFLICT(worker_id) DO UPDATE SET crew_id=excluded.crew_id,joined_at=excluded.joined_at`)
        .run(workerId, session.org_id, session.site_id, crewId, NOW());
      audit(db, session, 'worker.crew_moved', workerId);
    }
    return workerRow(db, session, workerId);
  });
}
