import {randomUUID,createHash} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {ensureNotificationEventSchema} from './notification-event-schema.mjs';
import {notificationFilters,notificationWindow,notificationId} from './notification-input.mjs';
import {
  workerEventKinds,workerEventLabels,staffPushKinds,notificationEventRef,pushSubscriptionInput,pushSubscriptionId,
  pushSubscriptionLimit,pushRetryLimit,retryAt,notificationEventKind,
} from './notification-event-input.mjs';
import {pushCopy} from './push-copy.mjs';

const iso=value=>value instanceof Date?value.toISOString():value;
const endpointHash=endpoint=>createHash('sha256').update(endpoint).digest('hex');

function sessionAuthority(db,session,{requireToken=true}={}) {
  if(!session || !['staff','worker'].includes(session.principal_type)) throw new Error('Forbidden');
  if(requireToken) {
    if(typeof session.token_hash!=='string' || !/^[a-f0-9]{64}$/.test(session.token_hash)) throw new Error('Sign in required');
    const live=db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND org_id=? AND site_id=? AND principal_type=? AND principal_id=?
      AND revoked_at IS NULL AND expires_at>?`).get(session.token_hash,session.org_id,session.site_id,session.principal_type,session.principal_id,NOW());
    if(!live) throw new Error('Sign in required');
  }
  const table=session.principal_type==='worker'?'workers':'staff';
  const row=db.prepare(`SELECT id FROM ${table} WHERE id=? AND org_id=? AND site_id=? AND active=1`).get(session.principal_id,session.org_id,session.site_id);
  if(!row) throw new Error(session.principal_type==='worker'?'Sign in required':'Forbidden');
}

function workerAuthority(db,session) {
  if(session?.principal_type!=='worker') throw new Error('Forbidden');
  sessionAuthority(db,session);
}

function eventRow(row,kind) {
  return {id:row.id,kind,label:workerEventLabels[kind],destination:workerEventKinds[kind].destination,
    objectType:row.object_type,objectId:row.object_id,occurredAt:iso(row.created_at),readAt:iso(row.read_at) ?? null};
}

export function listWorkerNotifications(db,session,filters={}) {
  const {status,page,pageSize}=notificationFilters(filters);
  return transaction(db,()=>{
    workerAuthority(db,session);
    const {asOf,since}=notificationWindow(),kinds=Object.keys(workerEventKinds);
    const args=[session.principal_id,session.org_id,session.site_id,session.principal_id,since,asOf,...kinds];
    const join=`FROM notification_events e LEFT JOIN notification_event_reads r ON r.event_id=e.id
      AND r.principal_type='worker' AND r.principal_id=? AND r.org_id=e.org_id AND r.site_id=e.site_id`;
    const where=`e.org_id=? AND e.site_id=? AND e.audience='worker' AND e.recipient_id=? AND e.created_at>=? AND e.created_at<=?
      AND e.kind IN (${kinds.map(()=>'?').join(',')})`;
    const totals=db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN r.event_id IS NULL THEN 1 ELSE 0 END),0) AS unread
      ${join} WHERE ${where}`).get(...args);
    const rows=db.prepare(`SELECT e.id,e.kind,e.object_type,e.object_id,e.created_at,r.read_at ${join} WHERE ${where}
      ${status==='unread'?'AND r.event_id IS NULL':''} ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?`)
      .all(...args,pageSize,(page-1)*pageSize);
    return {items:rows.map(row=>eventRow(row,row.kind)),total:status==='unread'?totals.unread:totals.total,unread:totals.unread,page,pageSize,asOf,since};
  });
}

export function readWorkerNotification(db,session,id) {
  notificationId(id);
  return transaction(db,()=>{
    workerAuthority(db,session);
    const {asOf,since}=notificationWindow(),kinds=Object.keys(workerEventKinds);
    const event=db.prepare(`SELECT id,kind,object_type,object_id,created_at FROM notification_events
      WHERE id=? AND org_id=? AND site_id=? AND audience='worker' AND recipient_id=? AND created_at>=? AND created_at<=?
        AND kind IN (${kinds.map(()=>'?').join(',')})`)
      .get(id,session.org_id,session.site_id,session.principal_id,since,asOf,...kinds);
    if(!event) throw new Error('Notification unavailable');
    db.prepare(`INSERT INTO notification_event_reads(event_id,principal_type,principal_id,org_id,site_id,read_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(event_id,principal_type,principal_id) DO NOTHING`)
      .run(id,'worker',session.principal_id,session.org_id,session.site_id,asOf);
    const receipt=db.prepare(`SELECT read_at FROM notification_event_reads
      WHERE event_id=? AND principal_type='worker' AND principal_id=? AND org_id=? AND site_id=?`)
      .get(id,session.principal_id,session.org_id,session.site_id);
    return eventRow({...event,read_at:receipt.read_at},event.kind);
  });
}

