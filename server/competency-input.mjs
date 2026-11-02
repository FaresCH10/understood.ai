export function competencySettingInput(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['revision','validityDays'].includes(key))
    || !Number.isSafeInteger(input.revision) || input.revision<1) throw new Error('Invalid competency setting');
  const validityDays=input.validityDays;
  if (validityDays!==null && (!Number.isSafeInteger(validityDays) || validityDays<1 || validityDays>3650))
    throw new Error('Invalid competency setting');
  return {revision:input.revision,validityDays};
}

export function competencyFilters(filters={}) {
  if (!filters || typeof filters!=='object' || Array.isArray(filters)
    || Object.keys(filters).some(key=>!['status','search','page','pageSize'].includes(key))) throw new Error('Invalid competency filter');
  const {status='active',search=''}=filters;
  const page=Number(filters.page ?? 1),pageSize=Number(filters.pageSize ?? 20);
  if (!['all','active','expiring','expired'].includes(status) || typeof search!=='string' || search.length>80
    || !Number.isSafeInteger(page) || page<1 || page>5000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100)
    throw new Error('Invalid competency filter');
  return {status,search:search.trim(),page,pageSize};
}
