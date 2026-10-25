-- Historical translated presentation artifacts. These are additive viewing aids keyed to an
-- immutable original publication/answer; they never replace originals or change denominators.

CREATE TABLE presentation_artifacts (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  site_id text NOT NULL,
  worker_id text NOT NULL,
  assignment_id text NOT NULL,
  publication_id text NOT NULL,
  publication_version integer NOT NULL CHECK (publication_version > 0),
  source_kind text NOT NULL CHECK (source_kind IN ('instruction', 'answer')),
  source_id text NOT NULL DEFAULT '',
  original_language text NOT NULL CHECK (original_language IN
    ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id')),
  target_language text NOT NULL CHECK (target_language IN
    ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id')),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  title text,
  text text,
  question text,
  provider text,
  live boolean,
  error_code text,
  lease_token text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  UNIQUE (assignment_id, source_kind, source_id, target_language),
  UNIQUE (id, org_id, site_id, assignment_id),
  FOREIGN KEY (assignment_id, org_id, site_id) REFERENCES assignments(id, org_id, site_id),
  FOREIGN KEY (publication_id, org_id, site_id) REFERENCES publications(id, org_id, site_id),
  CHECK (target_language <> original_language),
  CHECK ((source_kind = 'instruction' AND source_id = '')
    OR (source_kind = 'answer' AND length(source_id) BETWEEN 8 AND 100)),
  CHECK (
    (status = 'pending' AND title IS NULL AND text IS NULL AND question IS NULL
      AND provider IS NULL AND live IS NULL AND error_code IS NULL AND ready_at IS NULL)
    OR (status = 'ready' AND text IS NOT NULL AND provider IS NOT NULL AND live IS NOT NULL
      AND error_code IS NULL AND ready_at IS NOT NULL
      AND (source_kind = 'answer' OR (source_kind = 'instruction' AND title IS NOT NULL)))
    OR (status = 'failed' AND title IS NULL AND text IS NULL AND question IS NULL
      AND provider IS NULL AND live IS NULL AND error_code IS NOT NULL AND ready_at IS NULL))
);
CREATE INDEX idx_presentation_artifacts_scope ON presentation_artifacts(org_id, site_id, worker_id, assignment_id, created_at);
CREATE INDEX idx_presentation_artifacts_source ON presentation_artifacts(assignment_id, source_kind, source_id, target_language);

CREATE TABLE answer_presentation_bindings (
  attempt_id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  site_id text NOT NULL,
  assignment_id text NOT NULL,
  presentation_id text NOT NULL,
  presentation_language text NOT NULL CHECK (presentation_language IN
    ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id')),
  presented_question text NOT NULL CHECK (length(trim(presented_question)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (attempt_id, org_id, site_id, assignment_id)
    REFERENCES attempts(id, org_id, site_id, assignment_id),
  FOREIGN KEY (presentation_id, org_id, site_id, assignment_id)
    REFERENCES presentation_artifacts(id, org_id, site_id, assignment_id)
);
CREATE INDEX idx_answer_presentation_bindings_presentation ON answer_presentation_bindings(presentation_id);

CREATE FUNCTION guard_presentation_artifact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Presentation evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM assignments a
      JOIN publications p ON p.id = a.publication_id AND p.org_id = a.org_id AND p.site_id = a.site_id
      JOIN workers w ON w.id = a.worker_id AND w.org_id = a.org_id AND w.site_id = a.site_id
      WHERE a.id = NEW.assignment_id AND a.org_id = NEW.org_id AND a.site_id = NEW.site_id
        AND a.worker_id = NEW.worker_id AND p.id = NEW.publication_id AND p.version = NEW.publication_version) THEN
      RAISE EXCEPTION 'Presentation scope mismatch' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.org_id, NEW.site_id, NEW.worker_id, NEW.assignment_id, NEW.publication_id,
      NEW.publication_version, NEW.source_kind, NEW.source_id, NEW.original_language,
      NEW.target_language, NEW.source_hash, NEW.created_at)
    IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.site_id, OLD.worker_id, OLD.assignment_id, OLD.publication_id,
      OLD.publication_version, OLD.source_kind, OLD.source_id, OLD.original_language,
      OLD.target_language, OLD.source_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'Presentation evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'ready' THEN
    IF NEW.status = 'ready' AND OLD.text <> '[Deleted]' AND NEW.text = '[Deleted]'
      AND NEW.title IS NOT DISTINCT FROM (CASE WHEN OLD.title IS NULL THEN NULL ELSE '[Deleted]' END)
      AND NEW.question IS NOT DISTINCT FROM (CASE WHEN OLD.question IS NULL THEN NULL ELSE '[Deleted]' END)
      AND NEW.provider IS NOT DISTINCT FROM OLD.provider AND NEW.live IS NOT DISTINCT FROM OLD.live
      AND NEW.error_code IS NOT DISTINCT FROM OLD.error_code AND NEW.ready_at IS NOT DISTINCT FROM OLD.ready_at THEN
      RETURN NEW;
    END IF;
    IF NEW.status <> 'ready' OR NEW.title IS DISTINCT FROM OLD.title OR NEW.text IS DISTINCT FROM OLD.text
      OR NEW.question IS DISTINCT FROM OLD.question OR NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW.live IS DISTINCT FROM OLD.live OR NEW.error_code IS DISTINCT FROM OLD.error_code
      OR NEW.ready_at IS DISTINCT FROM OLD.ready_at THEN
      RAISE EXCEPTION 'Presentation evidence is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'failed' THEN
    IF NEW.status <> 'failed' OR NEW.title IS NOT NULL OR NEW.text IS NOT NULL OR NEW.question IS NOT NULL
      OR NEW.provider IS NOT NULL OR NEW.live IS NOT NULL OR NEW.error_code IS NULL OR NEW.ready_at IS NOT NULL THEN
      RAISE EXCEPTION 'Presentation evidence is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- Pending artifacts may be leased, reclaimed, or finished; row CHECK constraints enforce shapes.
  RETURN NEW;
END $$;
CREATE TRIGGER presentation_artifacts_guard BEFORE INSERT OR UPDATE OR DELETE ON presentation_artifacts
  FOR EACH ROW EXECUTE FUNCTION guard_presentation_artifact();

CREATE FUNCTION guard_answer_presentation_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Presentation binding is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM attempts t
      JOIN assignments a ON a.id = t.assignment_id AND a.org_id = t.org_id AND a.site_id = t.site_id
      JOIN presentation_artifacts p ON p.id = NEW.presentation_id AND p.assignment_id = a.id
        AND p.org_id = a.org_id AND p.site_id = a.site_id AND p.worker_id = a.worker_id
      WHERE t.id = NEW.attempt_id AND t.org_id = NEW.org_id AND t.site_id = NEW.site_id
        AND t.assignment_id = NEW.assignment_id AND p.source_kind = 'instruction' AND p.status = 'ready'
        AND p.target_language = NEW.presentation_language AND p.question = NEW.presented_question) THEN
      RAISE EXCEPTION 'Presentation binding scope mismatch' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.attempt_id, NEW.org_id, NEW.site_id, NEW.assignment_id, NEW.presentation_id,
      NEW.presentation_language, NEW.created_at)
    IS DISTINCT FROM
     (OLD.attempt_id, OLD.org_id, OLD.site_id, OLD.assignment_id, OLD.presentation_id,
      OLD.presentation_language, OLD.created_at)
    OR OLD.presented_question = '[Deleted]' OR NEW.presented_question <> '[Deleted]' THEN
    RAISE EXCEPTION 'Presentation binding is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER answer_presentation_bindings_guard BEFORE INSERT OR UPDATE OR DELETE ON answer_presentation_bindings
  FOR EACH ROW EXECUTE FUNCTION guard_answer_presentation_binding();

ALTER TABLE recordings ADD COLUMN presentation_id text;
ALTER TABLE recordings ADD COLUMN presentation_language text CHECK (presentation_language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));
ALTER TABLE recordings ADD COLUMN presented_question text;
ALTER TABLE recordings ADD CONSTRAINT recordings_presentation_fk
  FOREIGN KEY (presentation_id, org_id, site_id, assignment_id)
  REFERENCES presentation_artifacts(id, org_id, site_id, assignment_id);
ALTER TABLE recordings ADD CONSTRAINT recordings_presentation_shape CHECK (
  (presentation_id IS NULL AND presentation_language IS NULL AND presented_question IS NULL)
  OR (presentation_id IS NOT NULL AND presentation_language IS NOT NULL
    AND presented_question IS NOT NULL AND length(trim(presented_question)) > 0));
