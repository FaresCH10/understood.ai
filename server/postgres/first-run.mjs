import {domainTransaction,requirePrincipal,domainAudit} from './domain.mjs';
import {firstRunInput} from '../first-run-input.mjs';

async function state(client,session) {
  return (await client.query(`SELECT st.id,st.name,st.timezone,COALESCE(ss.revision,0)::int AS revision,
    COALESCE(ss.staff_interface_language,'en') AS staff_interface_language,ss.first_run_completed_at,
    (ss.site_id IS NOT NULL) AS has_settings
    FROM sites st LEFT JOIN site_settings ss ON ss.site_id=st.id AND ss.org_id=st.org_id
    WHERE st.id=$1 AND st.org_id=$2`,[session.site_id,session.org_id])).rows[0];
}

export function getFirstRun(pool,session,{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner']);
    const row=await state(client,session);
    if(!row) throw new Error('Onboarding unavailable');
    return {completed:!row.has_settings || !!row.first_run_completed_at,revision:row.revision,site:{id:row.id,name:row.name,timezone:row.timezone},
      staffInterfaceLanguage:row.staff_interface_language};
  });
}

export function completeFirstRun(pool,session,input,{schema='public'}={}) {
  const value=firstRunInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner']);
    await client.query('SELECT id FROM sites WHERE id=$1 AND org_id=$2 FOR UPDATE',[session.site_id,session.org_id]);
    const row=await state(client,session);
    if(!row) throw new Error('Onboarding unavailable');
    if(!row.has_settings || row.first_run_completed_at) {
      if(row.has_settings && row.name===value.siteName && row.timezone===value.timezone
        && row.staff_interface_language===value.staffInterfaceLanguage)
        return {completed:true,duplicate:true,revision:row.revision,staffInterfaceLanguage:row.staff_interface_language};
      throw new Error('Onboarding already completed');
    }
    const revision=row.revision+1;
    await client.query('UPDATE sites SET name=$1,timezone=$2 WHERE id=$3 AND org_id=$4',
      [value.siteName,value.timezone,session.site_id,session.org_id]);
    await client.query(`INSERT INTO site_settings(site_id,org_id,revision,generation_languages_json,primary_contact_id,
      staff_interface_language,first_run_completed_at) VALUES($1,$2,$3,'["en","ar","ur"]'::jsonb,$4,$5,clock_timestamp())
      ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,staff_interface_language=excluded.staff_interface_language,
      first_run_completed_at=excluded.first_run_completed_at`,
    [session.site_id,session.org_id,revision,session.principal_id,value.staffInterfaceLanguage]);
    await domainAudit(client,session,'onboarding.first_run_completed',value.requestId);
    return {completed:true,duplicate:false,revision,site:{id:session.site_id,name:value.siteName,timezone:value.timezone},
      staffInterfaceLanguage:value.staffInterfaceLanguage};
  });
}
