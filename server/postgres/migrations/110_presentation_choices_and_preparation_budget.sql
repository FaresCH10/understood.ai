ALTER TABLE presentation_artifacts ADD COLUMN choices_json jsonb;
ALTER TABLE presentation_artifacts ADD CONSTRAINT presentation_choices_shape CHECK (
  choices_json IS NULL OR (status='ready' AND source_kind='instruction'
    AND jsonb_typeof(choices_json)='array' AND jsonb_array_length(choices_json)=4));

CREATE FUNCTION guard_presentation_choices() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.text IN ('[Deleted]','[Expired]') THEN NEW.choices_json:=NULL; END IF;
  IF TG_OP='UPDATE' AND OLD.choices_json IS DISTINCT FROM NEW.choices_json AND NOT (
    (OLD.choices_json IS NULL AND NEW.choices_json IS NOT NULL AND NEW.status='ready'
      AND NEW.source_kind='instruction' AND NEW.text NOT IN ('[Deleted]','[Expired]'))
    OR (NEW.choices_json IS NULL AND NEW.text IN ('[Deleted]','[Expired]'))) THEN
    RAISE EXCEPTION 'Presentation choices are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER presentation_choices_guard BEFORE INSERT OR UPDATE ON presentation_artifacts
  FOR EACH ROW EXECUTE FUNCTION guard_presentation_choices();

-- Source normalization and the two individually bounded repair paths require at
-- most 66 stages for 15 locales. Keep a small, explicit upper bound in every guard.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT conrelid,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE contype='c' AND conrelid IN ('preparation_stage_events'::regclass,'generated_bundles'::regclass)
      AND pg_get_constraintdef(oid) LIKE '%64%'
      AND (pg_get_constraintdef(oid) LIKE '%step%' OR pg_get_constraintdef(oid) LIKE '%provider_operation_count%')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.conrelid::regclass,item.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',item.conrelid::regclass,item.conname,replace(item.definition,'64','68'));
  END LOOP;
END $$;
