import {createRoot} from 'react-dom/client';
import App from '../../src/main';
import {usageModel} from '../../server/usage.mjs';
import '../../src/ui-refresh.css';
import '../../src/dashboard-navigation.css';
import '../../src/instruction-detail.css';
import '../../src/team-workflow.css';
import '../../src/worker-workspace.css';

const mode=new URLSearchParams(location.search).get('runtime') || 'live-credential';
const request=window.fetch.bind(window);
window.fetch=async(input,options)=>{
  const url=new URL(typeof input==='string'?input:input instanceof Request?input.url:input.href,location.origin);
  if(url.origin!==location.origin)throw Error('External requests are disabled in the production UI fixture');
  const method=options?.method || (input instanceof Request?input.method:'GET');
  if(!['GET','HEAD'].includes(method) && !['/api/auth/staff/login','/api/logout'].includes(url.pathname))
    throw Error('The production UI fixture is read-only');
  const response=await request(input,options);
  if(!response.ok || !['/api/session','/api/usage'].includes(url.pathname))return response;
  const value=await response.json();
  if(url.pathname==='/api/session')return Response.json({...value,mode});
  const units=value.units,model=usageModel({mode,metrics:{assigned:units[0].used,responses:units[1].used,matches:units[2].used,clarifications:units[3].used,pending:units[4].used},
    latestPublication:value.publication,entitlement:value.entitlement,
    providerAllowance:value.providerAllowance?{...value.providerAllowance,dataClass:mode==='live-credential'?'real':'synthetic'}:null});
  return Response.json({...model,changeRequestsAvailable:value.changeRequestsAvailable});
};
createRoot(document.getElementById('root')!).render(<><div role="note" style={{position:'fixed',bottom:0,right:0,zIndex:10000,background:'#fff',color:'#111',padding:6,fontSize:12}}>Read-only {mode} UI fixture · synthetic backend</div><App/></>);
