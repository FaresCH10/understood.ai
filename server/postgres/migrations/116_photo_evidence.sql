ALTER TABLE instruction_sends ADD COLUMN evidence_mode text NOT NULL DEFAULT 'none';
ALTER TABLE instruction_sends ADD CONSTRAINT instruction_sends_evidence_mode_check CHECK(evidence_mode IN ('none','photo'));
ALTER TABLE instruction_sends ADD CONSTRAINT instruction_sends_evidence_ack_check CHECK(evidence_mode='none' OR response_mode='acknowledge');

CREATE OR REPLACE FUNCTION guard_instruction_send() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Instruction evidence is immutable'; END IF;
  IF TG_OP='UPDATE' AND (NEW.request_id,NEW.org_id,NEW.site_id,NEW.briefing_id,NEW.publication_request_id,NEW.audience_json,NEW.response_mode,NEW.delivery_mode,NEW.evidence_mode,NEW.audience_count,NEW.request_json,NEW.requested_by,NEW.created_at)
    IS DISTINCT FROM (OLD.request_id,OLD.org_id,OLD.site_id,OLD.briefing_id,OLD.publication_request_id,OLD.audience_json,OLD.response_mode,OLD.delivery_mode,OLD.evidence_mode,OLD.audience_count,OLD.request_json,OLD.requested_by,OLD.created_at)
  THEN RAISE EXCEPTION 'Instruction evidence is immutable'; END IF;
  IF NEW.publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM publications p
    WHERE p.id=NEW.publication_id AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id AND p.briefing_id=NEW.briefing_id)
  THEN RAISE EXCEPTION 'Instruction publication scope mismatch'; END IF;
  RETURN NEW;
END $$;

CREATE TABLE assignment_evidence (
  request_id text PRIMARY KEY,
  org_id text NOT NULL,
  site_id text NOT NULL,
  assignment_id text NOT NULL UNIQUE,
  worker_id text NOT NULL,
  mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
  bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK(length(sha256)=64),
  data_base64 text NOT NULL CHECK(length(data_base64)<=7000000),
  received_at timestamptz NOT NULL,
  FOREIGN KEY(request_id) REFERENCES acknowledgments(request_id),
  FOREIGN KEY(assignment_id,org_id,site_id) REFERENCES assignments(id,org_id,site_id),
  FOREIGN KEY(worker_id,org_id,site_id) REFERENCES workers(id,org_id,site_id)
);
CREATE INDEX assignment_evidence_org_time ON assignment_evidence(org_id,received_at);
CREATE FUNCTION guard_assignment_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Evidence is immutable'; END IF;
  IF TG_OP='DELETE' THEN
    IF NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=OLD.worker_id AND d.org_id=OLD.org_id)
    THEN RAISE EXCEPTION 'Evidence is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id
    AND a.site_id=NEW.site_id AND a.worker_id=NEW.worker_id)
  THEN RAISE EXCEPTION 'Evidence scope mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM acknowledgments k WHERE k.request_id=NEW.request_id AND k.assignment_id=NEW.assignment_id
    AND k.org_id=NEW.org_id AND k.site_id=NEW.site_id AND k.worker_id=NEW.worker_id)
  THEN RAISE EXCEPTION 'Evidence acknowledgment mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assignment_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON assignment_evidence
  FOR EACH ROW EXECUTE FUNCTION guard_assignment_evidence();
