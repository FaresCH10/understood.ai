import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {settingsInput,settingsRequestId,sameSettingsRequest,generationLanguages,siteContactFilters,siteContactDto} from './settings-input.mjs';
import {staffRecoveryScope} from './staff-input.mjs';
export function ensureSettingsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS organization_settings (
    org_id TEXT PRIMARY KEY REFERENCES organizations(id),revision INTEGER NOT NULL CHECK(revision>=0),support_email TEXT NOT NULL DEFAULT ''
  ) STRICT;
  CREATE TABLE IF NOT EXISTS site_settings (
    site_id TEXT PRIMARY KEY REFERENCES sites(id),org_id TEXT NOT NULL REFERENCES organizations(id),revision INTEGER NOT NULL CHECK(revision>=0)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS settings_requests (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    kind TEXT NOT NULL CHECK(kind IN ('organization','site')),request_json TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
    created_by TEXT NOT NULL REFERENCES staff(id),created_at TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS site_settings_scope BEFORE INSERT ON site_settings WHEN
    NOT EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND org_id=NEW.org_id) BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS site_settings_scope_update BEFORE UPDATE ON site_settings WHEN NEW.site_id<>OLD.site_id OR NEW.org_id<>OLD.org_id
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS settings_requests_scope BEFORE INSERT ON settings_requests WHEN
    NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.created_by AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;`);
  for(const action of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS settings_requests_frozen_${action.toLowerCase()} BEFORE ${action} ON settings_requests BEGIN SELECT RAISE(ABORT,'Settings receipt is immutable'); END;`);
  if(!db.prepare('PRAGMA table_info(site_settings)').all().some(row=>row.name==='generation_languages_json'))db.exec(`ALTER TABLE site_settings ADD COLUMN generation_languages_json TEXT NOT NULL DEFAULT '["en","ar","ur"]'
    CHECK(generation_languages_json IN ('["en"]','["en","ar"]','["en","ur"]','["en","ar","ur"]'));`);
  for(const field of ['primary_contact_id','deputy_contact_id'])if(!db.prepare('PRAGMA table_info(site_settings)').all().some(row=>row.name===field))db.exec(`ALTER TABLE site_settings ADD COLUMN ${field} TEXT REFERENCES staff(id);`);
  if(!db.prepare('PRAGMA table_info(site_settings)').all().some(row=>row.name==='staff_interface_language'))
    db.exec("ALTER TABLE site_settings ADD COLUMN staff_interface_language TEXT NOT NULL DEFAULT 'en' CHECK(staff_interface_language IN ('en','ar'));");
  if(!db.prepare('PRAGMA table_info(site_settings)').all().some(row=>row.name==='first_run_completed_at')){
    db.exec('ALTER TABLE site_settings ADD COLUMN first_run_completed_at TEXT;');
    // Workspaces that predate first-run onboarding have already been configured.
    db.prepare('UPDATE site_settings SET first_run_completed_at=?').run(NOW());
  }
  for(const action of ['INSERT','UPDATE'])db.exec(`CREATE TRIGGER IF NOT EXISTS site_contacts_scope_${action.toLowerCase()} BEFORE ${action} ON site_settings WHEN
    (NEW.primary_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.primary_contact_id AND org_id=NEW.org_id AND site_id=NEW.site_id)) OR
    (NEW.deputy_contact_id IS NOT NULL AND (NEW.primary_contact_id IS NULL OR NEW.primary_contact_id=NEW.deputy_contact_id OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.deputy_contact_id AND org_id=NEW.org_id AND site_id=NEW.site_id)))
    BEGIN SELECT RAISE(ABORT,'Site contact scope mismatch'); END;`);
}
export function getDraftLanguageSelection(db,orgId,siteId,briefingId) {
  const latest=db.prepare('SELECT request_json FROM briefing_language_requests WHERE org_id=? AND site_id=? AND briefing_id=? ORDER BY accepted_revision DESC LIMIT 1').get(orgId,siteId,briefingId);
  if(latest)return JSON.parse(latest.request_json).generationLanguages;
  const draft=db.prepare('SELECT generation_languages_json FROM draft_creations WHERE org_id=? AND site_id=? AND briefing_id=?').get(orgId,siteId,briefingId);
  return draft?.generation_languages_json ? generationLanguages(JSON.parse(draft.generation_languages_json)) : null;
}
export function readGenerationLanguages(db,orgId,siteId,fallback=['en','ar','ur'],briefingId=null) {
  if(briefingId){const selected=getDraftLanguageSelection(db,orgId,siteId,briefingId);if(selected)return generationLanguages(selected);}
  const row=db.prepare('SELECT generation_languages_json FROM site_settings WHERE org_id=? AND site_id=?').get(orgId,siteId);
  return generationLanguages(row?JSON.parse(row.generation_languages_json):fallback);
}
function authority(db,session,kind=null) {
  if(session?.principal_type!=='staff' || !(kind ? kind==='site' ? ['owner','administrator'] : ['owner'] : ['owner','administrator','supervisor','auditor']).includes(session.role)
    || !db.prepare('SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1').get(session.principal_id,session.org_id,session.site_id,session.role)) throw new Error('Forbidden');
}
function context(db,session) {
  const organization=db.prepare("SELECT o.id,o.name,COALESCE(s.revision,0) AS revision,COALESCE(s.support_email,'') AS supportEmail FROM organizations o LEFT JOIN organization_settings s ON s.org_id=o.id WHERE o.id=?").get(session.org_id);
  const site=db.prepare('SELECT s.id,s.name,s.timezone,COALESCE(t.revision,0) AS revision FROM sites s LEFT JOIN site_settings t ON t.site_id=s.id AND t.org_id=s.org_id WHERE s.id=? AND s.org_id=?').get(session.site_id,session.org_id);
  const contacts=db.prepare('SELECT primary_contact_id,deputy_contact_id FROM site_settings WHERE site_id=? AND org_id=?').get(session.site_id,session.org_id);
  const contact=id=>siteContactDto(id?db.prepare('SELECT id,name,role,active FROM staff WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id):null);
  if(!organization || !site) throw new Error('Settings unavailable');return {organization,site:{...site,generationLanguages:readGenerationLanguages(db,session.org_id,session.site_id),primaryContact:contact(contacts?.primary_contact_id),deputyContact:contact(contacts?.deputy_contact_id)}};
}
export function listSiteContacts(db,session,input={}) {
  const f=siteContactFilters(input);
  return transaction(db,()=>{authority(db,session,'site');const values=[session.org_id,session.site_id,f.search.toLowerCase(),f.search.toLowerCase()],where="org_id=? AND site_id=? AND active=1 AND role IN ('owner','supervisor') AND (instr(lower(name),?)>0 OR instr(lower(id),?)>0)";
    const total=db.prepare(`SELECT COUNT(*) AS n FROM staff WHERE ${where}`).get(...values).n;
    return {items:db.prepare(`SELECT id,name,role,active FROM staff WHERE ${where} ORDER BY lower(name),id LIMIT ? OFFSET ?`).all(...values,f.pageSize,(f.page-1)*f.pageSize).map(siteContactDto),total,page:f.page,pageSize:f.pageSize};});
}
export function getSettings(db,session) {
  return transaction(db,()=>{authority(db,session);return {...context(db,session),recoveryScope:staffRecoveryScope(session),canWrite:session.role==='owner',canWriteSite:['owner','administrator'].includes(session.role)};});
}
export function settingsReceipt(db,session,kind,id){
  settingsRequestId(id);if(!['organization','site'].includes(kind))throw Error('Invalid settings request');
  return transaction(db,()=>{authority(db,session,kind);
    const row=db.prepare('SELECT * FROM settings_requests WHERE id=? AND org_id=? AND site_id=? AND kind=? AND created_by=?').get(id,session.org_id,session.site_id,kind,session.principal_id);
    return row?{requestId:row.id,kind:row.kind,request:JSON.parse(row.request_json),revision:row.revision}:null;
  });
}
export function updateSettings(db,session,kind,input) {
  const value=settingsInput(kind,input);
  return transaction(db,()=>{
    authority(db,session,kind);
    const old=db.prepare('SELECT * FROM settings_requests WHERE id=? AND org_id=? AND site_id=?').get(input.requestId,session.org_id,session.site_id);
    if(old) {if(old.created_by!==session.principal_id || old.kind!==kind || !sameSettingsRequest(JSON.parse(old.request_json),value)) throw new Error('Settings request conflict');return {revision:old.revision,duplicate:true};}
    const current=context(db,session)[kind];
    if(current.revision!==value.revision) throw new Error('Settings revision changed');
    if(current.name===value.name && (kind==='organization' ? current.supportEmail===value.supportEmail : current.timezone===value.timezone && (value.generationLanguages===undefined || JSON.stringify(current.generationLanguages)===JSON.stringify(value.generationLanguages)) && (value.primaryContactId===undefined || (value.primaryContactId===(current.primaryContact?.id ?? null) && value.deputyContactId===(current.deputyContact?.id ?? null))))) throw new Error('Settings unchanged');
    if(kind==='site' && value.primaryContactId!==undefined)for(const id of [value.primaryContactId,value.deputyContactId].filter(Boolean))if(!db.prepare("SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND active=1 AND role IN ('owner','supervisor')").get(id,session.org_id,session.site_id))throw Error('Invalid site contact');
    const revision=value.revision+1;
    if(kind==='organization') {
      db.prepare('UPDATE organizations SET name=? WHERE id=?').run(value.name,session.org_id);
      db.prepare('INSERT INTO organization_settings VALUES(?,?,?) ON CONFLICT(org_id) DO UPDATE SET revision=excluded.revision,support_email=excluded.support_email').run(session.org_id,revision,value.supportEmail);
    } else {
      db.prepare('UPDATE sites SET name=?,timezone=? WHERE id=? AND org_id=?').run(value.name,value.timezone,session.site_id,session.org_id);
      db.prepare('INSERT INTO site_settings(site_id,org_id,revision,generation_languages_json,primary_contact_id,deputy_contact_id) VALUES(?,?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,generation_languages_json=excluded.generation_languages_json,primary_contact_id=excluded.primary_contact_id,deputy_contact_id=excluded.deputy_contact_id').run(session.site_id,session.org_id,revision,JSON.stringify(value.generationLanguages ?? current.generationLanguages),value.primaryContactId===undefined?(current.primaryContact?.id ?? null):value.primaryContactId,value.deputyContactId===undefined?(current.deputyContact?.id ?? null):value.deputyContactId);
    }
    db.prepare('INSERT INTO settings_requests VALUES(?,?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,kind,JSON.stringify(value),revision,session.principal_id,NOW());
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),session.org_id,session.site_id,'staff',session.principal_id,`settings.${kind}_updated`,input.requestId,NOW());
    return {revision,duplicate:false};
  });
}
