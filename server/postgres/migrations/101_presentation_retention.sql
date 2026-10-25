-- Content retention must also tombstone derived translated presentation copies and their
-- presented-question provenance. Originals, outcomes and provenance hashes stay intact.

CREATE OR REPLACE FUNCTION guard_presentation_artifact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
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
    IF NEW.status = 'ready' AND OLD.text NOT IN ('[Deleted]', '[Expired]')
      AND NEW.text IN ('[Deleted]', '[Expired]')
      AND NEW.title IS NOT DISTINCT FROM (CASE WHEN OLD.title IS NULL THEN NULL ELSE NEW.text END)
      AND NEW.question IS NOT DISTINCT FROM (CASE WHEN OLD.question IS NULL THEN NULL ELSE NEW.text END)
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
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_answer_presentation_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
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
    OR OLD.presented_question IN ('[Deleted]', '[Expired]')
    OR NEW.presented_question NOT IN ('[Deleted]', '[Expired]') THEN
    RAISE EXCEPTION 'Presentation binding is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION require_briefing_content_redacted() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
  IF EXISTS(SELECT 1 FROM briefings WHERE id=NEW.briefing_id AND (title<>'[Expired]' OR source<>'[Expired]' OR prepared_json IS NOT NULL))
    OR EXISTS(SELECT 1 FROM publications WHERE briefing_id=NEW.briefing_id AND snapshot_json IS DISTINCT FROM briefing_content_tombstone('publications')->'snapshot_json')
    OR EXISTS(SELECT 1 FROM draft_reviews WHERE briefing_id=NEW.briefing_id AND content_json<>'{}'::jsonb)
    OR EXISTS(SELECT 1 FROM briefing_review_requests WHERE briefing_id=NEW.briefing_id AND request_json<>'{}'::jsonb)
    OR EXISTS(SELECT 1 FROM briefing_regeneration_requests WHERE briefing_id=NEW.briefing_id AND baseline_review_json IS NOT NULL)
    OR EXISTS(SELECT 1 FROM generated_bundles WHERE briefing_id=NEW.briefing_id AND manifest_json<>'{}'::jsonb)
    OR EXISTS(SELECT 1 FROM briefing_copies WHERE copy_briefing_id=NEW.briefing_id AND title<>'[Expired]')
    OR EXISTS(SELECT 1 FROM source_audio_requests WHERE briefing_id=NEW.briefing_id AND title<>'[Expired]')
    OR EXISTS(SELECT 1 FROM presentation_artifacts p JOIN assignments a ON a.id=p.assignment_id
      JOIN publications pub ON pub.id=a.publication_id WHERE pub.briefing_id=NEW.briefing_id
      AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id AND (p.status='pending'
        OR (p.status='ready' AND (p.text NOT IN ('[Deleted]','[Expired]')
          OR (p.title IS NOT NULL AND p.title NOT IN ('[Deleted]','[Expired]'))
          OR (p.question IS NOT NULL AND p.question NOT IN ('[Deleted]','[Expired]'))))))
    OR EXISTS(SELECT 1 FROM answer_presentation_bindings b JOIN presentation_artifacts p ON p.id=b.presentation_id
      JOIN assignments a ON a.id=p.assignment_id JOIN publications pub ON pub.id=a.publication_id
      WHERE pub.briefing_id=NEW.briefing_id AND b.org_id=NEW.org_id AND b.site_id=NEW.site_id
        AND b.presented_question NOT IN ('[Deleted]','[Expired]'))
    OR EXISTS(SELECT 1 FROM recordings r JOIN assignments a ON a.id=r.assignment_id
      JOIN publications pub ON pub.id=a.publication_id WHERE pub.briefing_id=NEW.briefing_id
      AND r.org_id=NEW.org_id AND r.site_id=NEW.site_id
        AND r.presented_question IS NOT NULL AND r.presented_question NOT IN ('[Deleted]','[Expired]')) THEN
    RAISE EXCEPTION 'Briefing content redaction incomplete';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION guard_recording_presentation_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.presentation_id IS DISTINCT FROM OLD.presentation_id
    OR NEW.presentation_language IS DISTINCT FROM OLD.presentation_language
    OR (NEW.presented_question IS DISTINCT FROM OLD.presented_question
      AND NOT (OLD.presented_question NOT IN ('[Deleted]', '[Expired]')
        AND NEW.presented_question IN ('[Deleted]', '[Expired]'))) THEN
    RAISE EXCEPTION 'Recording presentation provenance is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recordings_presentation_immutable BEFORE UPDATE ON recordings
  FOR EACH ROW EXECUTE FUNCTION guard_recording_presentation_provenance();

