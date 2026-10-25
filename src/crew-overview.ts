import {isWorkerLanguage,type WorkerLocaleCode} from '../server/languages.mjs';
export type CrewMetrics={assigned:number;responses:number;matches:number;clarifications:number;unassessed:number;pending:number;completion:number;acknowledged?:number};
export type CrewSummary={id:string;name:string;active:boolean;member_count:number;metrics:CrewMetrics|null};
type Contact={name:string;role:'owner'|'supervisor'};
export type CrewOverview={items:CrewSummary[];total:number;page:number;pageSize:number;site:{id:string;name:string;timezone:string};
  contacts:{primary:Contact|null;deputy:Contact|null};publication:{id:string;briefingId:string;version:number;title:string;publishedAt:string}|null;
  metrics:CrewMetrics|null;metricScope:'latest_publication_frozen_crew_audience';crewSnapshotAvailable:boolean;
  activity:{id:string;action:string;actor:string|null;item:string|null;occurredAt:string}[];asOf:string};
export type CrewMemberLanguage=WorkerLocaleCode;
export type CrewMemberPendingLanguage={id:string;currentLanguage:CrewMemberLanguage;requestedLanguage:CrewMemberLanguage;reason:string;requestedAt:string};
export type CrewMember={id:string;org_id:string;site_id:string;code:string;name:string|null;language:CrewMemberLanguage;
  language_selection_required:boolean;language_selected:boolean;language_selected_at:string|null;
  language_selected_by:'worker'|'staff'|'migration'|null;active:boolean;crew_id:string;crew_name:string;
  pending_language_request:CrewMemberPendingLanguage|null};
export type CrewMembers={items:CrewMember[];total:number;page:number;pageSize:number};
const record=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value);
const keys=(value:Record<string,unknown>,fields:string[])=>Object.keys(value).length===fields.length && fields.every(key=>Object.hasOwn(value,key));
const text=(value:unknown,max=100):value is string=>typeof value==='string' && !!value.trim() && value.length<=max && !/[\u0000-\u001f\u007f]/.test(value);
const id=(value:unknown):value is string=>typeof value==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const count=(value:unknown):value is number=>Number.isSafeInteger(value) && (value as number)>=0;
const date=(value:unknown):value is string=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const language=(value:unknown):value is CrewMemberLanguage=>isWorkerLanguage(value);
const fail=()=>{throw Error('Crew view cannot be verified');};
function scope(value:string) {let parsed;try{parsed=JSON.parse(value);}catch{fail();}if(!Array.isArray(parsed) || parsed.length!==3 || !parsed.every(item=>text(item)))fail();return parsed as string[];}
function metrics(value:unknown):value is CrewMetrics {
  const base=['assigned','responses','matches','clarifications','unassessed','pending','completion'];
  if(!record(value) || !(keys(value,base) || keys(value,[...base,'acknowledged'])) || !Object.values(value).every(count))return false;
  const m=value as unknown as CrewMetrics;
  return m.assigned<=5000 && m.responses+m.pending===m.assigned && m.matches+m.clarifications+m.unassessed+(m.acknowledged ?? 0)===m.responses
    && m.completion===(m.assigned?Math.round(m.responses/m.assigned*100):0);
}
function summary(value:unknown):value is CrewSummary {return record(value) && keys(value,['id','name','active','member_count','metrics']) && id(value.id) && text(value.name,80)
  && typeof value.active==='boolean' && count(value.member_count) && (value.metrics===null || metrics(value.metrics));}
