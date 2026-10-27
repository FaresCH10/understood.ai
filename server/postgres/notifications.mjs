import {domainTransaction,requirePrincipal} from './domain.mjs';
import {notificationKinds,notificationRoles,notificationFilters,notificationId,notificationRow,notificationWindow} from '../notification-input.mjs';

const kinds=Object.keys(notificationKinds);
const join=`FROM audit e LEFT JOIN notification_reads r ON r.event_id=e.id AND r.staff_id=$1 AND r.org_id=e.org_id AND r.site_id=e.site_id`;
const title=`(SELECT b.title FROM briefings b WHERE b.id=e.object_id AND b.org_id=e.org_id AND b.site_id=e.site_id) AS title`;
const where=`e.org_id=$2 AND e.site_id=$3 AND e.occurred_at>=$4 AND e.occurred_at<=$5 AND e.action=ANY($6::text[]) AND NOT (e.actor_type='staff' AND e.actor_id=$1)`;
export async function listNotifications(pool,session,filters={},{schema='public'}={}) {
  const {status,page,pageSize}=notificationFilters(filters);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',notificationRoles);
    const {asOf,since}=notificationWindow(),args=[session.principal_id,session.org_id,session.site_id,since,asOf,kinds];
    const totals=(await client.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE r.event_id IS NULL)::int AS unread ${join} WHERE ${where}`,args)).rows[0];
    const rows=(await client.query(`SELECT e.id,e.action,e.occurred_at,r.read_at,${title} ${join} WHERE ${where} ${status==='unread'?'AND r.event_id IS NULL':''} ORDER BY e.occurred_at DESC,e.id DESC LIMIT $7 OFFSET $8`,[...args,pageSize,(page-1)*pageSize])).rows;
    return {items:rows.map(notificationRow),total:status==='unread'?totals.unread:totals.total,unread:totals.unread,page,pageSize,asOf,since};
  });
}
export async function readNotification(pool,session,id,{schema='public'}={}) {
  notificationId(id);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',notificationRoles);
    const {asOf,since}=notificationWindow();
    const event=(await client.query(`SELECT id,action,occurred_at,(SELECT b.title FROM briefings b WHERE b.id=audit.object_id AND b.org_id=audit.org_id AND b.site_id=audit.site_id) AS title FROM audit WHERE id=$1 AND org_id=$2 AND site_id=$3 AND occurred_at>=$4 AND occurred_at<=$5 AND action=ANY($6::text[]) AND NOT (actor_type='staff' AND actor_id=$7)`,[id,session.org_id,session.site_id,since,asOf,kinds,session.principal_id])).rows[0];
    if(!event)throw Error('Notification unavailable');
    await client.query(`INSERT INTO notification_reads(event_id,staff_id,org_id,site_id,read_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id,staff_id) DO NOTHING`,[id,session.principal_id,session.org_id,session.site_id,asOf]);
    const receipt=(await client.query('SELECT read_at FROM notification_reads WHERE event_id=$1 AND staff_id=$2 AND org_id=$3 AND site_id=$4',[id,session.principal_id,session.org_id,session.site_id])).rows[0];
    return notificationRow({...event,read_at:receipt.read_at});
  });
}
export async function notificationReceipt(pool,session,id,{schema='public'}={}) {
  notificationId(id);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',notificationRoles);
    const row=(await client.query(`SELECT e.id,e.action,e.occurred_at,r.read_at,${title} FROM notification_reads r
      JOIN audit e ON e.id=r.event_id AND e.org_id=r.org_id AND e.site_id=r.site_id
      WHERE r.event_id=$1 AND r.staff_id=$2 AND r.org_id=$3 AND r.site_id=$4 AND e.action=ANY($5::text[]) AND NOT (e.actor_type='staff' AND e.actor_id=$2)`,[id,session.principal_id,session.org_id,session.site_id,kinds])).rows[0];
    return row?{found:true,item:notificationRow(row)}:{found:false};
  });
}
