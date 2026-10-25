import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {ensureSettingsSchema} from './settings.mjs';
import {firstRunInput} from './first-run-input.mjs';

function authority(db,session) {
  if(session?.principal_type!=='staff' || session.role!=='owner'
    || !db.prepare("SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND role='owner' AND active=1")
      .get(session.principal_id,session.org_id,session.site_id)) throw new Error('Forbidden');
}
function state(db,session) {
  return db.prepare(`SELECT st.id,st.name,st.timezone,COALESCE(ss.revision,0) AS revision,
    COALESCE(ss.staff_interface_language,'en') AS staff_interface_language,ss.first_run_completed_at,
    (ss.site_id IS NOT NULL) AS has_settings
    FROM sites st LEFT JOIN site_settings ss ON ss.site_id=st.id AND ss.org_id=st.org_id
    WHERE st.id=? AND st.org_id=?`).get(session.site_id,session.org_id);
}

export function getFirstRun(db,session) {
  ensureSettingsSchema(db);
  return transaction(db,()=>{
    authority(db,session);
    const row=state(db,session);
    if(!row) throw new Error('Onboarding unavailable');
    return {completed:!row.has_settings || !!row.first_run_completed_at,revision:row.revision,site:{id:row.id,name:row.name,timezone:row.timezone},
      staffInterfaceLanguage:row.staff_interface_language};
  });
}

export function completeFirstRun(db,session,input) {
  const value=firstRunInput(input);
  ensureSettingsSchema(db);
  return transaction(db,()=>{
    authority(db,session);
    const row=state(db,session);
    if(!row) throw new Error('Onboarding unavailable');
    if(!row.has_settings || row.first_run_completed_at) {
      if(row.has_settings && row.name===value.siteName && row.timezone===value.timezone
        && row.staff_interface_language===value.staffInterfaceLanguage)
        return {completed:true,duplicate:true,revision:row.revision,staffInterfaceLanguage:row.staff_interface_language};
      throw new Error('Onboarding already completed');
    }
    const revision=row.revision+1,now=NOW();
    db.prepare('UPDATE sites SET name=?,timezone=? WHERE id=? AND org_id=?').run(value.siteName,value.timezone,session.site_id,session.org_id);
    db.prepare(`INSERT INTO site_settings(site_id,org_id,revision,generation_languages_json,primary_contact_id,
      staff_interface_language,first_run_completed_at) VALUES(?,?,?, '["en","ar","ur"]',?,?,?)
      ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,staff_interface_language=excluded.staff_interface_language,
      first_run_completed_at=excluded.first_run_completed_at`)
      .run(session.site_id,session.org_id,revision,session.principal_id,value.staffInterfaceLanguage,now);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),session.org_id,session.site_id,'staff',
      session.principal_id,'onboarding.first_run_completed',value.requestId,now);
    return {completed:true,duplicate:false,revision,site:{id:session.site_id,name:value.siteName,timezone:value.timezone},
      staffInterfaceLanguage:value.staffInterfaceLanguage};
  });
}
