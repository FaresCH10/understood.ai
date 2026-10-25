import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
const auth=JSON.parse(readFileSync(join(process.env.APPDATA,'com.vercel.cli/Data/auth.json'),'utf8'));
const existing=JSON.parse(readFileSync('.vercel/project.json','utf8'));
async function get(path){const r=await fetch('https://api.vercel.com'+path,{headers:{Authorization:'Bearer '+auth.token},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Vercel inspection HTTP ${r.status}`);return r.json();}
try{
  const team=await get('/v2/teams/'+existing.orgId);
  if(team.billing?.plan!=='hobby')throw Error('Expected free Hobby account; stop before deployment');
  const project=await get('/v9/projects/understood-pc-demo?teamId='+existing.orgId);
  const domains=await get('/v9/projects/'+project.id+'/domains?teamId='+existing.orgId);
  const domain=domains.domains.find(d=>d.name==='understood-pc-demo.vercel.app')??domains.domains.find(d=>d.name.endsWith('.vercel.app'));
  if(!domain)throw Error('No verified Vercel project domain');
  const root=resolve('artifacts/pc-demo/vercel/.vercel');mkdirSync(root,{recursive:true});
  writeFileSync(join(root,'project.json'),JSON.stringify({projectId:project.id,orgId:existing.orgId,projectName:project.name}));
  const path='artifacts/pc-demo/runtime.json',settings=JSON.parse(readFileSync(path,'utf8'));settings.publicOrigin='https://'+domain.name;writeFileSync(path,JSON.stringify(settings,null,2));
  const receipt={plan:team.billing.plan,project:project.name,publicOrigin:settings.publicOrigin};
  writeFileSync('artifacts/pc-demo/vercel-project.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}catch(error){console.error(error.message);process.exitCode=1;}
