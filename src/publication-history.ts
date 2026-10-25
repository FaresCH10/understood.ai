import type {PreparedArtifacts} from './language-artifacts';

export type PublicationSummary={id:string;version:number;state:string;published_at:string};
export type PublicationHistoryPage={briefingId:string;items:PublicationSummary[];total:number;page:number;pageSize:number;version:number|null};
export type PublicationDetail=PublicationSummary & {briefingId:string;snapshot:PreparedArtifacts;artifactAudio:unknown;metrics:{assigned:number;responses:number;matches:number;clarifications:number;unassessed:number;pending:number;completion:number;acknowledged?:number};withdrawal:{reason:string;withdrawn_by:string;occurred_at:string}|null};
const object=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value);
const identity=(value:unknown)=>typeof value==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const integer=(value:unknown,min=0)=>Number.isSafeInteger(value) && (value as number)>=min && (value as number)<=2147483647;
const date=(value:unknown)=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const summary=(value:unknown):value is PublicationSummary & Record<string,unknown>=>object(value) && identity(value.id) && integer(value.version,1) && ['published','withdrawn','superseded','archived'].includes(value.state as string) && date(value.published_at);

export function checkedPublicationHistory(value:unknown,briefingId:string,page:number,version:number|null):PublicationHistoryPage {
  if(!object(value) || Object.keys(value).some(key=>!['briefingId','items','total','page','pageSize','version'].includes(key))
    || value.briefingId!==briefingId || value.page!==page || value.pageSize!==20 || value.version!==version || !integer(value.total)
    || !Array.isArray(value.items) || value.items.length>20 || value.items.length!==Math.max(0,Math.min(20,(value.total as number)-(page-1)*20)))throw Error('Version history unavailable');
  const ids=new Set<string>();let previous=2147483648;
  for(const row of value.items){
    if(!summary(row) || Object.keys(row).some(key=>!['id','version','state','published_at'].includes(key)) || ids.has(row.id) || row.version>=previous || (version!==null && row.version!==version))throw Error('Version history unavailable');
    ids.add(row.id);previous=row.version;
  }
  return value as unknown as PublicationHistoryPage;
}

export function checkedPublicationDetail(value:unknown,briefingId:string,publicationId:string):PublicationDetail {
  if(!summary(value) || !object(value) || value.id!==publicationId || value.briefingId!==briefingId || !object(value.snapshot) || !object(value.metrics)
    || Object.keys(value).some(key=>!['id','briefingId','version','state','published_at','snapshot','artifactAudio','metrics','withdrawal'].includes(key)))throw Error('Selected version unavailable');
  const m=value.metrics,base=['assigned','responses','matches','clarifications','unassessed','pending','completion'];
  const acknowledged=Object.hasOwn(m,'acknowledged');
  if(Object.keys(m).length!==(acknowledged?8:7) || Object.keys(m).some(key=>![...base,'acknowledged'].includes(key))
    || !base.every(key=>integer(m[key])) || (acknowledged && !integer(m.acknowledged))
    || (m.completion as number)>100 || m.responses!==Number(m.matches)+Number(m.clarifications)+Number(m.unassessed)+(acknowledged?Number(m.acknowledged):0)
    || m.assigned!==Number(m.responses)+Number(m.pending) || m.completion!==(m.assigned?Math.round(Number(m.responses)/Number(m.assigned)*100):0))throw Error('Selected version unavailable');
  if(value.withdrawal!==null && (!object(value.withdrawal) || typeof value.withdrawal.reason!=='string' || value.withdrawal.reason.length>1000 || !identity(value.withdrawal.withdrawn_by) || !date(value.withdrawal.occurred_at)))throw Error('Selected version unavailable');
  return value as unknown as PublicationDetail;
}
