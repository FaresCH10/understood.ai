export const workerEventKinds = Object.freeze({
  'instruction.available': {destination:'inbox'},
  'clarification.followup': {destination:'help'},
  'repeat.available': {destination:'inbox'},
  'language.decided': {destination:'inbox'},
  'deadline.reminder': {destination:'inbox'},
});
export const workerEventLabels = Object.freeze({
  'instruction.available':'New instruction',
  'clarification.followup':'New follow-up',
  'repeat.available':'Repeat requested',
  'language.decided':'Language request updated',
  'deadline.reminder':'Deadline reminder',
});
export const staffPushKinds = Object.freeze([
  'help.requested',
  'clarification.assigned',
  'clarification.routed',
  'clarification.escalated',
  'clarification.message',
  'worker.language_requested',
  'answer.needs_attention',
  'instruction.send_incomplete',
  'assignment.overdue',
]);
export const pushEventKinds = Object.freeze([...Object.keys(workerEventKinds),...staffPushKinds]);
export const notificationEventRoles = Object.freeze(['owner','supervisor']);
export const pushAdapters = Object.freeze(['disabled','synthetic','webpush']);
export const pushDeliveryStates = Object.freeze(['queued','sending','accepted','uncertain','failed','cancelled','expired']);
export const pushSubscriptionLimit = 10;
export const pushRetryLimit = 5;

const pushHosts = Object.freeze([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
]);
const pushHostSuffixes = Object.freeze(['.push.services.mozilla.com','.push.apple.com','.notify.windows.com']);

function inputObject(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid push subscription');
  if (Object.keys(input).some((key)=>!keys.includes(key))) throw new Error('Invalid push subscription');
  return input;
}
function base64url(value, bytes, label) {
  if (typeof value!=='string' || value.length<4 || value.length>256 || !/^[A-Za-z0-9_-]+={0,2}$/.test(value))
    throw new Error('Invalid push subscription');
  let decoded;
  try { decoded=Buffer.from(value.replace(/=+$/,''),'base64url'); } catch { throw new Error('Invalid push subscription'); }
  if (decoded.length!==bytes) throw new Error('Invalid push subscription');
  return value;
}
export function pushEndpoint(value) {
  if (typeof value!=='string' || value.length<20 || value.length>2048 || value!==value.trim())
    throw new Error('Invalid push subscription');
  let url;
  try { url=new URL(value); } catch { throw new Error('Invalid push subscription'); }
  if (url.protocol!=='https:' || url.username || url.password || url.hash) throw new Error('Invalid push subscription');
  const host=url.hostname.toLowerCase();
  if (!pushHosts.includes(host) && !pushHostSuffixes.some((suffix)=>host.endsWith(suffix)))
    throw new Error('Push service unavailable');
  return value;
}
export function pushSubscriptionInput(input) {
  inputObject(input,['endpoint','keys','expirationTime']);
  const endpoint=pushEndpoint(input.endpoint);
  if (!input.keys || typeof input.keys!=='object' || Array.isArray(input.keys)
    || Object.keys(input.keys).some((key)=>!['p256dh','auth'].includes(key)))
    throw new Error('Invalid push subscription');
  const p256dh=base64url(input.keys.p256dh,65,'p256dh'),auth=base64url(input.keys.auth,16,'auth');
  let expirationTime=null;
  if (input.expirationTime!==undefined && input.expirationTime!==null) {
    if (!Number.isFinite(input.expirationTime) || input.expirationTime<=0) throw new Error('Invalid push subscription');
    expirationTime=new Date(input.expirationTime).toISOString();
  }
  return {endpoint,p256dh,auth,expirationTime};
}
export function pushSubscriptionId(value) {
  if (typeof value!=='string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid push subscription');
  return value;
}
export function pushPayloadKind(kind) {
  if (!pushEventKinds.includes(kind)) throw new Error('Invalid notification event');
  return kind;
}
export function notificationEventKind(value,audience='worker') {
  const allowed=audience==='worker'?Object.keys(workerEventKinds):staffPushKinds;
  if (!allowed.includes(value)) throw new Error('Invalid notification event');
  return value;
}
export function notificationEventRef(value) {
  if (typeof value!=='string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) throw new Error('Invalid notification event');
  return value;
}
export function notificationEventId(value) {
  if (typeof value!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid notification request');
  return value;
}
export function retryAt(attempt,now=Date.now()) {
  const capped=Math.max(1,Math.min(attempt,10));
  return new Date(now+Math.min(60*60*1000,30*1000*2**(capped-1))).toISOString();
}
