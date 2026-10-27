export const notificationKinds = Object.freeze({
  'briefing.prepared': {label:'Briefing preparation completed',destination:'briefings'},
  'briefing.published': {label:'Briefing published',destination:'briefings'},
  'briefing.withdrawn': {label:'Published briefing withdrawn',destination:'briefings'},
  'help.requested': {label:'Worker requested help',destination:'clarifications'},
  'clarification.assigned': {label:'Clarification assignment changed',destination:'clarifications'},
  'clarification.routed': {label:'New clarification routed to site contact',destination:'clarifications'},
  'clarification.escalated': {label:'Overdue clarification escalated',destination:'clarifications'},
  'clarification.resolved': {label:'Human follow-up recorded',destination:'clarifications'},
  'clarification.message': {label:'Clarification conversation updated',destination:'clarifications'},
  'worker.language_requested': {label:'Worker requested a language change',destination:'people'},
  'answer.needs_attention': {label:'Answer needs review or clarification',destination:'clarifications'},
  'instruction.send_incomplete': {label:'Instruction delivery was incomplete',destination:'briefings'},
  'assignment.overdue': {label:'Instruction assignment is overdue',destination:'briefings'},
  'export.ready': {label:'Report export ready',destination:'reports'},
  'export.failed': {label:'Report export failed',destination:'reports'},
});
export const notificationRoles=['owner','supervisor','auditor'];
export function notificationFilters(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['status','page','pageSize'].includes(key)))throw Error('Invalid notification filter');
  const status=input.status ?? 'all',page=Number(input.page ?? 1),pageSize=Number(input.pageSize ?? 20);
  if(!['all','unread'].includes(status) || !Number.isSafeInteger(page) || page<1 || page>5000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>50)throw Error('Invalid notification filter');
  return {status,page,pageSize};
}
export function notificationId(value) {
  if(typeof value!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw Error('Invalid notification request');
  return value;
}
const briefingNotificationActions=new Set(['briefing.prepared','briefing.published','briefing.withdrawn']);
export function notificationRow(row) {
  const kind=notificationKinds[row.action];
  if(!kind)throw Error('Notification unavailable');
  const iso=value=>value instanceof Date ? value.toISOString() : value;
  const title=typeof row.title==='string'?row.title.trim():'';
  const subject=briefingNotificationActions.has(row.action) && title && title.length<=120 && !/[\u0000-\u001f]/.test(title)?title:null;
  return {id:row.id,kind:row.action,label:kind.label,subject,destination:kind.destination,occurredAt:iso(row.occurred_at),readAt:iso(row.read_at) ?? null};
}
export function notificationWindow() {
  const asOf=new Date().toISOString();
  return {asOf,since:new Date(Date.parse(asOf)-90*86400000).toISOString()};
}
