CREATE TABLE template_favorites (
  staff_id text NOT NULL,org_id text NOT NULL,site_id text NOT NULL,template_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(staff_id,template_id),
  FOREIGN KEY(staff_id,org_id,site_id) REFERENCES staff(id,org_id,site_id),
  FOREIGN KEY(template_id,org_id,site_id) REFERENCES templates(id,org_id,site_id)
);
CREATE INDEX idx_template_favorites_scope ON template_favorites(org_id,site_id,staff_id);
