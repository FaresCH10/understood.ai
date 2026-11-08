import {assertPostgresPoolHealthy} from './postgres/db.mjs';
// Retire a poisoned warm instance between requests. Never replay a handler/write.
export function runtimeCache(create){
 let pending;
 return async()=>{
  if(pending){
   const observed=pending;
   const value=await observed;
   try{if(value.pool)assertPostgresPoolHealthy(value.pool);return value;}
   catch(error){
    if(error.code!=='UNDERSTOOD_PG_CONNECTION_LOST')throw error;
    if(pending===observed){pending=undefined;void Promise.resolve().then(()=>value.pool.end?.()).catch(()=>{});}
   }
  }
  if(!pending){const next=Promise.resolve().then(create);pending=next;void next.catch(()=>{if(pending===next)pending=undefined;});}
  return pending;
 };
}
