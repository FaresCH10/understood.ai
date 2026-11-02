CREATE TABLE instruction_improvements (
 publication_id text PRIMARY KEY,org_id text NOT NULL,site_id text NOT NULL,briefing_id text NOT NULL,
 assessed integer NOT NULL CHECK(assessed>=3),matched integer NOT NULL CHECK(matched>=0),
 clarification integer NOT NULL CHECK(clarification>=2),created_at timestamptz NOT NULL,
 CHECK(matched+clarification<=assessed AND clarification*100>=assessed*30),
 FOREIGN KEY(publication_id,org_id,site_id) REFERENCES publications(id,org_id,site_id),
 FOREIGN KEY(briefing_id,org_id,site_id) REFERENCES briefings(id,org_id,site_id)
);
CREATE FUNCTION guard_instruction_improvement() RETURNS trigger LANGUAGE plpgsql AS $$
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
    AND NOT EXISTS(SELECT 1 FROM attempts newer WHERE newer.assignment_id=a.id AND newer.org_id=a.org_id
      AND (newer.received_at>t.received_at OR (newer.received_at=t.received_at AND newer.id>t.id)))
    AND t.outcome IN ('matched','clarification','unassessable') INTO counts;
 IF (counts.assessed,counts.matched,counts.clarification) IS DISTINCT FROM (NEW.assessed,NEW.matched,NEW.clarification)
 THEN RAISE EXCEPTION 'Improvement scope or evidence mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER instruction_improvement_guard BEFORE INSERT OR UPDATE OR DELETE ON instruction_improvements
 FOR EACH ROW EXECUTE FUNCTION guard_instruction_improvement();
CREATE TABLE instruction_improvement_drafts (
 publication_id text PRIMARY KEY REFERENCES instruction_improvements(publication_id),request_id text NOT NULL UNIQUE,
 org_id text NOT NULL,site_id text NOT NULL,corrective_briefing_id text NOT NULL UNIQUE,
 request_hash text NOT NULL CHECK(length(request_hash)=64),requested_by text NOT NULL,created_at timestamptz NOT NULL,
 CHECK(corrective_briefing_id=request_id),
 FOREIGN KEY(corrective_briefing_id,org_id,site_id) REFERENCES briefings(id,org_id,site_id),
 FOREIGN KEY(requested_by,org_id,site_id) REFERENCES staff(id,org_id,site_id)
);
CREATE FUNCTION guard_instruction_improvement_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Improvement draft is immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM instruction_improvements i JOIN briefings b ON b.id=NEW.corrective_briefing_id
   AND b.org_id=i.org_id AND b.site_id=i.site_id JOIN staff s ON s.id=NEW.requested_by AND s.org_id=i.org_id
   AND s.site_id=i.site_id AND s.active=true AND s.role IN ('owner','supervisor')
   WHERE i.publication_id=NEW.publication_id AND i.org_id=NEW.org_id AND i.site_id=NEW.site_id
     AND b.id<>i.briefing_id AND b.state='draft')
 THEN RAISE EXCEPTION 'Improvement draft scope mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER instruction_improvement_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON instruction_improvement_drafts
 FOR EACH ROW EXECUTE FUNCTION guard_instruction_improvement_draft();
