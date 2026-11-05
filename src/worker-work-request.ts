// A work-state conflict is recoverable; only a changed authentication context
// should end the worker session. Read the body once so callers can reconcile.
export async function workerWorkResponse(response:Response,onSessionLost:()=>void){
 const value=await response.json().catch(()=>null);
 if(response.status===401||response.status===403||response.status===409&&value?.error==='Session context changed')onSessionLost();
 if(!response.ok)throw Error('Work request unavailable');
 return value;
}

export function workPageWithinRange(page:number,total:number,pageSize:number){
 return Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
}
