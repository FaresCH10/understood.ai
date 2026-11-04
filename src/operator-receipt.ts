// A receipt must attest the reviewed target and resulting state, not only a revision.
export function matchesControlReceipt(command:{kind:string;revision:number;orgId?:string|null;state?:string;jobsPaused?:boolean;providerPaused?:boolean;enabled?:boolean;maxDailyRequests?:number},result:unknown):boolean{
  if(!result || typeof result!=='object' || Array.isArray(result))return false;
  const value=result as Record<string,unknown>;
  if(value.kind!==command.kind || value.revision!==command.revision+1)return false;
  if(command.kind==='tenant')return value.orgId===command.orgId && value.state===command.state;
  if(command.kind==='system')return value.jobsPaused===command.jobsPaused && value.providerPaused===command.providerPaused;
  if(command.kind==='provider-policy')return value.orgId===command.orgId && value.enabled===command.enabled && value.maxDailyRequests===command.maxDailyRequests;
  return false;
}
