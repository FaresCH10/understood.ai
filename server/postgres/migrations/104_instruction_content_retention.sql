-- Archived briefing content also lives in frozen Send requests and in late-released
-- per-recipient delivery copies. Expiry tombstones those projections while keeping
-- modes, audiences, delivery states, counts, assignment identities and both hashes.

CREATE FUNCTION instruction_send_request_tombstone(request jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT request || jsonb_build_object('title','[Expired]','source','[Expired]')
$$;

CREATE OR REPLACE FUNCTION guard_instruction_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Instruction delivery evidence is immutable'; END IF;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM instruction_sends s WHERE s.request_id=NEW.request_id
      AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)
      OR NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.worker_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id)
      OR (NEW.assignment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assignments a JOIN instruction_sends s
        ON s.publication_id=a.publication_id WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id
        AND a.site_id=NEW.site_id AND s.request_id=NEW.request_id))
    THEN RAISE EXCEPTION 'Instruction delivery scope mismatch'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.request_id,NEW.org_id,NEW.site_id,NEW.worker_id,NEW.language)
      IS DISTINCT FROM (OLD.request_id,OLD.org_id,OLD.site_id,OLD.worker_id,OLD.language)
    OR (OLD.assignment_id IS NOT NULL AND NEW.assignment_id IS DISTINCT FROM OLD.assignment_id)
    OR (OLD.content_hash IS NOT NULL AND NEW.content_hash IS DISTINCT FROM OLD.content_hash)
    OR (OLD.content_json IS NOT NULL AND NEW.content_json IS DISTINCT FROM OLD.content_json
      AND NOT (OLD.state='available' AND NEW.content_json IS NULL
        AND EXISTS(SELECT 1 FROM instruction_sends s JOIN briefing_content_purges p ON p.briefing_id=s.briefing_id
          WHERE s.request_id=OLD.request_id AND s.org_id=OLD.org_id AND s.site_id=OLD.site_id))
      AND NOT (NEW.content_json IS NOT DISTINCT FROM '{"title":"[Deleted]","text":"[Deleted]"}'::jsonb
        AND EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=OLD.worker_id AND d.org_id=OLD.org_id)))
    OR (OLD.content_json IS NULL AND NEW.content_json IS NOT NULL
      AND (EXISTS(SELECT 1 FROM instruction_sends s JOIN briefing_content_purges p ON p.briefing_id=s.briefing_id
          WHERE s.request_id=OLD.request_id AND s.org_id=OLD.org_id AND s.site_id=OLD.site_id)
        OR EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=OLD.worker_id AND d.org_id=OLD.org_id)))
    OR NOT ((OLD.state='preparing' AND NEW.state IN ('preparing','available','blocked','failed'))
      OR (OLD.state IN ('blocked','failed') AND NEW.state IN ('preparing','blocked','failed'))
      OR (OLD.state='available' AND NEW.state='available')
      OR (OLD.state='withdrawn' AND NEW.state='withdrawn'))
  THEN RAISE EXCEPTION 'Instruction delivery evidence is immutable'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_instruction_send() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Instruction evidence is immutable'; END IF;
  IF TG_OP='UPDATE' AND (NEW.request_id,NEW.org_id,NEW.site_id,NEW.briefing_id,NEW.publication_request_id,NEW.audience_json,NEW.response_mode,NEW.delivery_mode,NEW.audience_count,NEW.requested_by,NEW.created_at)
    IS DISTINCT FROM (OLD.request_id,OLD.org_id,OLD.site_id,OLD.briefing_id,OLD.publication_request_id,OLD.audience_json,OLD.response_mode,OLD.delivery_mode,OLD.audience_count,OLD.requested_by,OLD.created_at)
  THEN RAISE EXCEPTION 'Instruction evidence is immutable'; END IF;
  IF TG_OP='UPDATE' AND NEW.request_json IS DISTINCT FROM OLD.request_json
    AND NOT (NEW.request_json=instruction_send_request_tombstone(OLD.request_json)
      AND EXISTS(SELECT 1 FROM briefing_content_purges p WHERE p.briefing_id=OLD.briefing_id AND p.org_id=OLD.org_id AND p.site_id=OLD.site_id))
  THEN RAISE EXCEPTION 'Instruction evidence is immutable'; END IF;
  IF NEW.publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM publications p
    WHERE p.id=NEW.publication_id AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id AND p.briefing_id=NEW.briefing_id)
  THEN RAISE EXCEPTION 'Instruction publication scope mismatch'; END IF;
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
    OR EXISTS(SELECT 1 FROM instruction_sends s WHERE s.briefing_id=NEW.briefing_id AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id
      AND s.request_json IS DISTINCT FROM instruction_send_request_tombstone(s.request_json))
    OR EXISTS(SELECT 1 FROM instruction_deliveries d JOIN instruction_sends s ON s.request_id=d.request_id
      WHERE s.briefing_id=NEW.briefing_id AND d.org_id=NEW.org_id AND d.site_id=NEW.site_id AND d.content_json IS NOT NULL)
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
