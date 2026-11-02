import {draftInput,reviewInput,expectedRevision} from './briefing-input.mjs';
const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function templateRequestId(value) {if(!uuid(value)) throw new Error('Invalid template request');return value;}
export const templateRecoveryScope=session=>session?.principal_type==='staff' && ['owner','supervisor'].includes(session.role) ? JSON.stringify([session.org_id,session.site_id,session.principal_id]) : null;
export function templateInput(kind,id,input) {
  if(!['create','edit','archive','restore','duplicate','use'].includes(kind) || !input || typeof input!=='object' || Array.isArray(input)
    || !uuid(input.requestId) || input.confirmed!==true || (kind!=='create' && (typeof id!=='string' || !id || id.length>100))) throw new Error('Invalid template request');
  const content=['create','edit'].includes(kind),title=['duplicate','use'].includes(kind);
  const allowed=['requestId','confirmed',...(kind==='create' ? [] : ['revision']),...(content ? ['title','source','description','question','facts','askedFacts'] : title ? ['title'] : [])];
  if(Object.keys(input).some(key=>!allowed.includes(key))) throw new Error('Invalid template request');
  if(kind!=='create') expectedRevision(input.revision);
  const value={kind,id:kind==='create' ? input.requestId : id,...(kind==='create' ? {} : {revision:input.revision})};
  if(content) {
    const source=draftInput({requestId:input.requestId,title:input.title,source:input.source},'create');
    if(typeof input.description!=='string' || input.description.length>500) throw new Error('Invalid template request');
    const review=reviewInput({requestId:input.requestId,revision:1,confirmed:true,question:input.question,facts:input.facts,askedFacts:input.askedFacts});
    Object.assign(value,source,{description:input.description.trim(),question:review.question,facts:review.facts,askedFacts:review.askedFacts});
  } else if(title) {
    if(typeof input.title!=='string' || input.title.trim().length<3 || input.title.length>120) throw new Error('Invalid template request');
    value.title=input.title.trim();
  }
  if(new TextEncoder().encode(JSON.stringify(value)).length>14000) throw new Error('Invalid template request');
  return value;
}
export function templateSignature(value) {
  return JSON.stringify(['kind','id','revision','title','source','description','question','facts','askedFacts'].map(key=>value[key] ?? null));
}
export function templateContent(value) {
  return Object.fromEntries(['title','description','source','question','facts','askedFacts'].map(key=>[key,value[key]]));
}
export function templateFilters(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['search','status','favorites','page','pageSize'].includes(key))) throw new Error('Invalid template filter');
  const {search='',status='active',favorites='all'}=input,page=Number(input.page ?? 1),pageSize=Number(input.pageSize ?? 20);
  if(typeof search!=='string' || search.length>80 || !['active','archived','all'].includes(status) || !['all','only'].includes(favorites)
    || !Number.isSafeInteger(page) || page<1 || page>5000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw new Error('Invalid template filter');
  return {search:search.trim(),status,favorites,page,pageSize};
}
export function templateFavoriteInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length!==1 || typeof input.favorite!=='boolean') throw new Error('Invalid template favorite request');
  return input.favorite;
}
export function templateHistoryInput(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['page','version'].includes(key))) throw new Error('Invalid template filter');
  const page=Number(input.page ?? 1),version=input.version===undefined ? null : Number(input.version);
  if(!Number.isSafeInteger(page) || page<1 || page>5000 || (version!==null && (!Number.isSafeInteger(version) || version<1))) throw new Error('Invalid template filter');
  return {page,version};
}
