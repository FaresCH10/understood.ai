import {createHash,timingSafeEqual} from 'node:crypto';

// This identifies a page's session but cannot authenticate a request without its HttpOnly cookie.
export function clientSessionContext(session) {
  if(!/^[a-f0-9]{64}$/.test(session.token_hash || '') || !Number.isFinite(Date.parse(session.expires_at)))
    throw new Error('Sign in required');
  const identity=[session.token_hash,session.org_id,session.site_id,session.principal_type,session.principal_id,
    session.access_mode,session.principal_type==='worker' ? session.language : session.role,
    session.principal_type==='worker' ? (session.language_selection_required ? 1 : 0) : 0];
  if(session.principal_type==='worker')identity.push(session.credential_revision ?? null);
  return {clientContext:createHash('sha256').update('understood:page-session:v1\0').update(JSON.stringify(identity)).digest('hex'),
    expiresAt:new Date(session.expires_at).toISOString()};
}

export function staffBriefingContextRequired(path,method) {
  return ['GET','HEAD'].includes(method) && (/^\/api\/briefings(?:\/[^/]+)?$/.test(path) || /^\/api\/briefings\/[^/]+\/schedules$/.test(path)
      || /^\/api\/draft-creation-receipts\/[^/]+$/.test(path) || /^\/api\/briefings\/[^/]+\/publication-receipts\/(publish|schedule)\/[^/]+$/.test(path)
      || /^\/api\/briefing-(review|regeneration)\/receipts\/[^/]+$/.test(path)
      || /^\/api\/briefings\/[^/]+\/preparation-requests(?:\/[^/]+)?$/.test(path))
    || ['GET','HEAD'].includes(method) && (path==='/api/source-audio' || /^\/api\/source-audio\/[^/]+(?:\/retries\/[^/]+)?$/.test(path))
    || method==='PATCH' && /^\/api\/briefings\/[^/]+$/.test(path)
    || method==='POST' && (path==='/api/briefings' || /^\/api\/briefings\/[^/]+\/(copy|archive|withdraw|publish|schedules|process|review|regenerate)$/.test(path)
      || /^\/api\/briefings\/[^/]+\/schedules\/[^/]+\/cancel$/.test(path) || /^\/api\/briefing-review\/receipts\/[^/]+\/verify$/.test(path)
      || /^\/api\/briefings\/[^/]+\/preparation-requests$/.test(path) || path==='/api/source-audio' || /^\/api\/source-audio\/[^/]+\/retries$/.test(path));
}

export function staffBillingContextRequired(path,method) {
  return ['GET','HEAD'].includes(method) && (/^\/api\/invoices(?:\/[^/]+)?$/.test(path) || /^\/api\/invoices\/requests\/(invoice|payment|void)\/[^/]+$/.test(path))
    || method==='POST' && (path==='/api/invoices' || /^\/api\/invoices\/[^/]+\/(payments|void)$/.test(path));
}

export function staffPeopleContextRequired(path,method) {
  return ['GET','HEAD'].includes(method) && (/^\/api\/people\/(workers|crews|language-requests)$/.test(path) || /^\/api\/people\/crews\/[^/]+$/.test(path) || /^\/api\/people\/imports\/[^/]+$/.test(path)
      || /^\/api\/people\/workers\/[^/]+\/(access|credentials|deletion|assignments|language-requests)$/.test(path) || path==='/api/privacy/workers')
    || method==='PATCH' && /^\/api\/people\/(workers|crews)\/[^/]+$/.test(path)
    || method==='POST' && (/^\/api\/people\/(workers|crews)$/.test(path)
      || /^\/api\/people\/workers\/[^/]+\/(crew|disable|reenable|deletion|credentials\/setup)$/.test(path) || /^\/api\/people\/crews\/[^/]+\/(archive|restore)$/.test(path)
      || path==='/api/people/imports/preview' || /^\/api\/people\/imports\/[^/]+\/confirm$/.test(path)
      || /^\/api\/people\/language-requests\/[^/]+\/decision$/.test(path)
      || path==='/api/worker-grants' || /^\/api\/worker-grants\/[^/]+\/revoke$/.test(path));
}

export function staffResponseContextRequired(path,method) {
  return ['GET','HEAD'].includes(method) && /^\/api\/publications\/[^/]+\/responses(?:\/[^/]+)?$/.test(path);
}

export function staffPolicyContextRequired(path,method) {
  const policy=path==='/api/retention' || /^\/api\/retention\/(text|cases|generated|activity|briefings)$/.test(path) || path==='/api/privacy/recording-notice';
  const receipt=/^\/api\/retention(?:\/(text|cases|generated|activity|briefings))?\/requests\/[^/]+$/.test(path) || /^\/api\/privacy\/recording-notice\/requests\/[^/]+$/.test(path);
  return ['GET','HEAD'].includes(method) && (policy || receipt) || method==='POST' && policy;
}

export function staffWorkspaceContextRequired(path,method) {
  return ['GET','HEAD'].includes(method) && (['/api/settings','/api/settings/contacts','/api/settings/sites'].includes(path)
    || /^\/api\/settings\/(organization|site)\/receipts\/[^/]+$/.test(path)
    || /^\/api\/settings\/sites\/(?:[^/]+\/lifecycle|(?:access\/|lifecycle\/)?receipts\/[^/]+)$/.test(path))
    || method==='POST' && /^\/api\/settings\/(organization|site|sites(?:\/access|\/lifecycle)?)$/.test(path);
}

