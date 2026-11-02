CREATE TABLE translation_feedback (
  id text PRIMARY KEY,org_id text NOT NULL,site_id text NOT NULL,publication_id text NOT NULL,briefing_id text NOT NULL,
  language text NOT NULL,field text NOT NULL CHECK(field IN ('title','text','question','audio','glossary')),
  note text NOT NULL,status text NOT NULL CHECK(status IN ('open','resolved','dismissed')),
  reported_by text NOT NULL,reported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_by text,resolved_at timestamptz,resolution_note text,
  FOREIGN KEY(publication_id,org_id,site_id) REFERENCES publications(id,org_id,site_id),
  FOREIGN KEY(briefing_id,org_id,site_id) REFERENCES briefings(id,org_id,site_id),
  FOREIGN KEY(reported_by,org_id,site_id) REFERENCES staff(id,org_id,site_id),
  FOREIGN KEY(resolved_by,org_id,site_id) REFERENCES staff(id,org_id,site_id)
);
CREATE INDEX idx_translation_feedback_queue ON translation_feedback(org_id,site_id,status,reported_at DESC,id);
CREATE UNIQUE INDEX idx_translation_feedback_open ON translation_feedback(org_id,site_id,publication_id,language,field) WHERE status='open';
CREATE FUNCTION freeze_translation_feedback_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.publication_id IS DISTINCT FROM OLD.publication_id OR NEW.briefing_id IS DISTINCT FROM OLD.briefing_id
    OR NEW.language IS DISTINCT FROM OLD.language OR NEW.field IS DISTINCT FROM OLD.field OR NEW.note IS DISTINCT FROM OLD.note
    OR NEW.reported_by IS DISTINCT FROM OLD.reported_by OR NEW.reported_at IS DISTINCT FROM OLD.reported_at
  THEN RAISE EXCEPTION 'Translation feedback evidence is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER translation_feedback_evidence BEFORE UPDATE ON translation_feedback FOR EACH ROW EXECUTE FUNCTION freeze_translation_feedback_evidence();
CREATE FUNCTION guard_translation_feedback_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
      OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note)
    AND (OLD.status <> 'open' OR NEW.status = 'open' OR NEW.resolved_by IS NULL OR NEW.resolved_at IS NULL)
  THEN RAISE EXCEPTION 'Translation feedback decision is final'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER translation_feedback_decision BEFORE UPDATE ON translation_feedback FOR EACH ROW EXECUTE FUNCTION guard_translation_feedback_decision();
CREATE FUNCTION freeze_translation_feedback_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Translation feedback evidence is immutable'; END $$;
CREATE TRIGGER translation_feedback_frozen_delete BEFORE DELETE ON translation_feedback FOR EACH ROW EXECUTE FUNCTION freeze_translation_feedback_delete();