function page(value:Record<string,unknown>,expected:{page:number;pageSize:number}) {
  if(!Array.isArray(value.items) || !count(value.total) || value.page!==expected.page || value.pageSize!==expected.pageSize || expected.page<1 || expected.page>5000
    || !Number.isInteger(expected.page) || !Number.isInteger(expected.pageSize) || expected.pageSize<1 || expected.pageSize>100
    || value.items.length>expected.pageSize || value.items.length!==Math.min(expected.pageSize,Math.max(0,(value.total as number)-(expected.page-1)*expected.pageSize)))fail();
}
function contact(value:unknown) {return value===null || record(value) && keys(value,['name','role']) && text(value.name,200) && ['owner','supervisor'].includes(value.role as string);}
export function readCrewOverview(value:unknown,expected:{page:number;pageSize:number;scope:string}):CrewOverview {
  if(!record(value) || !keys(value,['items','total','page','pageSize','site','contacts','publication','metrics','metricScope','crewSnapshotAvailable','activity','asOf']))fail();
  const data=value as Record<string,unknown>;page(data,expected);
  if(!(data.items as unknown[]).every(summary) || new Set((data.items as CrewSummary[]).map(row=>row.id)).size!==(data.items as CrewSummary[]).length)fail();
  if(!record(data.site) || !keys(data.site,['id','name','timezone']) || data.site.id!==scope(expected.scope)[1] || !text(data.site.name,200) || !text(data.site.timezone))fail();
  try{new Intl.DateTimeFormat('en',{timeZone:(data.site as Record<string,string>).timezone});}catch{fail();}
  if(!record(data.contacts) || !keys(data.contacts,['primary','deputy']) || !contact(data.contacts.primary) || !contact(data.contacts.deputy))fail();
  if(data.publication!==null && (!record(data.publication) || !keys(data.publication,['id','briefingId','version','title','publishedAt'])
    || !id(data.publication.id) || !id(data.publication.briefingId) || !count(data.publication.version) || !data.publication.version || !text(data.publication.title,500) || !date(data.publication.publishedAt)))fail();
  if(data.metricScope!=='latest_publication_frozen_crew_audience' || typeof data.crewSnapshotAvailable!=='boolean' || !date(data.asOf))fail();
  if(data.publication===null ? data.metrics!==null || data.crewSnapshotAvailable : !metrics(data.metrics))fail();
  if(data.crewSnapshotAvailable && (data.metrics as CrewMetrics).assigned===0)fail();
  for(const row of data.items as CrewSummary[])if(data.crewSnapshotAvailable ? !row.metrics || row.metrics.assigned>(data.metrics as CrewMetrics).assigned : row.metrics!==null)fail();
  if(data.crewSnapshotAvailable)for(const key of ['assigned','responses','matches','clarifications','unassessed','pending','acknowledged'] as const)
    if((data.items as CrewSummary[]).reduce((sum,row)=>sum+(row.metrics![key] ?? 0),0)>((data.metrics as CrewMetrics)[key] ?? 0))fail();
  const actions=['crew.created','crew.renamed','crew.archived','crew.restored','worker.created','worker.crew_moved'];
  if(!Array.isArray(data.activity) || data.activity.length>6 || !data.activity.every(row=>record(row) && keys(row,['id','action','actor','item','occurredAt'])
    && text(row.id) && actions.includes(row.action as string) && (row.actor===null || text(row.actor,200)) && (row.item===null || text(row.item,200)) && date(row.occurredAt))
    || new Set((data.activity as {id:string}[]).map(row=>row.id)).size!==(data.activity as unknown[]).length)fail();
  return data as unknown as CrewOverview;
}
export function readCrewMembers(value:unknown,expected:{page:number;pageSize:number;crewId:string;scope:string}):CrewMembers {
  if(!record(value) || !keys(value,['items','total','page','pageSize']))fail();
  const data=value as Record<string,unknown>;page(data,expected);const [orgId,siteId]=scope(expected.scope);
  const pending=(entry:unknown)=>entry===null || record(entry) && keys(entry,['id','currentLanguage','requestedLanguage','reason','requestedAt'])
    && id(entry.id) && language(entry.currentLanguage) && language(entry.requestedLanguage) && entry.requestedLanguage!==entry.currentLanguage
    && typeof entry.reason==='string' && entry.reason.length<=500 && !/[\u0000-\u001f\u007f]/.test(entry.reason) && date(entry.requestedAt);
  if(!(data.items as unknown[]).every(row=>record(row) && keys(row,['id','org_id','site_id','code','name','language','language_selection_required','language_selected','language_selected_at','language_selected_by','active','crew_id','crew_name','pending_language_request'])
    && id(row.id) && text(row.code,80) && (row.name===null || text(row.name,80)) && language(row.language)
    && row.org_id===orgId && row.site_id===siteId && row.active===true && row.crew_id===expected.crewId && text(row.crew_name,80)
    && typeof row.language_selection_required==='boolean' && row.language_selected===!row.language_selection_required
    && (row.language_selected_at===null || date(row.language_selected_at)) && !(row.language_selection_required && row.language_selected_at!==null)
    && (row.language_selected_by===null || ['worker','staff','migration'].includes(row.language_selected_by as string))
    && pending(row.pending_language_request))
    || new Set((data.items as CrewMember[]).map(row=>row.id)).size!==(data.items as CrewMember[]).length)fail();
  return data as unknown as CrewMembers;
}
export function readCrewChange(value:unknown,staffScope:string,expectedId?:string) {
  const fields=['id','org_id','site_id','name','active','member_count'],[orgId,siteId]=scope(staffScope);
  if(!record(value) || !keys(value,Object.hasOwn(value,'duplicate')?[...fields,'duplicate']:fields) || !id(value.id) || expectedId!==undefined && value.id!==expectedId
    || value.org_id!==orgId || value.site_id!==siteId || !text(value.name,80) || typeof value.active!=='boolean' || !count(value.member_count)
    || Object.hasOwn(value,'duplicate') && typeof value.duplicate!=='boolean')fail();
  return value as {id:string;org_id:string;site_id:string;name:string;active:boolean;member_count:number;duplicate?:boolean};
}
