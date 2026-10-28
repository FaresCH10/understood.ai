// A normal synthetic fixture client captures once per cookie; deliberate stale/missing-header tests use raw fetch.
import {staffBriefingContextRequired,staffBillingContextRequired,staffPeopleContextRequired,staffResponseContextRequired,staffPolicyContextRequired,staffWorkspaceContextRequired,staffArtifactContextRequired,staffReportContextRequired,staffNotificationContextRequired,staffOnboardingContextRequired,staffUsageContextRequired,staffApplicationContextRequired} from '../../server/session-context.mjs';
export function createSessionContextFetch(fetcher=globalThis.fetch) {
  const contexts=new Map();
  async function capture(origin,cookie) {
    const key=origin+'\0'+cookie;if(contexts.has(key))return contexts.get(key);
    const response=await fetcher(origin+'/api/session',{headers:{cookie},cache:'no-store'});
    const value=await response.json();
    const context=response.ok && value.authenticated && value.role==='staff' && /^[a-f0-9]{64}$/.test(value.clientContext || '')?value.clientContext:null;
    contexts.set(key,context);return context;
  }
  return async(input,options={})=>{
    const url=new URL(String(input));
    if(url.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Synthetic session fixture requires loopback HTTP');
    const headers=new Headers(options.headers),cookie=headers.get('cookie');
    const method=(options.method || 'GET').toUpperCase();
    if(!headers.has('origin') && method!=='GET' && method!=='HEAD') headers.set('origin','http://127.0.0.1:3020');
    const scoped=staffBriefingContextRequired(url.pathname,options.method || 'GET') || staffBillingContextRequired(url.pathname,options.method || 'GET') || staffPeopleContextRequired(url.pathname,options.method || 'GET') || staffResponseContextRequired(url.pathname,options.method || 'GET') || staffPolicyContextRequired(url.pathname,options.method || 'GET') || staffWorkspaceContextRequired(url.pathname,options.method || 'GET') || staffArtifactContextRequired(url.pathname,options.method || 'GET') || staffReportContextRequired(url.pathname,options.method || 'GET') || staffNotificationContextRequired(url.pathname,options.method || 'GET') || staffOnboardingContextRequired(url.pathname,options.method || 'GET') || staffUsageContextRequired(url.pathname,options.method || 'GET') || staffApplicationContextRequired(url.pathname,options.method || 'GET') || /^\/api\/settings\/(staff|invitations)(?:\/|$)/.test(url.pathname);
    if(cookie && scoped && !headers.has('x-client-session-context')) {
      const context=await capture(url.origin,cookie);if(context)headers.set('x-client-session-context',context);
    }
    const response=await fetcher(input,{...options,headers});
    const issued=response.headers.get('set-cookie')?.split(';')[0];
    if(issued && issued.split('=')[1])await capture(url.origin,issued);
    return response;
  };
}
