export const INSTRUCTION_RESPONSE_MODES=['question','acknowledge'];
export const INSTRUCTION_DELIVERY_MODES=['text','voice','both'];

const tableExists=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

export function instructionModes(db,briefingId,orgId,siteId) {
  if(!tableExists(db,'instruction_sends')) return {responseMode:'question',deliveryMode:'both'};
  const row=db.prepare('SELECT response_mode,delivery_mode FROM instruction_sends WHERE briefing_id=? AND org_id=? AND site_id=?')
    .get(briefingId,orgId,siteId);
  return row
    ? {responseMode:row.response_mode,deliveryMode:row.delivery_mode}
    : {responseMode:'question',deliveryMode:'both'};
}

export function ensureInstructionSchema(db) {
  const brokenDeliveryFk=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='instruction_deliveries'").get()
    && db.prepare('PRAGMA foreign_key_list(instruction_deliveries)').all()
      .some((row)=>row.table==='workers' && Number(row.seq)>0);
  // A composite worker FK cannot be created without a matching unique index;
  // an empty ledger from such a schema is unusable, so rebuild it in place.
  if(brokenDeliveryFk) db.exec('DROP TABLE instruction_deliveries');
  db.exec(`CREATE TABLE IF NOT EXISTS instruction_sends (
    request_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    site_id TEXT NOT NULL REFERENCES sites(id),
    briefing_id TEXT NOT NULL UNIQUE REFERENCES briefings(id),
    publication_request_id TEXT NOT NULL UNIQUE,
    audience_json TEXT NOT NULL CHECK(json_valid(audience_json) AND json_type(audience_json)='object'),
    response_mode TEXT NOT NULL CHECK(response_mode IN ('question','acknowledge')),
    delivery_mode TEXT NOT NULL CHECK(delivery_mode IN ('text','voice','both')),
    state TEXT NOT NULL CHECK(state IN ('preparing','published','failed')),
    publication_id TEXT REFERENCES publications(id),
    audience_count INTEGER NOT NULL CHECK(audience_count BETWEEN 1 AND 5000),
    delivered INTEGER NOT NULL DEFAULT 0 CHECK(delivered>=0),
    undelivered INTEGER NOT NULL DEFAULT 0 CHECK(undelivered>=0),
    undelivered_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(undelivered_json) AND json_type(undelivered_json)='array'),
    error TEXT,
    request_json TEXT NOT NULL CHECK(json_valid(request_json) AND json_type(request_json)='object'),
    requested_by TEXT NOT NULL REFERENCES staff(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(delivered+undelivered=audience_count),
    CHECK((state='published' AND publication_id IS NOT NULL) OR (state!='published' AND publication_id IS NULL))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_instruction_sends_scope ON instruction_sends(org_id,site_id,created_at DESC);
  CREATE TRIGGER IF NOT EXISTS instruction_send_scope BEFORE INSERT ON instruction_sends
    WHEN NOT EXISTS(SELECT 1 FROM briefings b WHERE b.id=NEW.briefing_id AND b.org_id=NEW.org_id AND b.site_id=NEW.site_id)
      OR NOT EXISTS(SELECT 1 FROM staff s WHERE s.id=NEW.requested_by AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id AND s.active=1)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS instruction_send_publication_scope BEFORE UPDATE ON instruction_sends
    WHEN NEW.publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM publications p WHERE p.id=NEW.publication_id
      AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id AND p.briefing_id=NEW.briefing_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS instruction_send_identity_frozen BEFORE UPDATE ON instruction_sends
    WHEN NEW.request_id IS NOT OLD.request_id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
      OR NEW.briefing_id IS NOT OLD.briefing_id OR NEW.publication_request_id IS NOT OLD.publication_request_id
      OR NEW.audience_json IS NOT OLD.audience_json OR NEW.response_mode IS NOT OLD.response_mode
      OR NEW.delivery_mode IS NOT OLD.delivery_mode OR NEW.audience_count IS NOT OLD.audience_count
      OR NEW.request_json IS NOT OLD.request_json OR NEW.requested_by IS NOT OLD.requested_by OR NEW.created_at IS NOT OLD.created_at
    BEGIN SELECT RAISE(ABORT,'Instruction evidence is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS instruction_send_frozen_delete BEFORE DELETE ON instruction_sends
    BEGIN SELECT RAISE(ABORT,'Instruction evidence is immutable'); END;

  CREATE TABLE IF NOT EXISTS instruction_deliveries (
    request_id TEXT NOT NULL REFERENCES instruction_sends(request_id),
    org_id TEXT NOT NULL REFERENCES organizations(id),
    site_id TEXT NOT NULL REFERENCES sites(id),
    worker_id TEXT NOT NULL,
    language TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('preparing','available','blocked','failed','withdrawn')),
    reason TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
    assignment_id TEXT UNIQUE REFERENCES assignments(id),
    content_json TEXT CHECK(content_json IS NULL OR (json_valid(content_json) AND json_type(content_json)='object')),
    content_hash TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(request_id,worker_id),
    FOREIGN KEY(worker_id) REFERENCES workers(id),
    CHECK((state='available')=(assignment_id IS NOT NULL)),
    CHECK((state='available')=(content_hash IS NOT NULL)),
    CHECK(content_hash IS NULL OR state='available')
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_instruction_deliveries_worker ON instruction_deliveries(worker_id,state);
  CREATE TRIGGER IF NOT EXISTS instruction_delivery_scope BEFORE INSERT ON instruction_deliveries
    WHEN NOT EXISTS(SELECT 1 FROM instruction_sends s WHERE s.request_id=NEW.request_id AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)
      OR NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id)
      OR (NEW.assignment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assignments a JOIN instruction_sends s ON s.publication_id=a.publication_id
        WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id AND a.site_id=NEW.site_id AND s.request_id=NEW.request_id))
    BEGIN SELECT RAISE(ABORT,'Instruction delivery scope mismatch'); END;
  DROP TRIGGER IF EXISTS instruction_delivery_frozen;`);
  // The deletion-table fragment is conditional so this schema stays usable in
  // databases that have not yet installed the deletion modules.
  const deletionAuthority=tableExists(db,'worker_deletion_requests') ? `AND NOT (NEW.content_json='{"title":"[Deleted]","text":"[Deleted]"}' AND EXISTS(
          SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=OLD.worker_id AND d.org_id=OLD.org_id))` : '';
  db.exec(`CREATE TRIGGER instruction_delivery_frozen BEFORE UPDATE ON instruction_deliveries
    WHEN NEW.request_id IS NOT OLD.request_id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
      OR NEW.worker_id IS NOT OLD.worker_id OR NEW.language IS NOT OLD.language
      OR (OLD.assignment_id IS NOT NULL AND NEW.assignment_id IS NOT OLD.assignment_id)
      OR (OLD.content_hash IS NOT NULL AND NEW.content_hash IS NOT OLD.content_hash)
      OR (OLD.content_json IS NOT NULL AND NEW.content_json IS NULL)
      OR (OLD.content_json IS NOT NULL AND NEW.content_json IS NOT NULL AND NEW.content_json IS NOT OLD.content_json
        ${deletionAuthority})
      OR NOT ((OLD.state='preparing' AND NEW.state IN ('preparing','available','blocked','failed'))
        OR (OLD.state IN ('blocked','failed') AND NEW.state IN ('preparing','blocked','failed'))
        OR (OLD.state='available' AND NEW.state='available')
        OR (OLD.state='withdrawn' AND NEW.state='withdrawn'))
    BEGIN SELECT RAISE(ABORT,'Instruction delivery evidence is immutable'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS instruction_delivery_frozen_delete BEFORE DELETE ON instruction_deliveries
    BEGIN SELECT RAISE(ABORT,'Instruction delivery evidence is immutable'); END;

  CREATE TABLE IF NOT EXISTS instruction_retries (
    request_id TEXT PRIMARY KEY,
    send_request_id TEXT NOT NULL REFERENCES instruction_sends(request_id),
    org_id TEXT NOT NULL REFERENCES organizations(id),
    site_id TEXT NOT NULL REFERENCES sites(id),
    requested_by TEXT NOT NULL REFERENCES staff(id),
    generation INTEGER NOT NULL CHECK(generation BETWEEN 0 AND 1000000),
    request_json TEXT NOT NULL CHECK(json_valid(request_json) AND json_type(request_json)='object'),
    created_at TEXT NOT NULL,
    UNIQUE(send_request_id,generation)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS instruction_retry_scope BEFORE INSERT ON instruction_retries
    WHEN NOT EXISTS(SELECT 1 FROM instruction_sends s WHERE s.request_id=NEW.send_request_id AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)
      OR NOT EXISTS(SELECT 1 FROM staff s WHERE s.id=NEW.requested_by AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Instruction retry scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS instruction_retry_frozen BEFORE UPDATE ON instruction_retries
    BEGIN SELECT RAISE(ABORT,'Instruction retry evidence is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS instruction_retry_frozen_delete BEFORE DELETE ON instruction_retries
    BEGIN SELECT RAISE(ABORT,'Instruction retry evidence is immutable'); END;
  DROP TRIGGER IF EXISTS assignment_language_available;
  CREATE TRIGGER assignment_language_available BEFORE INSERT ON assignments
    WHEN NOT EXISTS(SELECT 1 FROM publications p WHERE p.id=NEW.publication_id
      AND json_type(p.snapshot_json,'$.languages.'||NEW.language)='object')
      AND NOT EXISTS(SELECT 1 FROM instruction_deliveries d JOIN instruction_sends s ON s.request_id=d.request_id
        WHERE s.publication_id=NEW.publication_id AND d.org_id=NEW.org_id AND d.site_id=NEW.site_id
          AND d.worker_id=NEW.worker_id AND d.language=NEW.language AND d.state='preparing')
    BEGIN SELECT RAISE(ABORT,'Assignment language unavailable'); END;`);
}
