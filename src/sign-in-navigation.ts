import {validPageSession,type PageSession} from './session-state.ts';
import {isPendingWorkspacePlan} from '../server/pilot-policy.mjs';

export function signedInDestination(session:(PageSession&{firstRunRequired?:boolean;workspacePlan?:string|null})|null,view:string):string|null{
  if(view!=='sign-in'||!session||!validPageSession(session))return null;
  if(session.role==='worker')return 'inbox';
  if(isPendingWorkspacePlan(session.workspacePlan))return 'workspace-access';
  if(session.staffRole==='administrator')return 'settings/staff';
  return session.firstRunRequired?'onboarding/first-run':'overview';
}
