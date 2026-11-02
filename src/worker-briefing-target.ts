const TARGET_KEY='understood:worker-briefing-target';
const TARGET_MAX_AGE=30*60*1000;

export function validWorkerBriefingTarget(value:unknown): value is string {
  return typeof value==='string' && value.length>0 && value.length<=100 && !/[\u0000-\u001f\u007f]/.test(value);
}

// A workplace code names a resource. It never carries a session, credential or worker identity.
export function workerBriefingTargetFromHash(hash:string):string|null {
  const match=/^#worker-access\/briefing\/([^/?#]*)$/.exec(hash);
  if(!match) return null;
  let value:string;
  try {value=decodeURIComponent(match[1]);} catch {return null;}
  return validWorkerBriefingTarget(value)?value:null;
}

export function saveWorkerBriefingTarget(storage:Pick<Storage,'setItem'>,briefingId:string,now=Date.now()):boolean {
  if(!validWorkerBriefingTarget(briefingId)) return false;
  try {storage.setItem(TARGET_KEY,JSON.stringify({id:briefingId,createdAt:now}));return true;} catch {return false;}
}

export function readWorkerBriefingTarget(storage:Pick<Storage,'getItem'|'removeItem'>,now=Date.now()):string|null {
  try {
    const raw=storage.getItem(TARGET_KEY);
    if(!raw) return null;
    const value=JSON.parse(raw);
    if(!value || typeof value!=='object' || !validWorkerBriefingTarget(value.id) || !Number.isFinite(value.createdAt) || now-value.createdAt>TARGET_MAX_AGE) {
      storage.removeItem(TARGET_KEY);
      return null;
    }
    return value.id;
  } catch {return null;}
}

export function clearWorkerBriefingTarget(storage:Pick<Storage,'removeItem'>) {
  try {storage.removeItem(TARGET_KEY);} catch {}
}
