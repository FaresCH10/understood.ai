export const PILOT_DAYS=14;
export const PILOT_WORKER_LIMIT=25;
export const PILOT_PLAN='pilot';
export const PENDING_PILOT_PLAN='pilot_pending';
export const isPilotPlan=plan=>plan===PILOT_PLAN||plan===PENDING_PILOT_PLAN;

export const PAID_PLANS=Object.freeze(/** @type {const} */ (['starter','pro','business','enterprise']));
export const PLAN_NAMES=Object.freeze({pilot:'Pilot',starter:'Starter',pro:'Pro',business:'Business',enterprise:'Enterprise'});
export const isPaidPlan=plan=>PAID_PLANS.some(value=>value===plan);
export const pendingPaidPlan=plan=>PAID_PLANS.find(value=>`${value}_pending`===plan);
export const isPendingWorkspacePlan=plan=>plan===PENDING_PILOT_PLAN||!!pendingPaidPlan(plan);
export function pendingWorkspaceState(plan,decision){
  return isPendingWorkspacePlan(plan)?decision==='declined'?'declined':'pending':null;
}
export function higherPaidPlans(plan) {
  const current=typeof plan==='string'?plan.trim().toLowerCase():null;
  if(current && current!=='pilot' && current!=='trial' && !isPaidPlan(current))return [];
  return PAID_PLANS.slice(PAID_PLANS.indexOf(current)+1);
}
export const planUpgradeNote=plan=>`Plan upgrade: ${plan}`;
export const requestedUpgradePlan=note=>PAID_PLANS.find(plan=>note===planUpgradeNote(plan));

export function assertPlanUpgrade(note,role,currentPlan) {
  if(!note?.startsWith('Plan upgrade:'))return;
  if(role!=='owner')throw Error('Forbidden');
  if(!higherPaidPlans(currentPlan).some(plan=>planUpgradeNote(plan)===note))throw Error('Invalid activation request');
}

export function registrationEntitlement(plan) {
  // Complete old unverified registrations as Starter; never start a new pilot.
  if(plan==='pilot'||plan==null)plan='starter';
  if(!isPaidPlan(plan))throw Error('Choose a subscription plan');
  return {plan:`${plan}_pending`,limit:1,note:`${PLAN_NAMES[plan]} subscription selected. Payment and service funding required.`};
}