export function workerNotificationReceipt(db,session,id) {
  notificationId(id);
  return transaction(db,()=>{
    workerAuthority(db,session);
    const row=db.prepare(`SELECT e.id,e.kind,e.object_type,e.object_id,e.created_at,r.read_at
      FROM notification_event_reads r JOIN notification_events e ON e.id=r.event_id AND e.org_id=r.org_id AND e.site_id=r.site_id
      WHERE r.event_id=? AND r.principal_type='worker' AND r.principal_id=? AND r.org_id=? AND r.site_id=?`)
      .get(id,session.principal_id,session.org_id,session.site_id);
    return row?{found:true,item:eventRow(row,row.kind)}:{found:false};
  });
}

function enqueueDeliveries(db,eventId,orgId,siteId,audience,recipientId,now) {
  const subscriptions=db.prepare(`SELECT id FROM push_subscriptions
    WHERE org_id=? AND site_id=? AND principal_type=? AND principal_id=? AND revoked_at IS NULL`).all(orgId,siteId,audience,recipientId);
  const insert=db.prepare(`INSERT OR IGNORE INTO push_deliveries(id,event_id,subscription_id,state,attempts,adapter,next_attempt_at,accepted_at,last_error,created_at,updated_at)
    VALUES(?,?,?,'queued',0,NULL,?,NULL,NULL,?,?)`);
  for(const subscription of subscriptions) insert.run(randomUUID(),eventId,subscription.id,now,now,now);
}

export function recordWorkerEvent(db,{orgId,siteId,workerId,kind,objectType,objectId,dedupeKey,now=NOW()}) {
  ensureNotificationEventSchema(db);
  notificationEventKind(kind,'worker');notificationEventRef(dedupeKey);
  if(typeof orgId!=='string' || typeof siteId!=='string' || typeof workerId!=='string') throw new Error('Invalid notification event');
  const id=randomUUID();
  const inserted=db.prepare(`INSERT OR IGNORE INTO notification_events
    (id,org_id,site_id,audience,recipient_id,kind,object_type,object_id,dedupe_key,created_at)
    VALUES(?,?,?,'worker',?,?,?,?,?,?)`)
    .run(id,orgId,siteId,workerId,kind,objectType.slice(0,40),objectId.slice(0,120),dedupeKey,now).changes;
  if(!inserted) return false;
  enqueueDeliveries(db,id,orgId,siteId,'worker',workerId,now);
  return true;
}

export function recordStaffPushEvent(db,{orgId,siteId,auditId,action,objectId,now=NOW()}) {
  ensureNotificationEventSchema(db);
  if(!staffPushKinds.includes(action) || typeof auditId!=='string' || auditId.length<1 || auditId.length>100) return false;
  const recipients=db.prepare(`SELECT id FROM staff WHERE org_id=? AND site_id=? AND role IN ('owner','supervisor') AND active=1 ORDER BY id`)
    .all(orgId,siteId);
  const id=randomUUID();
  let created=false;
  for(const recipient of recipients) {
    const eventId=randomUUID();
    const inserted=db.prepare(`INSERT OR IGNORE INTO notification_events
      (id,org_id,site_id,audience,recipient_id,kind,object_type,object_id,dedupe_key,created_at)
      VALUES(?,?,?,'staff',?,?,?,?,?,?)`)
      .run(eventId,orgId,siteId,recipient.id,action,'audit',String(auditId).slice(0,120),`staff:${auditId}`,now).changes;
    if(!inserted) continue;
    created=true;
    enqueueDeliveries(db,eventId,orgId,siteId,'staff',recipient.id,now);
  }
  return created;
}

export function staffAuditOnce(db,{orgId,siteId,action,objectId,actorId='notification-worker',now=NOW()}) {
  ensureNotificationEventSchema(db);
  if(!staffPushKinds.includes(action)) throw new Error('Invalid notification event');
  if(typeof orgId!=='string' || typeof siteId!=='string' || typeof objectId!=='string' || !objectId) throw new Error('Invalid notification event');
  const existing=db.prepare('SELECT id FROM audit WHERE org_id=? AND site_id=? AND action=? AND object_id=? ORDER BY occurred_at LIMIT 1')
    .get(orgId,siteId,action,objectId);
  if(existing) return false;
  const auditId=randomUUID();
  db.prepare(`INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)`).run(auditId,orgId,siteId,'system',actorId,action,objectId,now);
  recordStaffPushEvent(db,{orgId,siteId,auditId,action,objectId,now});
  return true;
}