export function staffArtifactContextRequired(path,method) {
  return ['GET','HEAD'].includes(method) && (/^\/api\/(templates|glossary)(?:\/[^/]+)?$/.test(path) || /^\/api\/(templates|glossary)\/receipts\/[^/]+$/.test(path))
    || method==='POST' && (/^\/api\/(templates|glossary)$/.test(path)
      || /^\/api\/templates\/[^/]+\/(edit|archive|restore|duplicate|use)$/.test(path)
      || /^\/api\/glossary\/[^/]+\/(edit|remove|restore|regenerate)$/.test(path));
}

export function staffReportContextRequired(path,method) {
  return ['GET','HEAD'].includes(method) && (['/api/reports','/api/reports/publications','/api/reports/exports'].includes(path)
      || /^\/api\/reports\/exports\/receipts\/(create|retry)\/[^/]+$/.test(path))
    || method==='POST' && (path==='/api/reports/exports' || /^\/api\/reports\/exports\/[^/]+\/retry$/.test(path));
}

export function staffNotificationContextRequired(path,method) {
  return ['GET','HEAD'].includes(method) && (path==='/api/notifications' || /^\/api\/notifications\/[^/]+\/receipt$/.test(path))
    || method==='POST' && /^\/api\/notifications\/[^/]+\/read$/.test(path);
}

export function staffOnboardingContextRequired(path,method) {
  return ['GET','HEAD'].includes(method) && (path==='/api/settings/onboarding' || /^\/api\/settings\/onboarding\/receipts\/[^/]+$/.test(path))
    || method==='POST' && path==='/api/settings/onboarding';
}

export function staffUsageContextRequired(path,method) {
  return ['GET','HEAD'].includes(method) && (path==='/api/usage' || /^\/api\/usage\/requests(?:\/[^/]+)?$/.test(path) || /^\/api\/entitlement\/requests\/[^/]+$/.test(path))
    || method==='POST' && (path==='/api/usage/requests' || path==='/api/entitlement/requests');
}

export function staffApplicationContextRequired(path,method) {
  return ['GET','HEAD'].includes(method) && (path==='/api/overview' || /^\/api\/processing(?:\/[^/]+)?$/.test(path)
    || /^\/api\/processing\/[^/]+\/retries(?:\/[^/]+)?$/.test(path)
    || /^\/api\/processing\/[^/]+\/provenance$/.test(path)
    || /^\/api\/audit(?:\/[^/]+)?$/.test(path) || path==='/api/language-readiness'
    || path==='/api/instructions/audience' || /^\/api\/instructions\/sends\/[^/]+$/.test(path))
    || method==='POST' && (path==='/api/language-readiness/test' || /^\/api\/processing\/[^/]+\/retries$/.test(path) || path==='/api/instructions/send'
      || /^\/api\/instructions\/sends\/[^/]+\/retry$/.test(path));
}

export function staffClarificationContextRequired(path,method) {
  if(/^\/api\/clarifications\/[^/]+\/in-person-recordings(?:\/[^/]+)?$/.test(path))return ['GET','HEAD','POST'].includes(method);
  if(/^\/api\/clarification-creations(?:\/subjects(?:\/[^/]+)?|\/[^/]+)?$/.test(path))return ['GET','HEAD','POST'].includes(method);
  return ['GET','HEAD'].includes(method) && (/^\/api\/clarifications(?:\/[^/]+(?:\/actions\/[^/]+)?)?$/.test(path) || /^\/api\/clarifications\/[^/]+\/timeline$/.test(path) || /^\/api\/clarifications\/[^/]+\/(repeats|reviews)(?:\/[^/]+)?$/.test(path))
    || method==='POST' && /^\/api\/clarifications\/[^/]+\/(assign|resolve)$/.test(path);
}

export function verifyClientSession(req,session,path) {
  const provided=req.headers['x-client-session-context'];
  const briefingJson=session.principal_type==='staff' && (staffBriefingContextRequired(path,req.method) || staffBillingContextRequired(path,req.method) || staffPeopleContextRequired(path,req.method) || staffResponseContextRequired(path,req.method) || staffPolicyContextRequired(path,req.method) || staffWorkspaceContextRequired(path,req.method) || staffArtifactContextRequired(path,req.method) || staffReportContextRequired(path,req.method) || staffNotificationContextRequired(path,req.method) || staffOnboardingContextRequired(path,req.method) || staffUsageContextRequired(path,req.method) || staffApplicationContextRequired(path,req.method));
  const required=path.startsWith('/api/workspace/') || briefingJson || session.principal_type==='worker' && ['GET','HEAD'].includes(req.method) && path==='/api/privacy/recording-notice' || session.principal_type==='staff' && staffClarificationContextRequired(path,req.method) || /^\/api\/settings\/(staff|invitations)(?:\/|$)/.test(path) || req.method!=='GET' && req.method!=='HEAD' && (path==='/api/usage/requests' || path==='/api/source-audio' || path==='/api/settings/sites' || path==='/api/settings/sites/access' || path==='/api/settings/sites/lifecycle'
    || /^\/api\/clarifications\/[^/]+\/(messages|followups|repeats|reviews)$/.test(path)
    || /^\/api\/clarifications\/[^/]+\/voice\/[^/]+$/.test(path)
    || (session.principal_type==='worker' && (path.startsWith('/api/worker/') || path==='/api/logout')));
  if(provided===undefined && !required)return;
  if(typeof provided!=='string' || !/^[a-f0-9]{64}$/.test(provided)
    || !timingSafeEqual(Buffer.from(provided,'hex'),Buffer.from(clientSessionContext(session).clientContext,'hex')))
    throw new Error('Session context changed');
}
