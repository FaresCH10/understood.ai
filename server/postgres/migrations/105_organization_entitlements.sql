CREATE TABLE organization_entitlements (
  org_id text PRIMARY KEY REFERENCES organizations(id),
  state text NOT NULL CHECK (state IN ('trial','active','read_only')),
  started_at timestamptz NOT NULL,
  ends_at timestamptz,
  worker_limit integer NOT NULL CHECK (worker_limit BETWEEN 1 AND 100000),
  plan text NOT NULL CHECK (length(btrim(plan)) BETWEEN 1 AND 40),
  terms_reference text CHECK (terms_reference IS NULL OR length(btrim(terms_reference)) BETWEEN 1 AND 200),
  revision integer NOT NULL CHECK (revision > 0),
  updated_by text NOT NULL CHECK (length(btrim(updated_by)) BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL,
  CHECK (state <> 'trial' OR ends_at IS NOT NULL)
);

CREATE TABLE organization_entitlement_transitions (
  org_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('trial','active','read_only')),
  started_at timestamptz NOT NULL,
  ends_at timestamptz,
  worker_limit integer NOT NULL CHECK (worker_limit BETWEEN 1 AND 100000),
  plan text NOT NULL CHECK (length(btrim(plan)) BETWEEN 1 AND 40),
  terms_reference text CHECK (terms_reference IS NULL OR length(btrim(terms_reference)) BETWEEN 1 AND 200),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 300),
  actor_type text NOT NULL CHECK (actor_type IN ('operator','system','registration')),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 100),
  request_id text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, revision)
);

CREATE TABLE organization_activation_requests (
  request_id text PRIMARY KEY,
  org_id text NOT NULL,
  site_id text NOT NULL,
  requested_by text NOT NULL,
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
  entitlement_revision integer NOT NULL CHECK (entitlement_revision >= 0),
  state text NOT NULL CHECK (state IN ('pending','accepted','declined')),
  created_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by text,
  decision_ref text,
  FOREIGN KEY (site_id, org_id) REFERENCES sites(id, org_id),
  FOREIGN KEY (requested_by, org_id, site_id) REFERENCES staff(id, org_id, site_id),
  CHECK ((state = 'pending') = (decided_at IS NULL AND decided_by IS NULL))
);
CREATE UNIQUE INDEX organization_activation_requests_pending ON organization_activation_requests(org_id)
  WHERE state = 'pending';

CREATE FUNCTION guard_organization_entitlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Organization entitlement is immutable'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision <> 1 OR NOT EXISTS(SELECT 1 FROM organizations o WHERE o.id=NEW.org_id)
    THEN RAISE EXCEPTION 'Organization entitlement revision conflict'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.revision <> OLD.revision + 1
    OR NEW.updated_at < OLD.updated_at
  THEN RAISE EXCEPTION 'Organization entitlement revision conflict'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_entitlement_guard BEFORE INSERT OR UPDATE OR DELETE ON organization_entitlements
  FOR EACH ROW EXECUTE FUNCTION guard_organization_entitlement();

CREATE FUNCTION guard_organization_entitlement_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Entitlement transition is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM organization_entitlements e WHERE e.org_id=NEW.org_id AND e.revision=NEW.revision
    AND e.state=NEW.state AND e.started_at=NEW.started_at
    AND e.ends_at IS NOT DISTINCT FROM NEW.ends_at AND e.worker_limit=NEW.worker_limit
    AND e.plan=NEW.plan AND e.terms_reference IS NOT DISTINCT FROM NEW.terms_reference)
  THEN RAISE EXCEPTION 'Entitlement transition scope mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_entitlement_transition_guard BEFORE INSERT OR UPDATE OR DELETE ON organization_entitlement_transitions
  FOR EACH ROW EXECUTE FUNCTION guard_organization_entitlement_transition();

CREATE FUNCTION guard_organization_activation_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Activation request is immutable'; END IF;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM staff s WHERE s.id=NEW.requested_by AND s.org_id=NEW.org_id
      AND s.site_id=NEW.site_id AND s.active)
    THEN RAISE EXCEPTION 'Activation request scope mismatch'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'pending'
    OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.note IS DISTINCT FROM OLD.note OR NEW.entitlement_revision <> OLD.entitlement_revision
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.state NOT IN ('accepted','declined')
    OR NEW.decided_at IS NULL OR NEW.decided_by IS NULL
  THEN RAISE EXCEPTION 'Activation request is closed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_activation_request_guard BEFORE INSERT OR UPDATE OR DELETE ON organization_activation_requests
  FOR EACH ROW EXECUTE FUNCTION guard_organization_activation_request();
