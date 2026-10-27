-- Keep historical synthetic receipts and add a separate, explicit production class.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='provider_operations'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%data_class%' LOOP
    EXECUTE format('ALTER TABLE provider_operations DROP CONSTRAINT %I',item.conname);
  END LOOP;
END $$;
ALTER TABLE provider_operations ADD CONSTRAINT provider_operations_data_class CHECK (
  data_class='synthetic' OR (data_class='real' AND org_id IS NOT NULL AND claim_token IS NOT NULL
    AND kind NOT IN ('connection-test','stage-test') AND provenance_json IS NOT NULL
    AND provenance_json->>'adapter' IS NOT DISTINCT FROM 'gemini-approved-v1' AND provenance_json->>'dataClass' IS NOT DISTINCT FROM 'real'
    AND (provenance_json->>'model' IS NOT DISTINCT FROM model OR kind='case-followup' AND model IN (provenance_json->>'textModel',provenance_json->>'speechModel'))));

DO $$ DECLARE function_name text; definition text; BEGIN
  FOREACH function_name IN ARRAY ARRAY['check_audio_operation_link','protect_followup_operation_link','protect_generated_operation_link'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO STRICT definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND p.proname=function_name;
    definition:=replace(definition,'CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
    definition:=replace(definition,'operation.data_class<>''synthetic''','operation.data_class NOT IN (''synthetic'',''real'')');
    definition:=replace(definition,'operation.provenance_json->>''dataClass'' IS DISTINCT FROM ''synthetic''','operation.provenance_json->>''dataClass'' IS DISTINCT FROM operation.data_class');
    IF function_name='check_audio_operation_link' THEN
      definition:=replace(definition,'CASE WHEN expected_kind=''recording-assessment'' THEN 1 ELSE 4 END','CASE WHEN expected_kind=''recording-assessment'' OR operation.data_class=''real'' THEN 1 ELSE 4 END');
      definition:=replace(definition,'IF expected_kind=''recording-assessment'' THEN','IF expected_kind=''recording-assessment'' OR operation.data_class=''real'' THEN');
    ELSIF function_name='protect_generated_operation_link' THEN
      definition:=replace(definition,'operation.data_class NOT IN (''synthetic'',''real'')','operation.data_class IS DISTINCT FROM (bundle.manifest_json->''provenance''->>''dataClass'')');
    END IF;
    EXECUTE definition;
  END LOOP;
END $$;
