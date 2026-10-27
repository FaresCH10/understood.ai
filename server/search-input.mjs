export const searchRoles=['owner','supervisor','auditor'];
export const searchKinds=['briefing','worker','crew'];
export function searchFilters(input={}){
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['query','kind','page','pageSize'].includes(key)))throw Error('Invalid search request');
  const query=typeof input.query==='string'?input.query.trim():'';
  const kind=input.kind??'all',page=Number(input.page??1),pageSize=Number(input.pageSize??20);
  if(!query || query.length>80 || /[\u0000-\u001f\u007f]/.test(query) || !['all',...searchKinds].includes(kind)
    || !Number.isSafeInteger(page) || page<1 || page>10000 || !Number.isSafeInteger(pageSize) || pageSize<1 || pageSize>20)throw Error('Invalid search request');
  return {query,kind,page,pageSize};
}
export function searchQuery(params){
  const input=Object.create(null);for(const [key,value] of params){if(Object.hasOwn(input,key))throw Error('Invalid search request');input[key]=value;}
  return searchFilters(input);
}
export const allowedSearchKinds=(role,archived)=>searchRoles.includes(role)?role==='auditor' || archived?['briefing']:[...searchKinds]:[];
export function searchSelect(kind,where){
  const columns={briefing:{table:'briefings',label:'title',status:"CASE WHEN EXISTS(SELECT 1 FROM briefing_archives a WHERE a.briefing_id=t.id AND a.org_id=t.org_id AND a.site_id=t.site_id) THEN 'archived' ELSE COALESCE((SELECT p.state FROM publications p WHERE p.briefing_id=t.id AND p.org_id=t.org_id AND p.site_id=t.site_id ORDER BY p.version DESC LIMIT 1),state) END"},
    worker:{table:'workers',label:'code',status:"CASE WHEN active THEN 'active' ELSE 'inactive' END"},
    crew:{table:'crews',label:'name',status:"CASE WHEN active THEN 'active' ELSE 'archived' END"}}[kind];
  if(!columns)throw Error('Invalid search category');
  return `SELECT '${kind}' AS kind,id,${columns.label} AS label,${columns.status} AS status FROM ${columns.table} t WHERE ${where(columns.label)}`;
}
export function searchPage(rows,counts,filters,kinds){
  const selected=filters.kind==='all'?kinds:[filters.kind];
  return {items:rows.map(({id,kind,label,status})=>({id,kind,label,status})),counts,
    total:selected.reduce((n,kind)=>n+counts[kind],0),...filters,kinds};
}
