CREATE OR REPLACE FUNCTION guard_instruction_send() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Instruction evidence is immutable'; END IF;
  IF TG_OP='UPDATE' AND (NEW.request_id,NEW.org_id,NEW.site_id,NEW.briefing_id,NEW.publication_request_id,NEW.audience_json,NEW.response_mode,NEW.delivery_mode,NEW.evidence_mode,NEW.audience_count,NEW.requested_by,NEW.created_at)
    IS DISTINCT FROM (OLD.request_id,OLD.org_id,OLD.site_id,OLD.briefing_id,OLD.publication_request_id,OLD.audience_json,OLD.response_mode,OLD.delivery_mode,OLD.evidence_mode,OLD.audience_count,OLD.requested_by,OLD.created_at)
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
