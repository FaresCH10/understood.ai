import {transaction,NOW} from './db.mjs';
import {notificationKinds,notificationRoles,notificationFilters,notificationId,notificationRow,notificationWindow} from './notification-input.mjs';

function authority(db,session) {
  if(session?.principal_type!=='staff' || !notificationRoles.includes(session.role))throw Error('Forbidden');
  if(!db.prepare('SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1').get(session.principal_id,session.org_id,session.site_id,session.role))throw Error('Forbidden');
  if(session.token_hash!==undefined && !db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND principal_type='staff' AND principal_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL AND expires_at>?`).get(session.token_hash,session.principal_id,session.org_id,session.site_id,NOW()))throw Error('Sign in required');
}
const kinds=Object.keys(notificationKinds),placeholders=kinds.map(()=>'?').join(',');
const join=`FROM audit e LEFT JOIN notification_reads r ON r.event_id=e.id AND r.staff_id=? AND r.org_id=e.org_id AND r.site_id=e.site_id`;
const title=`(SELECT b.title FROM briefings b WHERE b.id=e.object_id AND b.org_id=e.org_id AND b.site_id=e.site_id) AS title`;
const where=`NOT (e.actor_type='staff' AND e.actor_id=?) AND e.org_id=? AND e.site_id=? AND e.occurred_at>=? AND e.occurred_at<=? AND e.action IN (${placeholders})`;
export function listNotifications(db,session,filters={}) {
  return transaction(db,()=>{
    authority(db,session);
    const {status,page,pageSize}=notificationFilters(filters),{asOf,since}=notificationWindow();
    const args=[session.principal_id,session.principal_id,session.org_id,session.site_id,since,asOf,...kinds];
    const totals=db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN r.event_id IS NULL THEN 1 ELSE 0 END),0) AS unread ${join} WHERE ${where}`).get(...args);
    const rows=db.prepare(`SELECT e.id,e.action,e.occurred_at,r.read_at,${title} ${join} WHERE ${where} ${status==='unread'?'AND r.event_id IS NULL':''} ORDER BY e.occurred_at DESC,e.id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
    return {items:rows.map(notificationRow),total:status==='unread'?totals.unread:totals.total,unread:totals.unread,page,pageSize,asOf,since};
  });
}
export function readNotification(db,session,id) {
  notificationId(id);
  return transaction(db,()=>{
    authority(db,session);
    const {asOf,since}=notificationWindow();
    const event=db.prepare(`SELECT id,action,occurred_at,(SELECT b.title FROM briefings b WHERE b.id=audit.object_id AND b.org_id=audit.org_id AND b.site_id=audit.site_id) AS title FROM audit WHERE id=? AND org_id=? AND site_id=? AND occurred_at>=? AND occurred_at<=? AND action IN (${placeholders}) AND NOT (actor_type='staff' AND actor_id=?)`).get(id,session.org_id,session.site_id,since,asOf,...kinds,session.principal_id);
    if(!event)throw Error('Notification unavailable');
    db.prepare(`INSERT INTO notification_reads(event_id,staff_id,org_id,site_id,read_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id,staff_id) DO NOTHING`).run(id,session.principal_id,session.org_id,session.site_id,asOf);
    const receipt=db.prepare('SELECT read_at FROM notification_reads WHERE event_id=? AND staff_id=? AND org_id=? AND site_id=?').get(id,session.principal_id,session.org_id,session.site_id);
    return notificationRow({...event,read_at:receipt.read_at});
  });
}
export function notificationReceipt(db,session,id) {
  notificationId(id);
  return transaction(db,()=>{
    authority(db,session);
    const row=db.prepare(`SELECT e.id,e.action,e.occurred_at,r.read_at,${title} FROM notification_reads r
      JOIN audit e ON e.id=r.event_id AND e.org_id=r.org_id AND e.site_id=r.site_id
      WHERE r.event_id=? AND r.staff_id=? AND r.org_id=? AND r.site_id=? AND e.action IN (${placeholders}) AND NOT (e.actor_type='staff' AND e.actor_id=?)`).get(id,session.principal_id,session.org_id,session.site_id,...kinds,session.principal_id);
    return row?{found:true,item:notificationRow(row)}:{found:false};
  });
}
