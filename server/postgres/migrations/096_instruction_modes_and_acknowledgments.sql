CREATE TABLE instruction_sends (
  request_id text PRIMARY KEY,
  org_id text NOT NULL,site_id text NOT NULL,briefing_id text NOT NULL UNIQUE,
  publication_request_id text NOT NULL UNIQUE,
  audience_json jsonb NOT NULL CHECK(jsonb_typeof(audience_json)='object'),
  response_mode text NOT NULL CHECK(response_mode IN ('question','acknowledge')),
  delivery_mode text NOT NULL CHECK(delivery_mode IN ('text','voice','both')),
  state text NOT NULL CHECK(state IN ('preparing','published','failed')),
  publication_id text,audience_count integer NOT NULL CHECK(audience_count BETWEEN 1 AND 5000),
  delivered integer NOT NULL DEFAULT 0 CHECK(delivered>=0),
  undelivered integer NOT NULL DEFAULT 0 CHECK(undelivered>=0),
  undelivered_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(undelivered_json)='array'),
  error text,request_json jsonb NOT NULL CHECK(jsonb_typeof(request_json)='object'),
  requested_by text NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
  FOREIGN KEY(briefing_id,org_id,site_id) REFERENCES briefings(id,org_id,site_id),
  FOREIGN KEY(requested_by,org_id,site_id) REFERENCES staff(id,org_id,site_id),
  FOREIGN KEY(publication_id,org_id,site_id) REFERENCES publications(id,org_id,site_id),
  CHECK(delivered+undelivered=audience_count),
  CHECK((state='published' AND publication_id IS NOT NULL) OR (state<>'published' AND publication_id IS NULL))
);
CREATE INDEX instruction_sends_scope ON instruction_sends(org_id,site_id,created_at DESC,request_id);
CREATE TABLE acknowledgments (
  request_id text PRIMARY KEY,org_id text NOT NULL,site_id text NOT NULL,
  assignment_id text NOT NULL UNIQUE,worker_id text NOT NULL,received_at timestamptz NOT NULL,
  FOREIGN KEY(assignment_id,org_id,site_id) REFERENCES assignments(id,org_id,site_id),
  FOREIGN KEY(worker_id,org_id,site_id) REFERENCES workers(id,org_id,site_id)
);
CREATE INDEX acknowledgments_org_time ON acknowledgments(org_id,received_at);
CREATE FUNCTION guard_instruction_send() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Instruction evidence is immutable'; END IF;
  IF TG_OP='UPDATE' AND (NEW.request_id,NEW.org_id,NEW.site_id,NEW.briefing_id,NEW.publication_request_id,NEW.audience_json,NEW.response_mode,NEW.delivery_mode,NEW.audience_count,NEW.request_json,NEW.requested_by,NEW.created_at)
    IS DISTINCT FROM (OLD.request_id,OLD.org_id,OLD.site_id,OLD.briefing_id,OLD.publication_request_id,OLD.audience_json,OLD.response_mode,OLD.delivery_mode,OLD.audience_count,OLD.request_json,OLD.requested_by,OLD.created_at)
  THEN RAISE EXCEPTION 'Instruction evidence is immutable'; END IF;
  IF NEW.publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM publications p
    WHERE p.id=NEW.publication_id AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id AND p.briefing_id=NEW.briefing_id)
  THEN RAISE EXCEPTION 'Instruction publication scope mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER instruction_send_guard BEFORE INSERT OR UPDATE OR DELETE ON instruction_sends
  FOR EACH ROW EXECUTE FUNCTION guard_instruction_send();
CREATE FUNCTION guard_acknowledgment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Acknowledgment is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id
    AND a.site_id=NEW.site_id AND a.worker_id=NEW.worker_id)
  THEN RAISE EXCEPTION 'Acknowledgment scope mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER acknowledgment_guard BEFORE INSERT OR UPDATE OR DELETE ON acknowledgments
  FOR EACH ROW EXECUTE FUNCTION guard_acknowledgment();