let overdueSweepAt=0;
export function sweepOverdueAssignments(db,{now=NOW(),limit=50,force=false,intervalMs=300000}={}) {
  ensureNotificationEventSchema(db);
  const started=Date.now();
  if(!force && started-overdueSweepAt<intervalMs) return 0;
  overdueSweepAt=started;
  return transaction(db,()=>{
    const rows=db.prepare(`SELECT a.id,a.org_id,a.site_id FROM assignments a
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.due_at IS NOT NULL AND a.due_at<=? AND p.state='published'
        AND NOT EXISTS(SELECT 1 FROM submission_receipts sr WHERE sr.assignment_id=a.id AND sr.org_id=a.org_id)
      AND NOT EXISTS(SELECT 1 FROM acknowledgments ak WHERE ak.assignment_id=a.id AND ak.org_id=a.org_id)
        AND NOT EXISTS(SELECT 1 FROM audit au WHERE au.org_id=a.org_id AND au.site_id=a.site_id
          AND au.action='assignment.overdue' AND au.object_id=a.id)
      ORDER BY a.due_at,a.id LIMIT ?`).all(now,limit);
    let count=0;
    for(const row of rows)
      if(staffAuditOnce(db,{orgId:row.org_id,siteId:row.site_id,action:'assignment.overdue',objectId:row.id,now}))count++;
    return count;
  });
}

function currentSubscription(db,session,id) {
  pushSubscriptionId(id);
  const row=db.prepare(`SELECT * FROM push_subscriptions WHERE id=? AND org_id=? AND site_id=? AND principal_type=? AND principal_id=? AND revoked_at IS NULL`)
    .get(id,session.org_id,session.site_id,session.principal_type,session.principal_id);
  if(!row) throw new Error('Push subscription unavailable');
  return row;
}

function revokeRow(db,row,reason,now=NOW()) {
  db.prepare(`UPDATE push_subscriptions SET revoked_at=?,revoke_reason=?,updated_at=?
    WHERE id=? AND revoked_at IS NULL`).run(now,reason,now,row.id);
  db.prepare(`UPDATE push_deliveries SET state='cancelled',last_error=?,updated_at=?
    WHERE subscription_id=? AND state IN ('queued','sending')`).run(reason===undefined?'revoked':reason.slice(0,40),now,row.id);
}

