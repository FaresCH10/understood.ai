const windows=new Set(['any','30','90','180']);

export function reverificationFilters(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['window','outcome'].includes(key))) throw Error('Invalid re-verification filter');
  const window=input.window ?? 'any',outcome=input.outcome ?? 'matched';
  if(!windows.has(window) || !['matched','response'].includes(outcome)) throw Error('Invalid re-verification filter');
  return {window,outcome,cutoff:window==='any' ? null : new Date(Date.now()-Number(window)*86400000).toISOString()};
}

export function reverificationPage(rows,filters,{truncated=false,now=new Date()}={}) {
  const iso=value=>value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  const items=rows.slice(0,5000).map(row=>({id:row.id,code:row.code,language:row.language,outcome:row.outcome,
    lastRespondedAt:iso(row.received_at),version:row.version}));
  return {items,total:items.length,window:filters.window,outcome:filters.outcome,truncated:truncated || rows.length>5000,asOf:now.toISOString()};
}
