-- Worker password credentials, one-time setup/reset codes, and revision-bound sessions.

ALTER TABLE sessions ADD COLUMN credential_revision integer CHECK (credential_revision IS NULL OR credential_revision > 0);
ALTER TABLE sessions DROP CONSTRAINT sessions_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_identity_check CHECK (
  (principal_type = 'staff' AND grant_id IS NULL AND credential_revision IS NULL)
  OR (principal_type = 'worker' AND (
    (access_mode = 'demo' AND grant_id IS NULL AND credential_revision IS NULL)
    OR (access_mode = 'credential' AND (grant_id IS NOT NULL) <> (credential_revision IS NOT NULL)))));

CREATE TABLE worker_credentials (
  worker_id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  site_id text NOT NULL,
  login_id text NOT NULL CHECK (login_id = trim(login_id) AND length(login_id) BETWEEN 2 AND 80),
  state text NOT NULL CHECK (state IN ('setup', 'active')),
  password_salt text,
  password_hash text,
  credential_revision integer NOT NULL DEFAULT 0 CHECK (credential_revision >= 0),
  setup_issued_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, login_id),
  FOREIGN KEY (worker_id, org_id, site_id) REFERENCES workers(id, org_id, site_id),
  CHECK ((state = 'setup' AND password_salt IS NULL AND password_hash IS NULL AND password_changed_at IS NULL)
    OR (state = 'active' AND password_salt ~ '^[0-9a-f]{32}$' AND password_hash ~ '^[0-9a-f]{128}$'
      AND password_changed_at IS NOT NULL))
);

CREATE TABLE worker_setup_tokens (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  site_id text NOT NULL,
  worker_id text NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (worker_id, org_id, site_id) REFERENCES workers(id, org_id, site_id),
  FOREIGN KEY (created_by, org_id, site_id) REFERENCES staff(id, org_id, site_id)
);
CREATE INDEX worker_setup_tokens_worker ON worker_setup_tokens(worker_id, revoked_at, created_at);

CREATE FUNCTION guard_worker_credential() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.worker_id, NEW.org_id, NEW.site_id) IS DISTINCT FROM (OLD.worker_id, OLD.org_id, OLD.site_id) THEN
    RAISE EXCEPTION 'Worker credential identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.credential_revision < OLD.credential_revision THEN
    RAISE EXCEPTION 'Worker credential revision cannot decrease' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'active' AND NEW.state = 'active'
    AND (NEW.password_salt, NEW.password_hash) IS DISTINCT FROM (OLD.password_salt, OLD.password_hash) THEN
    RAISE EXCEPTION 'Worker credential change requires setup' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER worker_credential_guard BEFORE INSERT OR UPDATE ON worker_credentials
  FOR EACH ROW EXECUTE FUNCTION guard_worker_credential();

CREATE FUNCTION guard_worker_setup_token() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.org_id, NEW.site_id, NEW.worker_id, NEW.token_hash, NEW.expires_at, NEW.created_by, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.org_id, OLD.site_id, OLD.worker_id, OLD.token_hash, OLD.expires_at, OLD.created_by, OLD.created_at)
      OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION 'Setup credential is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER worker_setup_token_guard BEFORE INSERT OR UPDATE ON worker_setup_tokens
  FOR EACH ROW EXECUTE FUNCTION guard_worker_setup_token();

CREATE FUNCTION check_session_worker_credential() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.credential_revision IS NOT NULL THEN
    IF NEW.principal_type <> 'worker' OR NEW.grant_id IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM worker_credentials c WHERE c.worker_id = NEW.principal_id
        AND c.org_id = NEW.org_id AND c.site_id = NEW.site_id AND c.credential_revision = NEW.credential_revision) THEN
      RAISE EXCEPTION 'Scope mismatch' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sessions_worker_credential BEFORE INSERT OR UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION check_session_worker_credential();
