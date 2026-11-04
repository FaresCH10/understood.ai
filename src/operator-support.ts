export type OperatorSupportAccount={id:string;reference:string;principalType:'staff'|'worker';role:'owner'|'administrator'|'supervisor'|'auditor'|'worker';enabled:boolean;siteId:string;siteName:string;siteState:'active'|'archived';admissionState:'active'|'paused';activeSessionCount:number};
export type OperatorSupportReport={orgId:string;tenantName:string;tenantState:'active'|'suspended';asOf:string;total:number;page:number;pageSize:20;items:OperatorSupportAccount[]};
export type OperatorSessionRevocationCommand={requestId:string;kind:'session-revocation';orgId:string;siteId:string;principalType:'staff'|'worker';principalId:string;expectedSessionCount:number;reason:'security_review'|'owner_request'|'maintenance';confirmed:true};
export type OperatorWorkspace={id:string;name:string;state:'active'|'suspended';revision:number;reason:string|null;sites:number;workers:number};
export type OperatorWorkspaceReport={items:OperatorWorkspace[];total:number;page:number;pageSize:20};
const text=(value:unknown,max=100):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>record(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const oneOf=(value:unknown,choices:string[]):value is string=>typeof value==='string'&&choices.includes(value);
const accountKeys=['id','reference','principalType','role','enabled','siteId','siteName','siteState','admissionState','activeSessionCount'];
export const operatorAccountKey=(account:OperatorSupportAccount)=>JSON.stringify([account.principalType,account.id,account.siteId]);
export function isOperatorSessionRevocationCommand(value:unknown):value is OperatorSessionRevocationCommand {
  if(!exact(value,['requestId','kind','orgId','siteId','principalType','principalId','expectedSessionCount','reason','confirmed']))return false;
  return typeof value.requestId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.requestId)
    &&value.kind==='session-revocation'&&text(value.orgId)&&value.orgId===value.orgId.trim()&&text(value.siteId)&&value.siteId===value.siteId.trim()&&text(value.principalId)&&value.principalId===value.principalId.trim()
    &&oneOf(value.principalType,['staff','worker'])&&count(value.expectedSessionCount)&&value.expectedSessionCount>=1&&value.expectedSessionCount<=100000
    &&oneOf(value.reason,['security_review','owner_request','maintenance'])&&value.confirmed===true;
}
export function checkedOperatorSupportReport(value:unknown,orgId:string,page:number):OperatorSupportReport {
  if(!exact(value,['orgId','tenantName','tenantState','asOf','total','page','pageSize','items'])||value.orgId!==orgId||!text(value.tenantName,200)
    ||!oneOf(value.tenantState,['active','suspended'])||typeof value.asOf!=='string'||value.asOf.length>40||!Number.isFinite(Date.parse(value.asOf))
    ||!count(value.total)||value.page!==page||value.pageSize!==20||!Array.isArray(value.items)||value.items.length>20||value.items.length>value.total
    ||value.items.some(account=>!exact(account,accountKeys)||!text(account.id)||!text(account.reference)||!text(account.siteId)||!text(account.siteName,200)
      ||!oneOf(account.principalType,['staff','worker'])||!oneOf(account.role,['owner','administrator','supervisor','auditor','worker'])
      ||(account.principalType==='worker')!==(account.role==='worker')||typeof account.enabled!=='boolean'||!oneOf(account.siteState,['active','archived'])
      ||!oneOf(account.admissionState,['active','paused'])||!count(account.activeSessionCount)))throw Error('Account directory could not be verified');
  const report=value as unknown as OperatorSupportReport;
  if(new Set(report.items.map(operatorAccountKey)).size!==report.items.length)throw Error('Account directory could not be verified');
  return report;
}
export function checkedOperatorWorkspaces(value:unknown,page:number):OperatorWorkspaceReport {
  if(!exact(value,['items','total','page','pageSize'])||!count(value.total)||value.page!==page||value.pageSize!==20||!Array.isArray(value.items)||value.items.length>20||value.items.length>value.total
    ||value.items.some(workspace=>!exact(workspace,['id','name','state','revision','reason','sites','workers'])||!text(workspace.id)||!text(workspace.name,200)
      ||!oneOf(workspace.state,['active','suspended'])||!count(workspace.revision)||!(workspace.reason===null||text(workspace.reason))||!count(workspace.sites)||!count(workspace.workers)))throw Error('Workspace directory could not be verified');
  const report=value as unknown as OperatorWorkspaceReport;
  if(new Set(report.items.map(workspace=>workspace.id)).size!==report.items.length)throw Error('Workspace directory could not be verified');
  return report;
}
export function operatorAccountAccess(account:OperatorSupportAccount,tenantState:'active'|'suspended') {
  if(tenantState==='suspended')return 'Workspace suspended';
  if(!account.enabled)return 'Account disabled';
  if(account.principalType==='worker'&&account.siteState==='archived')return 'Site archived';
  if(account.principalType==='worker'&&account.admissionState==='paused')return 'Site access paused';
  return 'Account enabled';
}
