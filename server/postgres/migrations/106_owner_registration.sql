CREATE TABLE organization_registrations (
  id text PRIMARY KEY,
  email_hash text NOT NULL UNIQUE CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  payload text CHECK (payload IS NULL OR length(payload) <= 12000),
  state text NOT NULL CHECK (state IN ('pending','verified','ignored','expired')),
  org_id text REFERENCES organizations(id),
  site_id text,
  owner_id text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  resend_count integer NOT NULL DEFAULT 0 CHECK (resend_count BETWEEN 0 AND 5),
  country text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  terms_version text CHECK (terms_version IS NULL OR length(btrim(terms_version)) BETWEEN 1 AND 40),
  privacy_version text CHECK (privacy_version IS NULL OR length(btrim(privacy_version)) BETWEEN 1 AND 40),
  acknowledged_at timestamptz,
  FOREIGN KEY (site_id, org_id) REFERENCES sites(id, org_id),
  FOREIGN KEY (owner_id, org_id, site_id) REFERENCES staff(id, org_id, site_id),
  CHECK ((state = 'pending' AND payload IS NOT NULL AND verified_at IS NULL)
    OR (state = 'verified' AND payload IS NULL AND verified_at IS NOT NULL
      AND org_id IS NOT NULL AND site_id IS NOT NULL AND owner_id IS NOT NULL)
    OR (state IN ('ignored','expired') AND payload IS NULL AND verified_at IS NULL))
);

CREATE TABLE registration_mail (
  id text PRIMARY KEY,
  registration_id text NOT NULL REFERENCES organization_registrations(id),
  email_hash text NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  payload text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  next_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','processing','sent','ignored','failed','expired')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_token text,
  lease_until timestamptz,
  provider_id text,
  CHECK ((state = 'processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (state NOT IN ('sent','ignored','failed','expired') OR payload IS NULL)
);
CREATE INDEX registration_mail_due ON registration_mail(state, next_at, lease_until);

CREATE TABLE registration_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  registration_id text NOT NULL REFERENCES organization_registrations(id),
  mail_id text NOT NULL UNIQUE REFERENCES registration_mail(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz
);

CREATE FUNCTION guard_organization_registration_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.email_hash IS DISTINCT FROM OLD.email_hash
  THEN RAISE EXCEPTION 'Registration identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_registration_identity BEFORE UPDATE ON organization_registrations
  FOR EACH ROW EXECUTE FUNCTION guard_organization_registration_identity();

CREATE FUNCTION guard_organization_registration_verified() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'verified' AND (NEW.state <> 'verified' OR NEW.payload IS NOT NULL
    OR NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.resend_count <> OLD.resend_count)
  THEN RAISE EXCEPTION 'Verified registration is immutable'; END IF;
  IF OLD.payload IS NOT NULL AND NEW.payload IS NOT NULL AND NEW.payload IS DISTINCT FROM OLD.payload
  THEN RAISE EXCEPTION 'Registration payload is immutable'; END IF;
  IF NEW.state = 'verified' AND NOT EXISTS(SELECT 1 FROM staff s
    JOIN sites t ON t.id = NEW.site_id AND t.org_id = NEW.org_id
    WHERE s.id = NEW.owner_id AND s.org_id = NEW.org_id AND s.site_id = NEW.site_id AND s.role = 'owner')
  THEN RAISE EXCEPTION 'Registration scope mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_registration_verified_guard BEFORE UPDATE ON organization_registrations
  FOR EACH ROW EXECUTE FUNCTION guard_organization_registration_verified();

CREATE FUNCTION reject_registration_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Registration is immutable'; END $$;
CREATE TRIGGER organization_registration_no_delete BEFORE DELETE ON organization_registrations
  FOR EACH ROW EXECUTE FUNCTION reject_registration_delete();

CREATE FUNCTION guard_registration_token() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM organization_registrations r WHERE r.id = NEW.registration_id AND r.state = 'pending')
    THEN RAISE EXCEPTION 'Registration token unavailable'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.registration_id IS DISTINCT FROM OLD.registration_id
    OR NEW.mail_id IS DISTINCT FROM OLD.mail_id OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
  THEN RAISE EXCEPTION 'Registration token identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registration_token_guard BEFORE INSERT OR UPDATE ON registration_tokens
  FOR EACH ROW EXECUTE FUNCTION guard_registration_token();
