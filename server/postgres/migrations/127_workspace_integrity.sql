-- Additive integrity enforcement. Validation failures abort this migration;
-- retained rows are never deleted or repaired implicitly.
CREATE FUNCTION workspace_object(value text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN jsonb_typeof(value::jsonb)='object'; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION workspace_captions(value text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item record; BEGIN
 IF jsonb_typeof(value::jsonb)<>'object' THEN RETURN false; END IF;
 FOR item IN SELECT key,val FROM jsonb_each(value::jsonb) AS e(key,val) LOOP
  IF item.key NOT IN ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id') OR jsonb_typeof(item.val)<>'string' OR length(item.val#>>'{}')>300 THEN RETURN false; END IF;
 END LOOP;
 RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION workspace_timestamp(value text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN RETURN value ~ '^\d{4}-\d{2}-\d{2}T' AND isfinite(value::timestamptz); EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION workspace_base64(value text,expected integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN expected BETWEEN 1 AND 3145728 AND octet_length(decode(value,'base64'))=expected
 AND replace(encode(decode(value,'base64'),'base64'),E'\n','')=value;
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
ALTER TABLE instruction_compositions ADD CONSTRAINT composition_staff_scope FOREIGN KEY(staff_id,org_id,site_id) REFERENCES staff(id,org_id,site_id);
ALTER TABLE instruction_compositions ADD CONSTRAINT composition_content_valid CHECK(workspace_object(content_json) AND workspace_timestamp(updated_at));
ALTER TABLE instruction_attachments ADD CONSTRAINT attachment_staff_scope FOREIGN KEY(staff_id,org_id,site_id) REFERENCES staff(id,org_id,site_id);
ALTER TABLE instruction_attachments ADD CONSTRAINT attachment_metadata_valid CHECK(workspace_base64(data_base64,bytes) AND workspace_timestamp(created_at) AND workspace_captions(captions_json) AND length(name) BETWEEN 1 AND 180 AND length(mime) BETWEEN 1 AND 150);
ALTER TABLE assignment_completions ADD CONSTRAINT completion_assignment_scope FOREIGN KEY(assignment_id,org_id,site_id) REFERENCES assignments(id,org_id,site_id);
ALTER TABLE assignment_completions ADD CONSTRAINT completion_worker_scope FOREIGN KEY(worker_id,org_id,site_id) REFERENCES workers(id,org_id,site_id);
ALTER TABLE assignment_completions ADD CONSTRAINT completion_timestamp_valid CHECK(workspace_timestamp(completed_at));
CREATE FUNCTION guard_workspace_relationship() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='instruction_attachments' THEN
  IF NOT EXISTS(SELECT 1 FROM instruction_compositions c WHERE c.id=NEW.request_id AND c.org_id=NEW.org_id AND c.site_id=NEW.site_id AND c.staff_id=NEW.staff_id)
   AND NOT EXISTS(SELECT 1 FROM instruction_sends s WHERE s.request_id=NEW.request_id AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id AND s.requested_by=NEW.staff_id)
  THEN RAISE EXCEPTION 'Attachment request scope mismatch'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id AND a.site_id=NEW.site_id AND a.worker_id=NEW.worker_id)
  THEN RAISE EXCEPTION 'Completion assignment scope mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM instruction_attachments x WHERE NOT EXISTS(SELECT 1 FROM instruction_compositions c WHERE c.id=x.request_id AND c.org_id=x.org_id AND c.site_id=x.site_id AND c.staff_id=x.staff_id) AND NOT EXISTS(SELECT 1 FROM instruction_sends s WHERE s.request_id=x.request_id AND s.org_id=x.org_id AND s.site_id=x.site_id AND s.requested_by=x.staff_id))
 OR EXISTS(SELECT 1 FROM assignment_completions x WHERE NOT EXISTS(SELECT 1 FROM assignments a WHERE a.id=x.assignment_id AND a.org_id=x.org_id AND a.site_id=x.site_id AND a.worker_id=x.worker_id))
 THEN RAISE EXCEPTION 'Workspace integrity preflight failed; retained rows require explicit review'; END IF;
END $$;
CREATE TRIGGER attachment_workspace_scope BEFORE INSERT OR UPDATE ON instruction_attachments FOR EACH ROW EXECUTE FUNCTION guard_workspace_relationship();
CREATE TRIGGER completion_workspace_scope BEFORE INSERT OR UPDATE ON assignment_completions FOR EACH ROW EXECUTE FUNCTION guard_workspace_relationship();
