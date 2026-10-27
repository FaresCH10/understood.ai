-- Generation targets cover every selectable worker locale. Provider and
-- artifact checks still decide whether a requested translation is ready.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT conrelid,conname FROM pg_constraint
    WHERE contype='c' AND conrelid IN ('site_settings'::regclass,'draft_creations'::regclass,'source_audio_requests'::regclass)
      AND pg_get_constraintdef(oid) LIKE '%generation_languages_json%'
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.conrelid::regclass,item.conname); END LOOP;
END $$;

ALTER TABLE site_settings ADD CONSTRAINT site_settings_generation_locale_set CHECK (
  generation_languages_json IS NULL OR CASE WHEN jsonb_typeof(generation_languages_json)<>'array' THEN false ELSE
    generation_languages_json->>0='en' AND jsonb_array_length(generation_languages_json) BETWEEN 1 AND 15
    AND generation_languages_json=jsonb_path_query_array('["en","ar","hi","ur","bn","ml","ta","te","ne","fil","si","ru","pa-Guru","pa-Arab","id"]'::jsonb,
      '$[*] ? (@ == $selected[*])',jsonb_build_object('selected',generation_languages_json)) END);

ALTER TABLE draft_creations ADD CONSTRAINT draft_creations_generation_locale_set CHECK (
  generation_languages_json IS NULL OR CASE WHEN jsonb_typeof(generation_languages_json)<>'array' THEN false ELSE
    generation_languages_json->>0='en' AND jsonb_array_length(generation_languages_json) BETWEEN 1 AND 15
    AND generation_languages_json=jsonb_path_query_array('["en","ar","hi","ur","bn","ml","ta","te","ne","fil","si","ru","pa-Guru","pa-Arab","id"]'::jsonb,
      '$[*] ? (@ == $selected[*])',jsonb_build_object('selected',generation_languages_json)) END);

ALTER TABLE source_audio_requests ADD CONSTRAINT source_audio_requests_generation_locale_set CHECK (
  generation_languages_json IS NULL OR CASE WHEN jsonb_typeof(generation_languages_json)<>'array' THEN false ELSE
    generation_languages_json->>0='en' AND jsonb_array_length(generation_languages_json) BETWEEN 1 AND 15
    AND generation_languages_json=jsonb_path_query_array('["en","ar","hi","ur","bn","ml","ta","te","ne","fil","si","ru","pa-Guru","pa-Arab","id"]'::jsonb,
      '$[*] ? (@ == $selected[*])',jsonb_build_object('selected',generation_languages_json)) END);
