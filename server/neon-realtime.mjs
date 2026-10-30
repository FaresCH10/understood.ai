import {createRealtime,rawSql} from '@neon/realtime/server';

export async function notificationLiveQuery(session,{schema='public',env=process.env}={}){
  if(!env.NEON_REALTIME_URL||!env.NEON_REALTIME_SECRET)return null;
  if(session.principal_type!=='staff'||!['owner','supervisor','auditor'].includes(session.role))return null;
  if(!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))throw Error('Invalid realtime schema');
  const realtime=createRealtime({secret:env.NEON_REALTIME_SECRET,db:new URL(env.DATABASE_URL).pathname.slice(1)});
  // Only an invalidation count crosses this channel. The authenticated API remains
  // authoritative for notification contents, unread totals, and session revocation.
  const query=rawSql(`SELECT count(e.id)::text AS events,count(r.event_id)::text AS reads
    FROM "${schema}".staff p
    LEFT JOIN "${schema}".audit e ON e.org_id=p.org_id AND e.site_id=p.site_id
    LEFT JOIN "${schema}".notification_reads r ON r.event_id=e.id AND r.staff_id=p.id
    WHERE p.id=$1 AND p.org_id=$2 AND p.site_id=$3 AND p.active=true`,[session.principal_id,session.org_id,session.site_id]);
  return {url:env.NEON_REALTIME_URL,query:await realtime.seal({query})};
}
