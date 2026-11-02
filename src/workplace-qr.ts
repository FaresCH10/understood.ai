import {validWorkerBriefingTarget} from './worker-briefing-target.ts';

// Only the deployment address and a briefing reference are encoded. Sign-in, organization,
// site and assignment checks remain the gate before any instruction content is returned.
export function workplaceQrUrl(origin:string,pathname:string,briefingId:string):string {
  if(!validWorkerBriefingTarget(briefingId)) throw Error('Invalid briefing reference');
  const base=`${origin.replace(/\/+$/,'')}${pathname.startsWith('/')?pathname:`/${pathname}`}`.replace(/[?#].*$/,'');
  return `${base}#worker-access/briefing/${encodeURIComponent(briefingId)}`;
}
