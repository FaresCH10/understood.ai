import {randomUUID,createHash} from 'node:crypto';
import {domainTransaction,requirePrincipal} from './domain.mjs';
import {notificationFilters,notificationWindow,notificationId} from '../notification-input.mjs';
import {
  workerEventKinds,workerEventLabels,staffPushKinds,notificationEventRef,pushSubscriptionInput,pushSubscriptionId,
  pushSubscriptionLimit,pushRetryLimit,retryAt,notificationEventKind,
} from '../notification-event-input.mjs';
import {pushCopy} from '../push-copy.mjs';

const iso=value=>value instanceof Date?value.toISOString():value;
const endpointHash=endpoint=>createHash('sha256').update(endpoint).digest('hex');

async function sessionAuthority(client,session) {
  if(!session || !['staff','worker'].includes(session.principal_type)) throw new Error('Forbidden');
  if(typeof session.token_hash!=='string' || !/^[a-f0-9]{64}$/.test(session.token_hash)) throw new Error('Sign in required');
  const live=(await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND org_id=$2 AND site_id=$3 AND principal_type=$4
    AND principal_id=$5 AND revoked_at IS NULL AND expires_at>clock_timestamp()`,
  [session.token_hash,session.org_id,session.site_id,session.principal_type,session.principal_id])).rows[0];
  if(!live) throw new Error('Sign in required');
  await requirePrincipal(client,session,session.principal_type,session.principal_type==='staff'?['owner','supervisor','auditor']:['owner','supervisor']);
}
async function workerAuthority(client,session) {
  if(session?.principal_type!=='worker') throw new Error('Forbidden');
  await sessionAuthority(client,session);
}
function eventRow(row,kind) {
  return {id:row.id,kind,label:workerEventLabels[kind],destination:workerEventKinds[kind].destination,
    objectType:row.object_type,objectId:row.object_id,occurredAt:iso(row.created_at),readAt:iso(row.read_at) ?? null};
}

export function listWorkerNotifications(pool,session,filters={},{schema='public'}={}) {
  const {status,page,pageSize}=notificationFilters(filters);
  return domainTransaction(pool,schema,async client=>{
    await workerAuthority(client,session);
    const {asOf,since}=notificationWindow(),kinds=Object.keys(workerEventKinds);
    const args=[session.principal_id,session.org_id,session.site_id,session.principal_id,since,asOf,kinds];
    const join=`FROM notification_events e LEFT JOIN notification_event_reads r ON r.event_id=e.id
      AND r.principal_type='worker' AND r.principal_id=$1 AND r.org_id=e.org_id AND r.site_id=e.site_id`;
    const where=`e.org_id=$2 AND e.site_id=$3 AND e.audience='worker' AND e.recipient_id=$4 AND e.created_at>=$5 AND e.created_at<=$6
      AND e.kind=ANY($7::text[])`;
    const totals=(await client.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE r.event_id IS NULL)::int AS unread
      ${join} WHERE ${where}`,args)).rows[0];
    const rows=(await client.query(`SELECT e.id,e.kind,e.object_type,e.object_id,e.created_at,r.read_at ${join} WHERE ${where}
      ${status==='unread'?'AND r.event_id IS NULL':''} ORDER BY e.created_at DESC,e.id DESC LIMIT $8 OFFSET $9`,
    [...args,pageSize,(page-1)*pageSize])).rows;
    return {items:rows.map(row=>eventRow(row,row.kind)),total:status==='unread'?totals.unread:totals.total,unread:totals.unread,page,pageSize,asOf,since};
  });
}

export function readWorkerNotification(pool,session,id,{schema='public'}={}) {
  notificationId(id);
  return domainTransaction(pool,schema,async client=>{
    await workerAuthority(client,session);
    const {asOf,since}=notificationWindow(),kinds=Object.keys(workerEventKinds);
    const event=(await client.query(`SELECT id,kind,object_type,object_id,created_at FROM notification_events
      WHERE id=$1 AND org_id=$2 AND site_id=$3 AND audience='worker' AND recipient_id=$4 AND created_at>=$5 AND created_at<=$6
        AND kind=ANY($7::text[])`,[id,session.org_id,session.site_id,session.principal_id,since,asOf,kinds])).rows[0];
    if(!event) throw new Error('Notification unavailable');
    await client.query(`INSERT INTO notification_event_reads(event_id,principal_type,principal_id,org_id,site_id,read_at)
      VALUES($1,'worker',$2,$3,$4,$5) ON CONFLICT(event_id,principal_type,principal_id) DO NOTHING`,
    [id,session.principal_id,session.org_id,session.site_id,asOf]);
    const receipt=(await client.query(`SELECT read_at FROM notification_event_reads
      WHERE event_id=$1 AND principal_type='worker' AND principal_id=$2 AND org_id=$3 AND site_id=$4`,
    [id,session.principal_id,session.org_id,session.site_id])).rows[0];
    return eventRow({...event,read_at:receipt.read_at},event.kind);
  });
}

