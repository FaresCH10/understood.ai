-- Draft language receipts can name every selectable worker locale.
-- Provider readiness still decides whether a requested language can be sent.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT conname FROM pg_constraint
    WHERE contype='c' AND conrelid='briefing_language_requests'::regclass
      AND pg_get_constraintdef(oid) LIKE '%generationLanguages%'
  LOOP EXECUTE format('ALTER TABLE briefing_language_requests DROP CONSTRAINT %I',item.conname); END LOOP;
END $$;

ALTER TABLE briefing_language_requests ADD CONSTRAINT briefing_language_requests_generation_locale_set CHECK (
  request_json->'generationLanguages' IS NULL
  OR jsonb_typeof(request_json->'generationLanguages')='null'
  OR CASE WHEN jsonb_typeof(request_json->'generationLanguages')<>'array' THEN false ELSE
    request_json->'generationLanguages'->>0='en'
    AND jsonb_array_length(request_json->'generationLanguages') BETWEEN 1 AND 15
    AND request_json->'generationLanguages'=jsonb_path_query_array('["en","ar","hi","ur","bn","ml","ta","te","ne","fil","si","ru","pa-Guru","pa-Arab","id"]'::jsonb,
      '$[*] ? (@ == $selected[*])',jsonb_build_object('selected',request_json->'generationLanguages')) END);
