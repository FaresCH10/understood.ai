export function ensureEntitlementSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organization_entitlements (
      org_id TEXT PRIMARY KEY REFERENCES organizations(id),
      state TEXT NOT NULL CHECK(state IN ('trial','active','read_only')),
      started_at TEXT NOT NULL,
      ends_at TEXT,
      worker_limit INTEGER NOT NULL CHECK(worker_limit BETWEEN 1 AND 100000),
      plan TEXT NOT NULL CHECK(length(trim(plan)) BETWEEN 1 AND 40),
      terms_reference TEXT CHECK(terms_reference IS NULL OR length(trim(terms_reference)) BETWEEN 1 AND 200),
      revision INTEGER NOT NULL CHECK(revision>0),
      updated_by TEXT NOT NULL CHECK(length(trim(updated_by)) BETWEEN 1 AND 100),
      updated_at TEXT NOT NULL,
      CHECK(state<>'trial' OR ends_at IS NOT NULL)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS organization_entitlement_transitions (
      org_id TEXT NOT NULL REFERENCES organizations(id),
      revision INTEGER NOT NULL CHECK(revision>0),
      state TEXT NOT NULL CHECK(state IN ('trial','active','read_only')),
      started_at TEXT NOT NULL,
      ends_at TEXT,
      worker_limit INTEGER NOT NULL CHECK(worker_limit BETWEEN 1 AND 100000),
      plan TEXT NOT NULL CHECK(length(trim(plan)) BETWEEN 1 AND 40),
      terms_reference TEXT CHECK(terms_reference IS NULL OR length(trim(terms_reference)) BETWEEN 1 AND 200),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 300),
      actor_type TEXT NOT NULL CHECK(actor_type IN ('operator','system','registration')),
      actor_id TEXT NOT NULL CHECK(length(trim(actor_id)) BETWEEN 1 AND 100),
      request_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(org_id,revision)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS organization_activation_requests (
      request_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      requested_by TEXT NOT NULL,
      note TEXT CHECK(note IS NULL OR length(trim(note)) BETWEEN 1 AND 500),
      entitlement_revision INTEGER NOT NULL CHECK(entitlement_revision>=0),
      state TEXT NOT NULL CHECK(state IN ('pending','accepted','declined')),
      created_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT,
      decision_ref TEXT,
      CHECK((state='pending')=(decided_at IS NULL AND decided_by IS NULL))
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS organization_activation_requests_pending
      ON organization_activation_requests(org_id) WHERE state='pending';

    CREATE TRIGGER IF NOT EXISTS organization_entitlement_insert_guard BEFORE INSERT ON organization_entitlements
      WHEN NEW.revision<>1
      BEGIN SELECT RAISE(ABORT,'Entitlement revision conflict'); END;
    CREATE TRIGGER IF NOT EXISTS organization_entitlement_update_guard BEFORE UPDATE ON organization_entitlements
      WHEN NEW.org_id<>OLD.org_id OR NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at
      BEGIN SELECT RAISE(ABORT,'Entitlement revision conflict'); END;
    CREATE TRIGGER IF NOT EXISTS organization_entitlement_no_delete BEFORE DELETE ON organization_entitlements
      BEGIN SELECT RAISE(ABORT,'Organization entitlement is immutable'); END;

    CREATE TRIGGER IF NOT EXISTS organization_entitlement_transition_guard BEFORE INSERT ON organization_entitlement_transitions
      WHEN NOT EXISTS (
        SELECT 1 FROM organization_entitlements e WHERE e.org_id=NEW.org_id AND e.revision=NEW.revision
          AND e.state=NEW.state AND e.started_at=NEW.started_at
          AND (e.ends_at IS NEW.ends_at) AND e.worker_limit=NEW.worker_limit
          AND e.plan=NEW.plan AND (e.terms_reference IS NEW.terms_reference))
      BEGIN SELECT RAISE(ABORT,'Entitlement transition scope mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS organization_entitlement_transition_immutable BEFORE UPDATE ON organization_entitlement_transitions
      BEGIN SELECT RAISE(ABORT,'Entitlement transition is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS organization_entitlement_transition_no_delete BEFORE DELETE ON organization_entitlement_transitions
      BEGIN SELECT RAISE(ABORT,'Entitlement transition is immutable'); END;

    CREATE TRIGGER IF NOT EXISTS organization_activation_request_scope BEFORE INSERT ON organization_activation_requests
      WHEN NOT EXISTS (
        SELECT 1 FROM staff s WHERE s.id=NEW.requested_by AND s.org_id=NEW.org_id
          AND s.site_id=NEW.site_id AND s.active=1)
      BEGIN SELECT RAISE(ABORT,'Activation request scope mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS organization_activation_request_closed BEFORE UPDATE ON organization_activation_requests
      WHEN OLD.state<>'pending'
        OR NEW.request_id<>OLD.request_id OR NEW.org_id<>OLD.org_id OR NEW.site_id<>OLD.site_id
        OR NEW.requested_by<>OLD.requested_by OR (NEW.note IS NOT OLD.note)
        OR NEW.entitlement_revision<>OLD.entitlement_revision OR NEW.created_at<>OLD.created_at
        OR NEW.state NOT IN ('accepted','declined')
        OR NEW.decided_at IS NULL OR NEW.decided_by IS NULL
      BEGIN SELECT RAISE(ABORT,'Activation request is closed'); END;
    CREATE TRIGGER IF NOT EXISTS organization_activation_request_no_delete BEFORE DELETE ON organization_activation_requests
      BEGIN SELECT RAISE(ABORT,'Activation request is immutable'); END;
  `);
}