export function workerNotificationReceipt(pool,session,id,{schema='public'}={}) {
  notificationId(id);
  return domainTransaction(pool,schema,async client=>{
    await workerAuthority(client,session);
    const row=(await client.query(`SELECT e.id,e.kind,e.object_type,e.object_id,e.created_at,r.read_at
      FROM notification_event_reads r JOIN notification_events e ON e.id=r.event_id AND e.org_id=r.org_id AND e.site_id=r.site_id
      WHERE r.event_id=$1 AND r.principal_type='worker' AND r.principal_id=$2 AND r.org_id=$3 AND r.site_id=$4`,
    [id,session.principal_id,session.org_id,session.site_id])).rows[0];
    return row?{found:true,item:eventRow(row,row.kind)}:{found:false};
  });
}

async function enqueueDeliveries(client,eventId,orgId,siteId,audience,recipientId,now) {
  const subscriptions=(await client.query(`SELECT id FROM push_subscriptions
    WHERE org_id=$1 AND site_id=$2 AND principal_type=$3 AND principal_id=$4 AND revoked_at IS NULL`,[orgId,siteId,audience,recipientId])).rows;
  for(const subscription of subscriptions) {
    await client.query(`INSERT INTO push_deliveries(id,event_id,subscription_id,state,attempts,adapter,next_attempt_at,accepted_at,last_error,created_at,updated_at)
      VALUES($1,$2,$3,'queued',0,NULL,$4,NULL,NULL,$4,$4) ON CONFLICT(event_id,subscription_id) DO NOTHING`,
    [randomUUID(),eventId,subscription.id,now]);
  }
}

export async function recordWorkerEvent(client,{orgId,siteId,workerId,kind,objectType,objectId,dedupeKey,now=new Date()}) {
  notificationEventKind(kind,'worker');notificationEventRef(dedupeKey);
  if(typeof orgId!=='string' || typeof siteId!=='string' || typeof workerId!=='string') throw new Error('Invalid notification event');
  const id=randomUUID();
  const inserted=(await client.query(`INSERT INTO notification_events
    (id,org_id,site_id,audience,recipient_id,kind,object_type,object_id,dedupe_key,created_at)
    VALUES($1,$2,$3,'worker',$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
  [id,orgId,siteId,workerId,kind,String(objectType).slice(0,40),String(objectId).slice(0,120),dedupeKey,now])).rows[0];
  if(!inserted) return false;
  await enqueueDeliveries(client,id,orgId,siteId,'worker',workerId,now);
  return true;
}

export async function recordStaffPushEvent(client,{orgId,siteId,auditId,action,objectId,now=new Date()}) {
  if(!staffPushKinds.includes(action) || typeof auditId!=='string' || auditId.length<1 || auditId.length>100) return false;
  const recipients=(await client.query(`SELECT id FROM staff WHERE org_id=$1 AND site_id=$2 AND role IN ('owner','supervisor') AND active=true ORDER BY id`,[orgId,siteId])).rows;
  let created=false;
  for(const recipient of recipients) {
    const eventId=randomUUID();
    const inserted=(await client.query(`INSERT INTO notification_events
      (id,org_id,site_id,audience,recipient_id,kind,object_type,object_id,dedupe_key,created_at)
      VALUES($1,$2,$3,'staff',$4,$5,'audit',$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
    [eventId,orgId,siteId,recipient.id,action,String(auditId).slice(0,120),`staff:${auditId}`,now])).rows[0];
    if(!inserted) continue;
    created=true;
    await enqueueDeliveries(client,eventId,orgId,siteId,'staff',recipient.id,now);
  }
  return created;
}