export function savePushSubscription(db,session,input,{now=NOW()}={}) {
  ensureNotificationEventSchema(db);
  const value=pushSubscriptionInput(input);
  return transaction(db,()=>{
    sessionAuthority(db,session);
    if(!session.token_hash) throw new Error('Sign in required');
    const hash=endpointHash(value.endpoint);
    const active=db.prepare('SELECT * FROM push_subscriptions WHERE endpoint_hash=? AND revoked_at IS NULL').get(hash);
    if(active) {
      const same=active.org_id===session.org_id && active.site_id===session.site_id
        && active.principal_type===session.principal_type && active.principal_id===session.principal_id;
      if(same) {
        db.prepare(`UPDATE push_subscriptions SET p256dh=?,auth=?,expires_at=?,session_hash=?,updated_at=?,last_seen_at=?
          WHERE id=?`).run(value.p256dh,value.auth,value.expirationTime,session.token_hash,now,now,active.id);
        return {id:active.id,createdAt:iso(active.created_at),updatedAt:now,reused:true,reassigned:false};
      }
      revokeRow(db,active,'endpoint_reassigned',now);
    }
    const count=db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions
      WHERE org_id=? AND site_id=? AND principal_type=? AND principal_id=? AND revoked_at IS NULL`)
      .get(session.org_id,session.site_id,session.principal_type,session.principal_id).n;
    if(count>=pushSubscriptionLimit) throw new Error('Too many push subscriptions');
    const id=randomUUID();
    db.prepare(`INSERT INTO push_subscriptions
      (id,org_id,site_id,principal_type,principal_id,session_hash,endpoint_hash,endpoint,p256dh,auth,expires_at,created_at,updated_at,last_seen_at,revoked_at,revoke_reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)`)
      .run(id,session.org_id,session.site_id,session.principal_type,session.principal_id,session.token_hash,hash,
        value.endpoint,value.p256dh,value.auth,value.expirationTime,now,now,now);
    return {id,createdAt:now,updatedAt:now,reused:false,reassigned:!!active};
  });
}

export function revokePushSubscription(db,session,id,{now=NOW()}={}) {
  ensureNotificationEventSchema(db);
  return transaction(db,()=>{
    sessionAuthority(db,session);
    const row=currentSubscription(db,session,id);
    revokeRow(db,row,'user_revoked',now);
    return {ok:true};
  });
}

export function revokeSessionPushSubscriptions(db,sessionHash,{now=NOW(),reason='signed_out'}={}) {
  ensureNotificationEventSchema(db);
  if(typeof sessionHash!=='string' || !/^[a-f0-9]{64}$/.test(sessionHash)) return 0;
  const rows=db.prepare('SELECT * FROM push_subscriptions WHERE session_hash=? AND revoked_at IS NULL').all(sessionHash);
  for(const row of rows) revokeRow(db,row,reason,now);
  return rows.length;
}

export function revokePushForSession(db,sessionHash,options={}) {
  return transaction(db,()=>revokeSessionPushSubscriptions(db,sessionHash,options));
}

export function expirePushSubscriptions(db,{now=NOW()}={}) {
  ensureNotificationEventSchema(db);
  return transaction(db,()=>{
    const rows=db.prepare(`SELECT * FROM push_subscriptions s WHERE s.revoked_at IS NULL AND (
      (s.expires_at IS NOT NULL AND s.expires_at<=?)
      OR NOT EXISTS(SELECT 1 FROM sessions se WHERE se.token_hash=s.session_hash AND se.org_id=s.org_id AND se.site_id=s.site_id
        AND se.principal_type=s.principal_type AND se.principal_id=s.principal_id AND se.revoked_at IS NULL AND se.expires_at>?))`)
      .all(now,now);
    for(const row of rows) revokeRow(db,row,'subscription_expired',now);
    return rows.length;
  });
}

export function pushSubscriptionStatus(db,session,adapter={mode:'disabled',publicKey:null}) {
  ensureNotificationEventSchema(db);
  return transaction(db,()=>{
    sessionAuthority(db,session);
    const rows=db.prepare(`SELECT id,created_at,updated_at,last_seen_at FROM push_subscriptions
      WHERE org_id=? AND site_id=? AND principal_type=? AND principal_id=? AND revoked_at IS NULL ORDER BY created_at DESC`)
      .all(session.org_id,session.site_id,session.principal_type,session.principal_id);
    return {adapter:adapter.mode,configured:adapter.mode==='webpush' && !!adapter.publicKey,
      publicKey:adapter.mode==='webpush'?adapter.publicKey:null,
      subscriptions:rows.map(row=>({id:row.id,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),lastSeenAt:iso(row.last_seen_at)}))};
  });
}

function deliveryContext(db,row) {
  return db.prepare(`SELECT d.id,d.attempts,d.adapter,d.event_id,d.subscription_id,e.kind,e.audience,e.recipient_id,
      e.org_id,e.site_id,s.endpoint,s.p256dh,s.auth,s.expires_at,s.session_hash,s.principal_type,s.principal_id,
      w.language AS worker_language,ss.staff_interface_language
    FROM push_deliveries d JOIN notification_events e ON e.id=d.event_id
    JOIN push_subscriptions s ON s.id=d.subscription_id
    LEFT JOIN workers w ON s.principal_type='worker' AND w.id=s.principal_id AND w.org_id=s.org_id AND w.site_id=s.site_id
    LEFT JOIN site_settings ss ON ss.org_id=s.org_id AND ss.site_id=s.site_id
    WHERE d.id=?`).get(row.id);
}

function recipientActive(db,context,now) {
  if(context.principal_type!==context.audience || context.principal_id!==context.recipient_id) return false;
  const session=db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND org_id=? AND site_id=? AND principal_type=? AND principal_id=?
    AND revoked_at IS NULL AND expires_at>?`).get(context.session_hash,context.org_id,context.site_id,context.principal_type,context.principal_id,now);
  if(!session) return false;
  if(context.principal_type==='worker') return !!db.prepare('SELECT 1 FROM workers WHERE id=? AND org_id=? AND site_id=? AND active=1')
    .get(context.principal_id,context.org_id,context.site_id);
  return !!db.prepare('SELECT 1 FROM staff WHERE id=? AND org_id=? AND site_id=? AND active=1').get(context.principal_id,context.org_id,context.site_id);
}

function recoverStale(db,now) {
  const stale=new Date(Date.parse(now)-10*60*1000).toISOString();
  db.prepare(`UPDATE push_deliveries SET state='uncertain',last_error='delivery_unconfirmed',updated_at=?
    WHERE state='sending' AND updated_at<?`).run(now,stale);
}

export async function processOnePushDelivery(db,adapter,{now=NOW()}={}) {
  ensureNotificationEventSchema(db);
  const claimed=transaction(db,()=>{
    recoverStale(db,now);
    const due=db.prepare(`SELECT id FROM push_deliveries WHERE state='queued' AND next_attempt_at<=?
      ORDER BY next_attempt_at,created_at LIMIT 1`).get(now);
    if(!due) return null;
    const context=deliveryContext(db,due);
    if(!context) {db.prepare("UPDATE push_deliveries SET state='failed',last_error='event_missing',updated_at=? WHERE id=?").run(now,due.id);return {skip:true};}
    const subscription=db.prepare('SELECT * FROM push_subscriptions WHERE id=?').get(context.subscription_id);
    if(!subscription || subscription.revoked_at || !recipientActive(db,context,now)) {
      db.prepare("UPDATE push_deliveries SET state='expired',last_error='recipient_unavailable',updated_at=? WHERE id=?").run(now,due.id);
      if(subscription && !subscription.revoked_at) revokeRow(db,subscription,'recipient_unavailable',now);
      return {skip:true};
    }
    db.prepare("UPDATE push_deliveries SET state='sending',attempts=attempts+1,adapter=?,last_error=NULL,updated_at=? WHERE id=?")
      .run(adapter.mode,now,due.id);
    const language=context.principal_type==='worker'?context.worker_language:context.staff_interface_language;
    let copy;
    try {copy=pushCopy(context.kind,language || 'en');} catch {copy=null;}
    return {id:due.id,attempts:context.attempts+1,subscription:{endpoint:context.endpoint,p256dh:context.p256dh,auth:context.auth},
      payload:copy?{...copy,tag:`understood-${context.kind}`,url:'/#notifications'}:null};
  });
  if(!claimed) return false;
  if(claimed.skip) return true;
  if(!claimed.payload) {
    transaction(db,()=>db.prepare("UPDATE push_deliveries SET state='failed',last_error='payload_unavailable',updated_at=? WHERE id=?").run(NOW(),claimed.id));
    return true;
  }
  if(adapter.mode==='disabled') {
    transaction(db,()=>db.prepare("UPDATE push_deliveries SET state='failed',last_error='push_disabled',updated_at=? WHERE id=?").run(NOW(),claimed.id));
    return true;
  }
  let outcome;
  try {outcome=await adapter.send(claimed.subscription,claimed.payload);}
  catch(error){outcome={error};}
  const finished=NOW();
  transaction(db,()=>{
    const delivery=db.prepare('SELECT * FROM push_deliveries WHERE id=?').get(claimed.id);
    if(!delivery || delivery.state!=='sending') return;
    if(outcome?.accepted) {
      db.prepare("UPDATE push_deliveries SET state='accepted',accepted_at=?,last_error=NULL,updated_at=? WHERE id=?")
        .run(finished,finished,claimed.id);
      return;
    }
    const status=outcome?.error?.statusCode ?? outcome?.error?.status;
    if(status===404 || status===410) {
      db.prepare("UPDATE push_deliveries SET state='expired',last_error='push_expired',updated_at=? WHERE id=?").run(finished,claimed.id);
      const subscription=db.prepare('SELECT * FROM push_subscriptions WHERE id=?').get(delivery.subscription_id);
      if(subscription && !subscription.revoked_at) revokeRow(db,subscription,'push_expired',finished);
      return;
    }
    if([400,401,403].includes(status)) {
      db.prepare("UPDATE push_deliveries SET state='failed',last_error=?,updated_at=? WHERE id=?")
        .run(`push_http_${status}`,finished,claimed.id);
      return;
    }
    if(claimed.attempts>=pushRetryLimit) {
      db.prepare("UPDATE push_deliveries SET state='uncertain',last_error='delivery_unconfirmed',updated_at=? WHERE id=?")
        .run(finished,claimed.id);
      return;
    }
    db.prepare("UPDATE push_deliveries SET state='queued',next_attempt_at=?,last_error='retry_scheduled',updated_at=? WHERE id=?")
      .run(retryAt(claimed.attempts,Date.parse(finished)),finished,claimed.id);
  });
  return true;
}
