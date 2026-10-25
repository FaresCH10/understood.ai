import {readFileSync} from 'node:fs';
import {productionAdmissionBlockers} from '../server/postgres/production-admission.mjs';

function approvalManifest() {
  const path=process.env.UNDERSTOOD_RELEASE_APPROVAL_FILE;
  if(!path) return {manifest:null,error:null};
  try { return {manifest:JSON.parse(readFileSync(path,'utf8')),error:null}; }
  catch { return {manifest:null,error:'release_approval_manifest_unreadable'}; }
}

const service=process.env.UNDERSTOOD_HOSTED_SERVICE ?? 'api';
let blockers;
if(!['api','worker','operator'].includes(service)) blockers=['service_invalid'];
else {
  const loaded=approvalManifest();
  blockers=loaded.error?[loaded.error]:productionAdmissionBlockers(process.env,{service,approvalManifest:loaded.manifest});
}
const result=Object.freeze({admitted:blockers.length===0,productionStartupAuthorized:false,
  deploymentAuthorized:false,service,blockers:Object.freeze([...blockers]),
  note:'Admission reviews configuration only. G18 deployment authorization and production startup wiring are separate approvals.'});
console.log(JSON.stringify(result,null,2));
if(blockers.length) process.exitCode=1;
