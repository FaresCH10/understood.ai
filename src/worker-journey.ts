export type WorkStatus='sent'|'in-progress'|'follow-up'|'done';
export type WorkFilter='active'|'sent'|'in-progress'|'follow-up'|'done'|'all';
export type WorkerWorkItem={id:string;publicationId?:string;briefingId:string;title:string;version:number;publicationState:string;status:WorkStatus;language:string;dueAt:string|null;supervisorName:string|null;sentAt:string;completedAt:string|null;contentExpired:boolean;responseStatus:'pending'|'received'|'waiting';canComplete:boolean;hasSupervisorReply?:boolean};
export type WorkerWorkPage={items:WorkerWorkItem[];total:number;page:number;pageSize:number;counts:{active:number;sent:number;inProgress:number;followUp:number;done:number;total:number}};
export function workListPath(filter:WorkFilter,page:number,search=''){
  if(!['active','sent','in-progress','follow-up','done','all'].includes(filter)||!Number.isSafeInteger(page)||page<1||page>5000||search.length>80)throw Error('Invalid work filter');
  return '/api/workspace/work?'+new URLSearchParams({status:filter,page:String(page),pageSize:'10',...(search.trim()?{search:search.trim()}:{})});
}
export function workJourneyStep(item:Pick<WorkerWorkItem,'status'|'responseStatus'>){
  return item.status==='done'?3:item.status==='in-progress'?2:1;
}
export function workItemOverdue(item:Pick<WorkerWorkItem,'dueAt'|'status'|'publicationState'>,now=Date.now()){
  return item.status!=='done'&&item.publicationState==='published'&&!!item.dueAt&&Date.parse(item.dueAt)<=now;
}
