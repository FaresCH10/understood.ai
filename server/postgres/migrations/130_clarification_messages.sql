ALTER TABLE clarification_exchanges DROP CONSTRAINT clarification_exchanges_attempt_id_kind_key;
CREATE INDEX clarification_exchanges_assignment ON clarification_exchanges(assignment_id,created_at,id);
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=current_schema() AND p.proname='guard_clarification_exchange';
 definition:=replace(definition,'CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
 definition:=replace(definition,'t.outcome=''clarification''','t.outcome IN (''clarification'',''matched'')');
 EXECUTE definition;
END $$;
-- Retire pending automatic quiz retries while retaining every message and original answer.
UPDATE case_repeats SET status='cancelled' WHERE status='pending'
 AND EXISTS(SELECT 1 FROM clarification_exchanges e WHERE e.id=case_repeats.id AND e.kind='explanation');
