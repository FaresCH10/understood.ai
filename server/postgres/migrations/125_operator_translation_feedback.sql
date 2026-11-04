-- Platform reviewers have their own identity; never impersonate company staff.
ALTER TABLE translation_feedback ADD COLUMN resolved_by_operator text REFERENCES platform_operators(id);
ALTER TABLE translation_feedback ADD CONSTRAINT translation_feedback_one_reviewer
  CHECK (resolved_by IS NULL OR resolved_by_operator IS NULL);
CREATE OR REPLACE FUNCTION guard_translation_feedback_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
      OR NEW.resolved_by_operator IS DISTINCT FROM OLD.resolved_by_operator
      OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note)
    AND (OLD.status <> 'open' OR NEW.status = 'open'
      OR (NEW.resolved_by IS NULL AND NEW.resolved_by_operator IS NULL) OR NEW.resolved_at IS NULL)
  THEN RAISE EXCEPTION 'Translation feedback decision is final'; END IF;
  RETURN NEW;
END $$;
