import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedOperatorSupportReport,checkedOperatorWorkspaces,isOperatorSessionRevocationCommand,operatorAccountAccess} from '../src/operator-support.ts';

const account={id:'account',reference:'Worker 014',principalType:'worker',role:'worker',enabled:true,siteId:'site',siteName:'Workshop',siteState:'active',admissionState:'active',activeSessionCount:2};
const report={orgId:'workspace',tenantName:'Cedar Works',tenantState:'active',asOf:'2026-11-03T10:00:00.000Z',total:1,page:1,pageSize:20,items:[account]};
const command={requestId:'12345678-1234-4234-8234-123456789012',kind:'session-revocation',orgId:'workspace',siteId:'site',principalType:'worker',principalId:'account',expectedSessionCount:2,reason:'owner_request',confirmed:true};

test('support browser reports enforce explicit scope, page and metadata-only shape',()=>{
  assert.deepEqual(checkedOperatorSupportReport(report,'workspace',1),report);
  for(const patch of [{orgId:'foreign'},{page:2},{pageSize:50},{total:-1},{asOf:'never'},{tenantState:['active']},{items:[account,account],total:2},
    {items:[{...account,email:'private@example.test'}]},{items:[{...account,activeSessionCount:-1}]},{items:[{...account,activeSessionCount:1.5}]},
    {items:[{...account,principalType:['worker']}]},{items:[{...account,principalType:'staff'}]},{items:[{...account,siteState:'deleted'}]},
    {items:[{...account,reference:'\nprivate'}]},{items:[null]},{privatePassword:'secret'}])assert.throws(()=>checkedOperatorSupportReport({...report,...patch},'workspace',1),/could not be verified/);
  for(const value of [null,[],{},'report'])assert.throws(()=>checkedOperatorSupportReport(value,'workspace',1));
  const distinctPrincipal={...account,principalType:'staff',role:'owner'};
  assert.equal(checkedOperatorSupportReport({...report,total:2,items:[account,distinctPrincipal]},'workspace',1).items.length,2);
});

test('session command recovery validates exact immutable target and human confirmation',()=>{
  assert.equal(isOperatorSessionRevocationCommand(command),true);
  for(const patch of [{requestId:'12345678-1234-1234-8234-123456789012'},{requestId:'12345678-1234-4234-1234-123456789012'},
    {orgId:''},{orgId:' workspace'},{siteId:'site\n'},{principalId:'x'.repeat(101)},{principalType:['worker']},{expectedSessionCount:0},{expectedSessionCount:100001},
    {expectedSessionCount:1.5},{reason:['owner_request']},{reason:'other'},{confirmed:false},{confirmed:'true'},{password:'secret'}])assert.equal(isOperatorSessionRevocationCommand({...command,...patch}),false);
  for(const key of Object.keys(command)){const copy={...command};delete copy[key];assert.equal(isOperatorSessionRevocationCommand(copy),false,key);}
  for(const value of [null,[],{},'command'])assert.equal(isOperatorSessionRevocationCommand(value),false);
});

test('access diagnosis distinguishes staff admission from worker-only site restrictions',()=>{
  assert.equal(operatorAccountAccess(account,'active'),'Account enabled');
  assert.equal(operatorAccountAccess({...account,admissionState:'paused'},'active'),'Site access paused');
  assert.equal(operatorAccountAccess({...account,siteState:'archived'},'active'),'Site archived');
  assert.equal(operatorAccountAccess({...account,enabled:false,siteState:'archived'},'active'),'Account disabled');
  assert.equal(operatorAccountAccess({...account,enabled:false},'suspended'),'Workspace suspended');
  const staff={...account,principalType:'staff',role:'supervisor',siteState:'archived',admissionState:'paused'};
  assert.equal(operatorAccountAccess(staff,'active'),'Account enabled');
  assert.equal(operatorAccountAccess({...staff,enabled:false},'active'),'Account disabled');
});

test('workspace search report rejects private fields and duplicate or malformed results',()=>{
  const workspace={id:'workspace',name:'Cedar Works',state:'active',revision:0,reason:null,sites:1,workers:3};
  const value={items:[workspace],total:1,page:1,pageSize:20};
  assert.deepEqual(checkedOperatorWorkspaces(value,1),value);
  for(const patch of [{page:2},{pageSize:50},{total:-1},{items:[workspace,workspace],total:2},{items:[{...workspace,email:'private@example.test'}]},
    {items:[{...workspace,state:['active']}]},{items:[{...workspace,workers:-1}]},{items:[null]}])assert.throws(()=>checkedOperatorWorkspaces({...value,...patch},1),/could not be verified/);
});
