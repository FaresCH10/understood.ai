-- PostgreSQL's three-valued logic made NOT IN against a NULL presented_question
-- evaluate to NULL, which let provenance be added after insertion. Require an
-- existing non-sentinel value before permitting the one-way tombstone.

CREATE OR REPLACE FUNCTION guard_recording_presentation_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.presentation_id IS DISTINCT FROM OLD.presentation_id
    OR NEW.presentation_language IS DISTINCT FROM OLD.presentation_language
    OR (NEW.presented_question IS DISTINCT FROM OLD.presented_question
      AND NOT (OLD.presented_question IS NOT NULL
        AND OLD.presented_question NOT IN ('[Deleted]', '[Expired]')
        AND NEW.presented_question IN ('[Deleted]', '[Expired]'))) THEN
    RAISE EXCEPTION 'Recording presentation provenance is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
