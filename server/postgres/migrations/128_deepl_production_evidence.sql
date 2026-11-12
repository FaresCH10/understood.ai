ALTER TABLE provider_operations DROP CONSTRAINT provider_operations_data_class;
ALTER TABLE provider_operations ADD CONSTRAINT provider_operations_data_class CHECK (
  data_class='synthetic' OR (data_class='real' AND org_id IS NOT NULL AND claim_token IS NOT NULL
    AND kind NOT IN ('connection-test','stage-test') AND provenance_json IS NOT NULL
    AND (provenance_json->>'adapter' IS NOT DISTINCT FROM 'gemini-approved-v1' OR (provenance_json->>'adapter' IS NOT DISTINCT FROM 'gemini-deepl-approved-v1' AND kind IN ('preparation','presentation','case-followup'))) AND provenance_json->>'dataClass' IS NOT DISTINCT FROM 'real'
    AND (provenance_json->>'model' IS NOT DISTINCT FROM model OR kind='case-followup' AND model IN (provenance_json->>'textModel',provenance_json->>'speechModel'))));
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname=current_schema() AND p.proname='protect_generated_operation_link';
 definition:=replace(definition,'CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
 definition:=replace(definition,'CASE WHEN operation.preparation_context_json->>''stage''=''speech'' THEN ''speechModel'' ELSE ''textModel'' END',
 'CASE WHEN operation.preparation_context_json->>''stage''=''speech'' THEN ''speechModel'' WHEN operation.preparation_context_json->>''stage''=''translation'' AND bundle.manifest_json->''provenance''->>''translationModel'' IS NOT NULL THEN ''translationModel'' ELSE ''textModel'' END');
 EXECUTE definition;
END $$;
