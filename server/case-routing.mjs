import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {ensureSettingsSchema} from './settings.mjs';
import {recordStaffPushEvent} from './notification-events.mjs';

export function ensureCaseRoutingSchema(db) {
  ensureSettingsSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS case_routing (
    case_id TEXT PRIMARY KEY REFERENCES clarifications(id),org_id TEXT NOT NULL,site_id TEXT NOT NULL,
    routed_owner_id TEXT REFERENCES staff(id),due_at TEXT NOT NULL,created_at TEXT NOT NULL,
    manual INTEGER NOT NULL DEFAULT 0 CHECK(manual IN (0,1)),escalated_at TEXT,
    FOREIGN KEY(site_id) REFERENCES sites(id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS case_routing_due ON case_routing(due_at) WHERE manual=0 AND escalated_at IS NULL;
  CREATE TRIGGER IF NOT EXISTS case_routing_scope BEFORE INSERT ON case_routing WHEN
    NOT EXISTS(SELECT 1 FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
      WHERE c.id=NEW.case_id AND c.org_id=NEW.org_id AND a.site_id=NEW.site_id)
    OR (NEW.routed_owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM staff s WHERE s.id=NEW.routed_owner_id AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id))
    BEGIN SELECT RAISE(ABORT,'Case routing scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS case_routing_identity BEFORE UPDATE ON case_routing WHEN
    NEW.case_id IS NOT OLD.case_id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
    OR NEW.routed_owner_id IS NOT OLD.routed_owner_id OR NEW.created_at IS NOT OLD.created_at OR NEW.due_at IS NOT OLD.due_at
    OR NEW.manual<OLD.manual OR (OLD.escalated_at IS NOT NULL AND NEW.escalated_at IS NOT OLD.escalated_at)
    BEGIN SELECT RAISE(ABORT,'Case routing identity is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS case_routing_delete BEFORE DELETE ON case_routing
    BEGIN SELECT RAISE(ABORT,'Case routing evidence is immutable'); END;`);
}

function routingAudit(db,orgId,siteId,action,id) {
  const auditId=randomUUID();
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(auditId,orgId,siteId,'system','case-routing-worker',action,id,NOW());
  recordStaffPushEvent(db,{orgId,siteId,auditId,action,objectId:id});
}

export function routeNewCase(db,orgId,siteId,id) {
  ensureCaseRoutingSchema(db);
  const row=db.prepare(`SELECT c.owner_staff_id,c.created_at FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
    WHERE c.id=? AND c.org_id=? AND a.site_id=? AND c.status='open'`).get(id,orgId,siteId);
  if(!row || db.prepare('SELECT 1 FROM case_routing WHERE case_id=?').get(id))return;
  const contact=db.prepare(`SELECT s.id FROM site_settings t JOIN staff s ON s.id IN (t.primary_contact_id,t.deputy_contact_id)
    AND s.org_id=t.org_id AND s.site_id=t.site_id AND s.active=1 AND s.role IN ('owner','supervisor')
    WHERE t.org_id=? AND t.site_id=? ORDER BY CASE WHEN s.id=t.primary_contact_id THEN 0 ELSE 1 END LIMIT 1`).get(orgId,siteId);
  const owner=row.owner_staff_id ?? contact?.id ?? null;
  db.prepare('INSERT INTO case_routing(case_id,org_id,site_id,routed_owner_id,due_at,created_at,manual) VALUES(?,?,?,?,?,?,?)')
    .run(id,orgId,siteId,owner,new Date(Date.parse(row.created_at)+86400000).toISOString(),row.created_at,row.owner_staff_id?1:0);
  if(owner && !row.owner_staff_id){db.prepare('UPDATE clarifications SET owner_staff_id=? WHERE id=?').run(owner,id);routingAudit(db,orgId,siteId,'clarification.routed',id);}
}

export function processOneCaseEscalation(db) {
  ensureCaseRoutingSchema(db);
  return transaction(db,()=>{
    const row=db.prepare(`SELECT r.*,s.id AS deputy FROM case_routing r
      JOIN clarifications c ON c.id=r.case_id AND c.org_id=r.org_id
      JOIN assignments a ON a.id=c.assignment_id AND a.org_id=r.org_id AND a.site_id=r.site_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=r.org_id AND w.site_id=r.site_id AND w.active=1
      JOIN site_settings t ON t.org_id=r.org_id AND t.site_id=r.site_id
      JOIN staff s ON s.id=t.deputy_contact_id AND s.org_id=r.org_id AND s.site_id=r.site_id AND s.active=1 AND s.role IN ('owner','supervisor')
      WHERE c.status='open' AND c.owner_staff_id IS r.routed_owner_id AND s.id IS NOT c.owner_staff_id
      AND r.manual=0 AND r.escalated_at IS NULL AND r.due_at<=?
      AND NOT EXISTS(SELECT 1 FROM site_lifecycle l WHERE l.site_id=r.site_id AND l.org_id=r.org_id AND l.state='archived')
      ORDER BY r.due_at,r.case_id LIMIT 1`).get(NOW());
    if(!row)return false;
    db.prepare('UPDATE clarifications SET owner_staff_id=? WHERE id=?').run(row.deputy,row.case_id);
    db.prepare('UPDATE case_routing SET escalated_at=? WHERE case_id=?').run(NOW(),row.case_id);
    routingAudit(db,row.org_id,row.site_id,'clarification.escalated',row.case_id);return true;
  });
}
