export type OperatorOverview={
  asOf:string;control:{revision:number;jobsPaused:boolean;providerPaused:boolean};
  backlog:{kind:string;status:string;count:number}[];tenants:{total:number;suspended:number};readiness:Record<string,string>;
  workerHealth:{status:string;items:{id:string;state:string;stage:string|null;seenAt:string;fresh:boolean;failureStages:string[]}[]};
  storageHealth:{status:string;privacy:string;observation:{adapter:string;state:string;result:string|null;completedAt:string|null}|null};limits:{reason:string};
};
export type OperatorDestination='overview'|'support'|'jobs'|'tenants'|'entitlements'|'providers'|'controls'|'audit'|'runbooks';
export const operatorSections:{id:OperatorDestination;label:string;description:string;group:string}[]=[
  {id:'overview',label:'Command center',description:'Platform health, dispatch and the next action.',group:'Monitor'},
  {id:'support',label:'Support desk',description:'Diagnose supervisor and worker access in a specific workspace.',group:'Monitor'},
  {id:'jobs',label:'Processing jobs',description:'Inspect processing failures and review eligible retries.',group:'Monitor'},
  {id:'tenants',label:'Workspaces',description:'Inspect sites, worker access and workspace admission.',group:'Manage'},
  {id:'entitlements',label:'Plans & activation',description:'Review activation requests, plan terms and worker limits.',group:'Manage'},
  {id:'providers',label:'AI & quotas',description:'Inspect provider readiness, usage and controlled synthetic checks.',group:'Manage'},
  {id:'controls',label:'Dispatch controls',description:'Pause or resume new operational and AI dispatch.',group:'Manage'},
  {id:'audit',label:'Audit trail',description:'Review the immutable history of operator actions.',group:'Investigate'},
  {id:'runbooks',label:'Troubleshooting',description:'Follow a scoped response to a supervisor or worker problem.',group:'Investigate'},
];
export function overviewSummary(report:OperatorOverview){
  const count=(states:string[])=>report.backlog.filter(row=>states.includes(row.status)).reduce((sum,row)=>sum+row.count,0);
  return {failed:count(['failed','blocked']),queued:count(['queued','received']),processing:count(['processing']),
    freshWorkers:report.workerHealth.items.filter(row=>row.fresh && row.state!=='stopped').length,
    paused:report.control.jobsPaused || report.control.providerPaused};
}
export function healthTone(value:string):'good'|'attention'|'unknown'{
  return value==='responding'?'good':['failed','degraded','cleanup pending','not recently observed','not recently verified'].includes(value)?'attention':'unknown';
}
