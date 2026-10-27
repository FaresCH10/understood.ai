import {notificationKinds,notificationId} from '../server/notification-input.mjs';
export type NotificationItem={id:string;kind:string;label:string;subject:string|null;destination:string;occurredAt:string;readAt:string|null};
export type NotificationPage={items:NotificationItem[];total:number;unread:number;page:number;pageSize:number;asOf:string;since:string};
export type PendingNotification={requestId:string;body:Record<string,unknown>;item:NotificationItem};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const object=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value);
const keys=(value:Record<string,unknown>,expected:string[])=>Object.keys(value).sort().join(',')===expected.sort().join(',');
const date=(value:unknown)=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
export function checkedNotification(value:unknown):NotificationItem {
  if(!object(value) || !keys(value,['id','kind','label','subject','destination','occurredAt','readAt']))throw Error('Notification metadata cannot be verified.');
  notificationId(value.id);const kind=typeof value.kind==='string' && Object.hasOwn(notificationKinds,value.kind)?notificationKinds[value.kind]:null;
  if(!kind || value.label!==kind.label || value.destination!==kind.destination || !date(value.occurredAt)
    || value.subject!==null && (typeof value.subject!=='string' || !value.subject.trim() || value.subject.length>120 || /[\u0000-\u001f]/.test(value.subject))
    || value.readAt!==null && (!date(value.readAt) || Date.parse(value.readAt as string)<Date.parse(value.occurredAt as string)))throw Error('Notification metadata cannot be verified.');
  return {id:value.id as string,kind:value.kind as string,label:kind.label,subject:(value.subject as string|null) ?? null,destination:kind.destination,occurredAt:value.occurredAt as string,readAt:value.readAt as string|null};
}
export function checkedNotificationPage(value:unknown,page:number,status:string):NotificationPage {
  if(!Number.isSafeInteger(page) || page<1 || page>5000 || !['all','unread'].includes(status) || !object(value) || !keys(value,['items','total','unread','page','pageSize','asOf','since']) || !Array.isArray(value.items) || value.items.length>20
    || value.page!==page || value.pageSize!==20 || !Number.isSafeInteger(value.total) || Number(value.total)<0 || !Number.isSafeInteger(value.unread) || Number(value.unread)<0
    || Number(value.unread)>Number(value.total) || status==='unread' && value.unread!==value.total || !date(value.asOf) || !date(value.since)
    || Date.parse(value.asOf as string)-Date.parse(value.since as string)!==90*86400000)throw Error('Notification page cannot be verified.');
  const items=value.items.map(checkedNotification);
  if(items.length>Number(value.total) || new Set(items.map(item=>item.id)).size!==items.length || items.some(item=>status==='unread' && item.readAt!==null || item.occurredAt<(value.since as string) || item.occurredAt>(value.asOf as string)))throw Error('Notification page cannot be verified.');
  return {...value,items} as NotificationPage;
}
export function pendingNotificationSignature(value:PendingNotification) {
  if(!object(value) || !keys(value,['requestId','body','item']) || !object(value.body) || Object.keys(value.body).length)throw Error('Invalid saved notification request.');
  const item=checkedNotification(value.item);
  if(value.requestId!==item.id || item.readAt!==null)throw Error('Invalid saved notification request.');
  return JSON.stringify(item);
}
const key=(scope:string)=>`understood:notification-read:${scope}`;
export function readPendingNotification(storage:Store,scope:string):PendingNotification|null {
  const raw=storage.getItem(key(scope));if(raw===null)return null;
  try {if(raw.length>2048)throw Error();const value=JSON.parse(raw);pendingNotificationSignature(value);return value;}catch{throw Error('Saved notification read cannot be verified. It has not been repeated or removed.');}
}
export function savePendingNotification(storage:Store,scope:string,value:PendingNotification) {
  const signature=pendingNotificationSignature(value),old=readPendingNotification(storage,scope),raw=JSON.stringify(value);
  if(old && (old.requestId!==value.requestId || pendingNotificationSignature(old)!==signature))throw Error('Recover the saved notification read first.');
  if(raw.length>2048)throw Error('Saved notification read exceeds its limit.');storage.setItem(key(scope),raw);
  if(storage.getItem(key(scope))!==raw)throw Error('This tab cannot retain the notification read. No request was sent.');
}
export function clearPendingNotification(storage:Store,scope:string,id:string,expected:PendingNotification) {
  const old=readPendingNotification(storage,scope);
  if(!old || old.requestId!==id || pendingNotificationSignature(old)!==pendingNotificationSignature(expected))throw Error('Saved notification read changed.');
  storage.removeItem(key(scope));if(storage.getItem(key(scope))!==null)throw Error('Saved notification read could not be cleared.');
}
export function checkedNotificationResult(value:unknown,pending:PendingNotification) {
  pendingNotificationSignature(pending);const result=checkedNotification(value);
  if(result.readAt===null || JSON.stringify({...result,readAt:null})!==pendingNotificationSignature(pending))throw Error('Notification read receipt does not match the original event.');
  return result;
}
export function checkedNotificationReceipt(value:unknown,pending:PendingNotification) {
  if(object(value) && keys(value,['found']) && value.found===false)return null;
  if(!object(value) || !keys(value,['found','item']) || value.found!==true)throw Error('Notification read receipt cannot be verified.');
  return checkedNotificationResult(value.item,pending);
}
