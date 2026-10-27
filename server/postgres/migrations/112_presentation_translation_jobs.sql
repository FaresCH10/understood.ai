CREATE TABLE presentation_translation_jobs (
  id text PRIMARY KEY REFERENCES presentation_artifacts(id),
  authority_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(authority_json)='object' AND octet_length(authority_json::text)<=1000),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','complete','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  lease_token uuid,lease_until timestamptz,error_code text,retry_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((state='processing')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX presentation_translation_queue ON presentation_translation_jobs(state,updated_at);
CREATE FUNCTION protect_presentation_job_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' OR (NEW.id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.created_at) THEN RAISE EXCEPTION 'Presentation job identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER presentation_job_identity BEFORE UPDATE OR DELETE ON presentation_translation_jobs FOR EACH ROW EXECUTE FUNCTION protect_presentation_job_identity();
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='provider_operations'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%kind = ANY%' AND pg_get_constraintdef(oid) NOT LIKE '%input_hash%' AND pg_get_constraintdef(oid) NOT LIKE '%provenance%' AND pg_get_constraintdef(oid) NOT LIKE '%data_class%' LOOP
    EXECUTE format('ALTER TABLE provider_operations DROP CONSTRAINT %I',item.conname);
  END LOOP;
END $$;
ALTER TABLE provider_operations ADD CONSTRAINT provider_operation_kinds CHECK(kind IN ('source-transcription','connection-test','stage-test','case-followup','recording-transcription','recording-assessment','preparation','typed-assessment','presentation'));
ALTER TABLE provider_operations ADD CONSTRAINT provider_operation_scope CHECK((kind IN ('connection-test','stage-test') AND org_id IS NULL AND claim_token IS NULL) OR (kind NOT IN ('connection-test','stage-test') AND org_id IS NOT NULL AND claim_token IS NOT NULL));
