import {validPageSession,type PageSession} from './session-state.ts';

export function signedInDestination(session:(PageSession&{firstRunRequired?:boolean})|null,view:string):string|null{
  if(view!=='sign-in'||!session||!validPageSession(session))return null;
  if(session.role==='worker')return 'inbox';
  if(session.staffRole==='administrator')return 'settings/staff';
  return session.firstRunRequired?'onboarding/first-run':'overview';
}
