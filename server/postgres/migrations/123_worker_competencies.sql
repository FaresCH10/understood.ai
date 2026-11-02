ALTER TABLE briefings ADD COLUMN competency_validity_days integer
  CHECK (competency_validity_days IS NULL OR competency_validity_days BETWEEN 1 AND 3650);

CREATE TABLE worker_competencies (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  site_id text NOT NULL,
  worker_id text NOT NULL,
  briefing_id text NOT NULL,
  publication_id text NOT NULL,
  assignment_id text NOT NULL UNIQUE,
  attempt_id text NOT NULL UNIQUE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  language text NOT NULL,
  source text NOT NULL CHECK (source IN ('typed', 'audio')),
  awarded_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > awarded_at),
  FOREIGN KEY (worker_id, org_id, site_id) REFERENCES workers(id, org_id, site_id),
  FOREIGN KEY (briefing_id, org_id, site_id) REFERENCES briefings(id, org_id, site_id),
  FOREIGN KEY (publication_id, org_id, site_id) REFERENCES publications(id, org_id, site_id),
  FOREIGN KEY (assignment_id, org_id, site_id) REFERENCES assignments(id, org_id, site_id),
  FOREIGN KEY (attempt_id, org_id, site_id, assignment_id) REFERENCES attempts(id, org_id, site_id, assignment_id)
);
CREATE INDEX worker_competencies_scope_expiry ON worker_competencies(org_id, site_id, expires_at, worker_id);
CREATE INDEX worker_competencies_worker ON worker_competencies(worker_id, expires_at);

CREATE FUNCTION validate_worker_competency_award() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt record; validity text; title text;
BEGIN
  SELECT t.outcome, t.received_at, a.worker_id, a.language, p.briefing_id,
         p.snapshot_json->'competency'->>'validityDays' AS validity,
         p.snapshot_json->'competency'->>'title' AS title
    INTO attempt
    FROM attempts t
    JOIN assignments a ON a.id = t.assignment_id AND a.org_id = t.org_id AND a.site_id = NEW.site_id
    JOIN publications p ON p.id = a.publication_id AND p.org_id = a.org_id AND p.site_id = a.site_id
    WHERE t.id = NEW.attempt_id AND t.org_id = NEW.org_id AND t.assignment_id = NEW.assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Competency award is invalid' USING ERRCODE = '23514'; END IF;
  IF attempt.outcome IS DISTINCT FROM 'matched' OR attempt.received_at IS DISTINCT FROM NEW.awarded_at
     OR attempt.worker_id IS DISTINCT FROM NEW.worker_id OR attempt.language IS DISTINCT FROM NEW.language
     OR attempt.briefing_id IS DISTINCT FROM NEW.briefing_id
  THEN RAISE EXCEPTION 'Competency award is invalid' USING ERRCODE = '23514'; END IF;
  validity := attempt.validity; title := attempt.title;
  IF validity IS NULL OR validity !~ '^[0-9]{1,4}$' OR validity::int NOT BETWEEN 1 AND 3650
     OR NEW.title IS DISTINCT FROM title
     OR NEW.expires_at IS DISTINCT FROM NEW.awarded_at + make_interval(days => validity::int)
  THEN RAISE EXCEPTION 'Competency award is invalid' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER worker_competency_award_valid BEFORE INSERT ON worker_competencies
  FOR EACH ROW EXECUTE FUNCTION validate_worker_competency_award();

CREATE FUNCTION freeze_worker_competency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Competency awards are immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER worker_competency_update BEFORE UPDATE ON worker_competencies
  FOR EACH ROW EXECUTE FUNCTION freeze_worker_competency();
CREATE TRIGGER worker_competency_delete BEFORE DELETE ON worker_competencies
  FOR EACH ROW EXECUTE FUNCTION freeze_worker_competency();
