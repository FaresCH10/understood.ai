export function clarificationDay(value){
  if(value===null||value===undefined)return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Invalid clarification date');
  const date=new Date(value+'T12:00:00.000Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw Error('Invalid clarification date');
  return value;
}
export function clarificationDateAt(value,timeZone='UTC'){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const part=type=>parts.find(item=>item.type===type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function shiftClarificationDay(day,amount){
  clarificationDay(day);
  const date=new Date(day+'T12:00:00.000Z');date.setUTCDate(date.getUTCDate()+amount);
  return date.toISOString().slice(0,10);
}