export async function staffAuditOnce(client,{orgId,siteId,action,objectId,actorId='notification-worker',now=new Date()}) {
  if(!staffPushKinds.includes(action)) throw new Error('Invalid notification event');
  if(typeof orgId!=='string' || typeof siteId!=='string' || typeof objectId!=='string' || !objectId) throw new Error('Invalid notification event');
  const existing=(await client.query('SELECT id FROM audit WHERE org_id=$1 AND site_id=$2 AND action=$3 AND object_id=$4 ORDER BY occurred_at LIMIT 1',[orgId,siteId,action,objectId])).rows[0];
  if(existing) return false;
  const auditId=randomUUID();
  await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id,occurred_at)
    VALUES($1,$2,$3,'system',$4,$5,$6,$7)`,[auditId,orgId,siteId,actorId,action,objectId,now]);
  await recordStaffPushEvent(client,{orgId,siteId,auditId,action,objectId,now});
  return true;
}

let overdueSweepAt=0;
export function sweepOverdueAssignments(pool,{schema='public',limit=50,force=false,intervalMs=300000}={}) {
  const started=Date.now();
  if(!force && started-overdueSweepAt<intervalMs) return Promise.resolve(0);
  overdueSweepAt=started;
  return domainTransaction(pool,schema,async client=>{
    const rows=(await client.query(`SELECT a.id,a.org_id,a.site_id FROM assignments a
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.due_at IS NOT NULL AND a.due_at<=clock_timestamp() AND p.state='published'
        AND NOT EXISTS(SELECT 1 FROM submission_receipts sr WHERE sr.assignment_id=a.id AND sr.org_id=a.org_id)
      AND NOT EXISTS(SELECT 1 FROM acknowledgments ak WHERE ak.assignment_id=a.id AND ak.org_id=a.org_id)
        AND NOT EXISTS(SELECT 1 FROM audit au WHERE au.org_id=a.org_id AND au.site_id=a.site_id
          AND au.action='assignment.overdue' AND au.object_id=a.id)
      ORDER BY a.due_at,a.id LIMIT $1 FOR UPDATE OF a SKIP LOCKED`,[limit])).rows;
    let count=0;
    for(const row of rows)
      if(await staffAuditOnce(client,{orgId:row.org_id,siteId:row.site_id,action:'assignment.overdue',objectId:row.id}))count++;
    return count;
  });
}

async function revokeRow(client,row,reason,now) {
  await client.query(`UPDATE push_subscriptions SET revoked_at=$1,revoke_reason=$2,updated_at=$1 WHERE id=$3 AND revoked_at IS NULL`,
    [now,String(reason).slice(0,40),row.id]);
  await client.query(`UPDATE push_deliveries SET state='cancelled',last_error=$1,updated_at=$2
    WHERE subscription_id=$3 AND state IN ('queued','sending')`,[String(reason).slice(0,40),now,row.id]);
}

export function savePushSubscription(pool,session,input,{schema='public'}={}) {
  const value=pushSubscriptionInput(input);
  return domainTransaction(pool,schema,async client=>{
    await sessionAuthority(client,session);
    const now=new Date(),hash=endpointHash(value.endpoint);
    const active=(await client.query('SELECT * FROM push_subscriptions WHERE endpoint_hash=$1 AND revoked_at IS NULL FOR UPDATE',[hash])).rows[0];
    if(active) {
      const same=active.org_id===session.org_id && active.site_id===session.site_id
        && active.principal_type===session.principal_type && active.principal_id===session.principal_id;
      if(same) {
        await client.query(`UPDATE push_subscriptions SET p256dh=$1,auth=$2,expires_at=$3,session_hash=$4,updated_at=$5,last_seen_at=$5 WHERE id=$6`,
          [value.p256dh,value.auth,value.expirationTime,session.token_hash,now,active.id]);
        return {id:active.id,createdAt:iso(active.created_at),updatedAt:now.toISOString(),reused:true,reassigned:false};
      }
      await revokeRow(client,active,'endpoint_reassigned',now);
    }
    const count=(await client.query(`SELECT COUNT(*)::int AS n FROM push_subscriptions
      WHERE org_id=$1 AND site_id=$2 AND principal_type=$3 AND principal_id=$4 AND revoked_at IS NULL`,
    [session.org_id,session.site_id,session.principal_type,session.principal_id])).rows[0].n;
    if(count>=pushSubscriptionLimit) throw new Error('Too many push subscriptions');
    const id=randomUUID();
    await client.query(`INSERT INTO push_subscriptions
      (id,org_id,site_id,principal_type,principal_id,session_hash,endpoint_hash,endpoint,p256dh,auth,expires_at,created_at,updated_at,last_seen_at,revoked_at,revoke_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$12,NULL,NULL)`,
    [id,session.org_id,session.site_id,session.principal_type,session.principal_id,session.token_hash,hash,
      value.endpoint,value.p256dh,value.auth,value.expirationTime,now]);
    return {id,createdAt:now.toISOString(),updatedAt:now.toISOString(),reused:false,reassigned:!!active};
  });
}

export function revokePushSubscription(pool,session,id,{schema='public'}={}) {
  pushSubscriptionId(id);
  return domainTransaction(pool,schema,async client=>{
    await sessionAuthority(client,session);
    const row=(await client.query(`SELECT * FROM push_subscriptions WHERE id=$1 AND org_id=$2 AND site_id=$3
      AND principal_type=$4 AND principal_id=$5 AND revoked_at IS NULL`,[id,session.org_id,session.site_id,session.principal_type,session.principal_id])).rows[0];
    if(!row) throw new Error('Push subscription unavailable');
    await revokeRow(client,row,'user_revoked',new Date());
    return {ok:true};
  });
}

export async function revokeSessionPushSubscriptions(client,sessionHash,{now=new Date(),reason='signed_out'}={}) {
  if(typeof sessionHash!=='string' || !/^[a-f0-9]{64}$/.test(sessionHash)) return 0;
  const rows=(await client.query('SELECT * FROM push_subscriptions WHERE session_hash=$1 AND revoked_at IS NULL FOR UPDATE',[sessionHash])).rows;
  for(const row of rows) await revokeRow(client,row,reason,now);
  return rows.length;
}

export function expirePushSubscriptions(pool,{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{
    const now=new Date();
    const rows=(await client.query(`SELECT * FROM push_subscriptions s WHERE s.revoked_at IS NULL AND (
      (s.expires_at IS NOT NULL AND s.expires_at<=$1)
      OR NOT EXISTS(SELECT 1 FROM sessions se WHERE se.token_hash=s.session_hash AND se.org_id=s.org_id AND se.site_id=s.site_id
        AND se.principal_type=s.principal_type AND se.principal_id=s.principal_id AND se.revoked_at IS NULL AND se.expires_at>$1))
      FOR UPDATE`,[now])).rows;
    for(const row of rows) await revokeRow(client,row,'subscription_expired',now);
    return rows.length;
  });
}

export function pushSubscriptionStatus(pool,session,adapter={mode:'disabled',publicKey:null},{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{
    await sessionAuthority(client,session);
    const rows=(await client.query(`SELECT id,created_at,updated_at,last_seen_at FROM push_subscriptions
      WHERE org_id=$1 AND site_id=$2 AND principal_type=$3 AND principal_id=$4 AND revoked_at IS NULL ORDER BY created_at DESC`,
    [session.org_id,session.site_id,session.principal_type,session.principal_id])).rows;
    return {adapter:adapter.mode,configured:adapter.mode==='webpush' && !!adapter.publicKey,
      publicKey:adapter.mode==='webpush'?adapter.publicKey:null,
      subscriptions:rows.map(row=>({id:row.id,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),lastSeenAt:iso(row.last_seen_at)}))};
  });
}

async function recipientActive(client,context,now) {
  if(context.principal_type!==context.audience || context.principal_id!==context.recipient_id) return false;
  const session=(await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND org_id=$2 AND site_id=$3 AND principal_type=$4
    AND principal_id=$5 AND revoked_at IS NULL AND expires_at>$6`,[context.session_hash,context.org_id,context.site_id,context.principal_type,context.principal_id,now])).rows[0];
  if(!session) return false;
  const table=context.principal_type==='worker'?'workers':'staff';
  return !!(await client.query(`SELECT 1 FROM ${table} WHERE id=$1 AND org_id=$2 AND site_id=$3 AND active=true`,
    [context.principal_id,context.org_id,context.site_id])).rows[0];
}

