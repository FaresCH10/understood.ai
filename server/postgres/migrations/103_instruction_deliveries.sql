CREATE TABLE instruction_deliveries (
  request_id text NOT NULL,
  org_id text NOT NULL,
  site_id text NOT NULL,
  worker_id text NOT NULL,
  language text NOT NULL,
  state text NOT NULL CHECK (state IN ('preparing','available','blocked','failed','withdrawn')),
  reason text CHECK (reason IS NULL OR (length(reason) BETWEEN 1 AND 100)),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  assignment_id text UNIQUE,
  content_json jsonb CHECK (content_json IS NULL OR jsonb_typeof(content_json)='object'),
  content_hash text,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (request_id,worker_id),
  FOREIGN KEY (request_id) REFERENCES instruction_sends(request_id),
  FOREIGN KEY (worker_id,org_id,site_id) REFERENCES workers(id,org_id,site_id),
  FOREIGN KEY (assignment_id,org_id,site_id) REFERENCES assignments(id,org_id,site_id),
  CHECK ((state='available')=(assignment_id IS NOT NULL)),
  CHECK ((state='available')=(content_hash IS NOT NULL)),
  CHECK (content_hash IS NULL OR state='available')
);
CREATE INDEX instruction_deliveries_worker ON instruction_deliveries(worker_id,state);
CREATE INDEX instruction_deliveries_send_state ON instruction_deliveries(request_id,state);

CREATE FUNCTION guard_instruction_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR (OLD.content_json IS NOT NULL AND NEW.content_json IS NOT NULL AND NEW.content_json IS DISTINCT FROM OLD.content_json)
    OR NOT ((OLD.state='preparing' AND NEW.state IN ('preparing','available','blocked','failed'))
      OR (OLD.state IN ('blocked','failed') AND NEW.state IN ('preparing','blocked','failed'))
      OR (OLD.state='available' AND NEW.state='available')
      OR (OLD.state='withdrawn' AND NEW.state='withdrawn'))
  THEN RAISE EXCEPTION 'Instruction delivery evidence is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER instruction_delivery_guard BEFORE INSERT OR UPDATE OR DELETE ON instruction_deliveries
  FOR EACH ROW EXECUTE FUNCTION guard_instruction_delivery();

CREATE TABLE instruction_retries (
  request_id text PRIMARY KEY,
  send_request_id text NOT NULL,
  org_id text NOT NULL,
  site_id text NOT NULL,
  requested_by text NOT NULL,
  generation integer NOT NULL CHECK (generation BETWEEN 0 AND 1000000),
  request_json jsonb NOT NULL CHECK (jsonb_typeof(request_json)='object'),
  created_at timestamptz NOT NULL,
  UNIQUE (send_request_id,generation),
  FOREIGN KEY (send_request_id) REFERENCES instruction_sends(request_id),
  FOREIGN KEY (requested_by,org_id,site_id) REFERENCES staff(id,org_id,site_id)
);
CREATE FUNCTION guard_instruction_retry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM instruction_sends s WHERE s.request_id=NEW.send_request_id
      AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)
      OR NOT EXISTS(SELECT 1 FROM staff s WHERE s.id=NEW.requested_by AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id)
    THEN RAISE EXCEPTION 'Instruction retry scope mismatch'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Instruction retry evidence is immutable';
END $$;
CREATE TRIGGER instruction_retry_guard BEFORE INSERT OR UPDATE OR DELETE ON instruction_retries
  FOR EACH ROW EXECUTE FUNCTION guard_instruction_retry();
