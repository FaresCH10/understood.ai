-- Worker display names, persisted first-use language selection and a supervisor-reviewed change ledger.

ALTER TABLE workers ADD COLUMN name text CHECK (name IS NULL OR (name=trim(name) AND length(name) BETWEEN 2 AND 80));
ALTER TABLE workers ADD COLUMN language_selection_required boolean NOT NULL DEFAULT false;
ALTER TABLE workers ADD COLUMN language_selected_at timestamptz;
ALTER TABLE workers ADD COLUMN language_selected_by text CHECK (language_selected_by IN ('worker','staff','migration'));
ALTER TABLE workers ADD COLUMN language_selection_request_id text;
CREATE UNIQUE INDEX workers_language_selection_request
  ON workers(language_selection_request_id) WHERE language_selection_request_id IS NOT NULL;

CREATE TABLE worker_language_requests (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  site_id text NOT NULL,
  worker_id text NOT NULL,
  current_language text NOT NULL CHECK (current_language IN ('en','ar','ur')),
  requested_language text NOT NULL CHECK (requested_language IN ('en','ar','ur')),
  reason text NOT NULL DEFAULT '' CHECK (length(reason)<=500),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
  requested_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by text,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note)<=500),
  CHECK (requested_language<>current_language),
  CHECK ((state='pending' AND decided_at IS NULL AND decided_by IS NULL AND decision_note IS NULL)
    OR (state<>'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  FOREIGN KEY (worker_id,org_id,site_id) REFERENCES workers(id,org_id,site_id),
  FOREIGN KEY (decided_by,org_id,site_id) REFERENCES staff(id,org_id,site_id)
);
CREATE UNIQUE INDEX worker_language_requests_pending
  ON worker_language_requests(org_id,site_id,worker_id) WHERE state='pending';
CREATE INDEX worker_language_requests_history
  ON worker_language_requests(org_id,site_id,worker_id,requested_at DESC,id);

CREATE FUNCTION guard_worker_language_selection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.language_selection_request_id IS NOT NULL
    AND NEW.language_selection_request_id IS DISTINCT FROM OLD.language_selection_request_id THEN
    RAISE EXCEPTION 'Language selection receipt is immutable' USING ERRCODE='23514';
  END IF;
  IF NOT OLD.language_selection_required AND NEW.language_selection_required THEN
    RAISE EXCEPTION 'Language selection cannot be reopened' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER worker_language_selection_guard BEFORE UPDATE ON workers
  FOR EACH ROW EXECUTE FUNCTION guard_worker_language_selection();

CREATE FUNCTION guard_worker_language_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Language request is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id) THEN
      RAISE EXCEPTION 'Scope mismatch' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW.org_id,NEW.site_id,NEW.worker_id,NEW.current_language,NEW.requested_language,NEW.requested_at)
    IS DISTINCT FROM (OLD.id,OLD.org_id,OLD.site_id,OLD.worker_id,OLD.current_language,OLD.requested_language,OLD.requested_at) THEN
    RAISE EXCEPTION 'Language request is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.reason IS DISTINCT FROM OLD.reason AND NOT (NEW.reason='[Deleted]' AND OLD.reason<>'[Deleted]'
    AND EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=OLD.worker_id
      AND d.org_id=OLD.org_id AND d.site_id=OLD.site_id)) THEN
    RAISE EXCEPTION 'Language request reason is immutable' USING ERRCODE='23514';
  END IF;
  IF (NEW.state,NEW.decided_at,NEW.decided_by,NEW.decision_note)
    IS DISTINCT FROM (OLD.state,OLD.decided_at,OLD.decided_by,OLD.decision_note) THEN
    IF OLD.state<>'pending' OR NEW.state NOT IN ('approved','rejected') OR NEW.decided_at IS NULL OR NEW.decided_by IS NULL
      OR NOT EXISTS(SELECT 1 FROM staff s WHERE s.id=NEW.decided_by AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id) THEN
      RAISE EXCEPTION 'Language request decision conflict' USING ERRCODE='23514';
    END IF;
    IF NEW.state='approved' AND NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.worker_id
      AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id AND w.active
      AND w.language=NEW.current_language AND NOT w.language_selection_required) THEN
      RAISE EXCEPTION 'Worker language changed' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER worker_language_request_guard BEFORE INSERT OR UPDATE OR DELETE ON worker_language_requests
  FOR EACH ROW EXECUTE FUNCTION guard_worker_language_request();

CREATE FUNCTION require_assignment_language_selected() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id)
    AND NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id
      AND NOT w.language_selection_required) THEN
    RAISE EXCEPTION 'Recipient language not selected' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assignment_language_selected BEFORE INSERT ON assignments
  FOR EACH ROW EXECUTE FUNCTION require_assignment_language_selected();

-- A pending deletion may clear the display name once the code has been pseudonymized.
CREATE OR REPLACE FUNCTION guard_deleted_worker_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM worker_deletion_requests WHERE worker_id=OLD.id) AND
    ((NEW.id,NEW.org_id,NEW.site_id,NEW.language) IS DISTINCT FROM (OLD.id,OLD.org_id,OLD.site_id,OLD.language)
      OR (NEW.code IS DISTINCT FROM OLD.code AND NOT EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.worker_id=OLD.id AND p.pseudonym=NEW.code))
      OR (NEW.name IS DISTINCT FROM OLD.name AND NOT (NEW.name IS NULL AND EXISTS(
        SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.worker_id=OLD.id)))) THEN
    RAISE EXCEPTION 'Worker deletion pending' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.org_id=NEW.org_id AND p.code_hash=encode(sha256(convert_to(NEW.code,'UTF8')),'hex')) THEN
    RAISE EXCEPTION 'Worker code unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