export async function processOnePushDelivery(pool,adapter,{schema='public'}={}) {
  const claimed=await domainTransaction(pool,schema,async client=>{
    const now=new Date(),stale=new Date(now.getTime()-10*60*1000);
    await client.query(`UPDATE push_deliveries SET state='uncertain',last_error='delivery_unconfirmed',updated_at=$1
      WHERE state='sending' AND updated_at<$2`,[now,stale]);
    const due=(await client.query(`SELECT d.id FROM push_deliveries d WHERE d.state='queued' AND d.next_attempt_at<=$1
      ORDER BY d.next_attempt_at,d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`,[now])).rows[0];
    if(!due) return null;
    const context=(await client.query(`SELECT d.id,d.attempts,d.adapter,d.event_id,d.subscription_id,e.kind,e.audience,e.recipient_id,
        e.org_id,e.site_id,s.endpoint,s.p256dh,s.auth,s.expires_at,s.session_hash,s.principal_type,s.principal_id,
        w.language AS worker_language,ss.staff_interface_language
      FROM push_deliveries d JOIN notification_events e ON e.id=d.event_id
      JOIN push_subscriptions s ON s.id=d.subscription_id
      LEFT JOIN workers w ON s.principal_type='worker' AND w.id=s.principal_id AND w.org_id=s.org_id AND w.site_id=s.site_id
      LEFT JOIN site_settings ss ON ss.org_id=s.org_id AND ss.site_id=s.site_id
      WHERE d.id=$1`,[due.id])).rows[0];
    if(!context) {
      await client.query("UPDATE push_deliveries SET state='failed',last_error='event_missing',updated_at=$1 WHERE id=$2",[now,due.id]);
      return {skip:true};
    }
    const subscription=(await client.query('SELECT * FROM push_subscriptions WHERE id=$1',[context.subscription_id])).rows[0];
    if(!subscription || subscription.revoked_at || !await recipientActive(client,context,now)) {
      await client.query("UPDATE push_deliveries SET state='expired',last_error='recipient_unavailable',updated_at=$1 WHERE id=$2",[now,due.id]);
      if(subscription && !subscription.revoked_at) await revokeRow(client,subscription,'recipient_unavailable',now);
      return {skip:true};
    }
    await client.query("UPDATE push_deliveries SET state='sending',attempts=attempts+1,adapter=$1,last_error=NULL,updated_at=$2 WHERE id=$3",
      [adapter.mode,now,due.id]);
    const language=context.principal_type==='worker'?context.worker_language:context.staff_interface_language;
    let copy;
    try {copy=pushCopy(context.kind,language || 'en');} catch {copy=null;}
    return {id:due.id,attempts:context.attempts+1,subscription:{endpoint:context.endpoint,p256dh:context.p256dh,auth:context.auth},
      payload:copy?{...copy,tag:`understood-${context.kind}`,url:'/#notifications'}:null};
  });
  if(!claimed) return false;
  if(claimed.skip) return true;
  if(!claimed.payload) {
    await domainTransaction(pool,schema,client=>client.query("UPDATE push_deliveries SET state='failed',last_error='payload_unavailable',updated_at=$1 WHERE id=$2",[new Date(),claimed.id]));
    return true;
  }
  if(adapter.mode==='disabled') {
    await domainTransaction(pool,schema,client=>client.query("UPDATE push_deliveries SET state='failed',last_error='push_disabled',updated_at=$1 WHERE id=$2",[new Date(),claimed.id]));
    return true;
  }
  let outcome;
  try {outcome=await adapter.send(claimed.subscription,claimed.payload);}
  catch(error){outcome={error};}
  await domainTransaction(pool,schema,async client=>{
    const delivery=(await client.query('SELECT * FROM push_deliveries WHERE id=$1 FOR UPDATE',[claimed.id])).rows[0];
    if(!delivery || delivery.state!=='sending') return;
    const finished=new Date(),status=outcome?.error?.statusCode ?? outcome?.error?.status;
    if(outcome?.accepted) {
      await client.query("UPDATE push_deliveries SET state='accepted',accepted_at=$1,last_error=NULL,updated_at=$1 WHERE id=$2",[finished,claimed.id]);
      return;
    }
    if(status===404 || status===410) {
      await client.query("UPDATE push_deliveries SET state='expired',last_error='push_expired',updated_at=$1 WHERE id=$2",[finished,claimed.id]);
      const subscription=(await client.query('SELECT * FROM push_subscriptions WHERE id=$1',[delivery.subscription_id])).rows[0];
      if(subscription && !subscription.revoked_at) await revokeRow(client,subscription,'push_expired',finished);
      return;
    }
    if([400,401,403].includes(status)) {
      await client.query("UPDATE push_deliveries SET state='failed',last_error=$1,updated_at=$2 WHERE id=$3",[`push_http_${status}`,finished,claimed.id]);
      return;
    }
    if(claimed.attempts>=pushRetryLimit) {
      await client.query("UPDATE push_deliveries SET state='uncertain',last_error='delivery_unconfirmed',updated_at=$1 WHERE id=$2",[finished,claimed.id]);
      return;
    }
    await client.query("UPDATE push_deliveries SET state='queued',next_attempt_at=$1,last_error='retry_scheduled',updated_at=$2 WHERE id=$3",
      [retryAt(claimed.attempts,finished.getTime()),finished,claimed.id]);
  });
  return true;
}
