CREATE OR REPLACE FUNCTION guard_instruction_improvement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE counts record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Improvement is immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM publications p WHERE p.id=NEW.publication_id AND p.org_id=NEW.org_id
   AND p.site_id=NEW.site_id AND p.briefing_id=NEW.briefing_id AND p.state='published')
 THEN RAISE EXCEPTION 'Improvement scope or evidence mismatch'; END IF;
 SELECT count(*) AS assessed,
  COALESCE(sum(CASE WHEN t.outcome='matched' THEN 1 ELSE 0 END),0) AS matched,
  COALESCE(sum(CASE WHEN t.outcome='clarification' THEN 1 ELSE 0 END),0) AS clarification FROM assignments a
  JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
  JOIN attempts t ON t.assignment_id=a.id AND t.org_id=a.org_id
  WHERE a.publication_id=NEW.publication_id AND a.org_id=NEW.org_id AND a.site_id=NEW.site_id AND w.active=true
    AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=w.id AND d.org_id=w.org_id AND d.site_id=w.site_id)
    AND t.submission_id=(SELECT sr.submission_id FROM submission_receipts sr
      WHERE sr.assignment_id=a.id AND sr.org_id=a.org_id ORDER BY sr.sequence DESC LIMIT 1)
    AND t.outcome IN ('matched','clarification','unassessable') INTO counts;
 IF (counts.assessed,counts.matched,counts.clarification) IS DISTINCT FROM (NEW.assessed,NEW.matched,NEW.clarification)
 THEN RAISE EXCEPTION 'Improvement scope or evidence mismatch'; END IF;
 RETURN NEW;
END $$;
