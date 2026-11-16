CREATE TABLE clarification_exchanges (
 id text PRIMARY KEY,org_id text NOT NULL,site_id text NOT NULL,case_id text NOT NULL,assignment_id text NOT NULL,
 attempt_id text NOT NULL REFERENCES attempts(id),kind text NOT NULL CHECK(kind IN ('request','explanation')),
 actor_id text NOT NULL,actor_role text,source_language text NOT NULL,target_language text NOT NULL,
 source_text text NOT NULL CHECK(length(source_text) BETWEEN 3 AND 500),request_hash text NOT NULL,
 data_class text NOT NULL DEFAULT 'synthetic' CHECK(data_class IN ('synthetic','real')),
 translated_text text,state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','delivered','failed')),
 attempts integer NOT NULL DEFAULT 0,lease_token text,lease_until timestamptz,retry_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 error_code text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),delivered_at timestamptz,
 FOREIGN KEY(case_id,org_id,site_id) REFERENCES clarifications(id,org_id,site_id),
 FOREIGN KEY(assignment_id,org_id,site_id) REFERENCES assignments(id,org_id,site_id),
 UNIQUE(attempt_id,kind),
 CHECK((state='processing')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX clarification_exchange_queue ON clarification_exchanges(state,retry_at);
CREATE FUNCTION guard_clarification_exchange() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fingerprint text; BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Clarification exchange is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state NOT IN ('queued','delivered') OR (NEW.state='delivered' AND (NEW.kind<>'request' OR NEW.source_language<>NEW.target_language OR NEW.translated_text IS DISTINCT FROM NEW.source_text)) THEN RAISE EXCEPTION 'Clarification initial state invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM attempts t JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id AND a.site_id=t.site_id
   JOIN clarifications c ON c.id=NEW.case_id AND c.assignment_id=a.id AND c.org_id=a.org_id AND c.site_id=a.site_id
   WHERE t.id=NEW.attempt_id AND a.id=NEW.assignment_id AND a.org_id=NEW.org_id AND a.site_id=NEW.site_id AND t.outcome='clarification' AND c.status='open'
    AND ((NEW.kind='request' AND NEW.actor_id=a.worker_id AND NEW.actor_role IS NULL) OR (NEW.kind='explanation' AND EXISTS(SELECT 1 FROM staff s WHERE s.id=NEW.actor_id AND s.org_id=a.org_id AND s.site_id=a.site_id AND s.active AND s.role=NEW.actor_role AND s.role IN ('owner','supervisor')))))
  THEN RAISE EXCEPTION 'Clarification exchange scope mismatch'; END IF;
 ELSE
  IF (NEW.id,NEW.org_id,NEW.site_id,NEW.case_id,NEW.assignment_id,NEW.attempt_id,NEW.kind,NEW.actor_id,NEW.actor_role,NEW.source_language,NEW.target_language,NEW.request_hash,NEW.created_at,NEW.data_class)
    IS DISTINCT FROM (OLD.id,OLD.org_id,OLD.site_id,OLD.case_id,OLD.assignment_id,OLD.attempt_id,OLD.kind,OLD.actor_id,OLD.actor_role,OLD.source_language,OLD.target_language,OLD.request_hash,OLD.created_at,OLD.data_class)
  THEN RAISE EXCEPTION 'Clarification exchange identity is immutable'; END IF;
  IF OLD.state='delivered' AND NEW.source_text NOT IN ('[Deleted]','[Expired]') AND (NEW.state,NEW.translated_text,NEW.delivered_at) IS DISTINCT FROM (OLD.state,OLD.translated_text,OLD.delivered_at) THEN RAISE EXCEPTION 'Delivered clarification is immutable'; END IF;
  IF NEW.state='delivered' AND OLD.state IS DISTINCT FROM 'delivered' THEN
   IF OLD.state<>'processing' OR OLD.lease_until<=clock_timestamp() OR NEW.translated_text IS NULL THEN RAISE EXCEPTION 'Clarification delivery claim unavailable'; END IF;
   IF NEW.source_language=NEW.target_language AND NEW.translated_text IS DISTINCT FROM NEW.source_text THEN RAISE EXCEPTION 'Clarification text mismatch'; END IF;
   IF NEW.data_class='real' AND NEW.source_language<>NEW.target_language THEN
    fingerprint:=encode(sha256(convert_to(NEW.id||chr(31)||NEW.source_language||chr(31)||NEW.target_language||chr(31)||NEW.attempt_id||chr(31)||NEW.kind||chr(31)||NEW.source_text,'UTF8')),'hex');
    IF (SELECT count(DISTINCT o.provenance_json->>'promptVersion') FROM provider_operations o WHERE o.kind='clarification-translation'
      AND o.org_id=NEW.org_id AND o.reference_id=NEW.id AND o.claim_token=OLD.lease_token AND o.input_hash=fingerprint AND o.data_class='real'
      AND o.provenance_json->>'promptVersion' IN ('clarification-translate-v1','clarification-check-v1')
      AND EXISTS(SELECT 1 FROM provider_requests r WHERE r.operation_id=o.id AND r.state='accepted'))<>2
    THEN RAISE EXCEPTION 'Clarification translation proof unavailable'; END IF;
   END IF;
  END IF;
  IF NEW.source_text IS DISTINCT FROM OLD.source_text AND NOT (NEW.source_text IN ('[Deleted]','[Expired]') AND
    (EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id WHERE a.id=NEW.assignment_id)
     OR EXISTS(SELECT 1 FROM case_content_purges cp WHERE cp.case_id=NEW.case_id))) THEN RAISE EXCEPTION 'Clarification exchange evidence is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clarification_exchange_guard BEFORE INSERT OR UPDATE OR DELETE ON clarification_exchanges FOR EACH ROW EXECUTE FUNCTION guard_clarification_exchange();
ALTER TABLE provider_operations DROP CONSTRAINT provider_operation_kinds;
ALTER TABLE provider_operations ADD CONSTRAINT provider_operation_kinds CHECK(kind IN ('source-transcription','connection-test','stage-test','case-followup','recording-transcription','recording-assessment','preparation','typed-assessment','presentation','clarification-translation'));
ALTER TABLE provider_operations DROP CONSTRAINT provider_operations_data_class;
ALTER TABLE provider_operations ADD CONSTRAINT provider_operations_data_class CHECK (
 data_class='synthetic' OR (data_class='real' AND org_id IS NOT NULL AND claim_token IS NOT NULL
 AND kind NOT IN ('connection-test','stage-test') AND provenance_json IS NOT NULL
 AND (provenance_json->>'adapter' IS NOT DISTINCT FROM 'gemini-approved-v1' OR (provenance_json->>'adapter' IS NOT DISTINCT FROM 'gemini-deepl-approved-v1' AND kind IN ('preparation','presentation','case-followup','clarification-translation')))
 AND provenance_json->>'dataClass' IS NOT DISTINCT FROM 'real'
 AND (provenance_json->>'model' IS NOT DISTINCT FROM model OR kind='case-followup' AND model IN (provenance_json->>'textModel',provenance_json->>'speechModel'))));
