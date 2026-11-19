// Prices are integer USD cents. The 10% reduction recurs every month.
export const SUBSCRIPTION_DISCOUNT_PERCENT=10;
export const SUBSCRIPTION_PLANS=Object.freeze([
  {id:'starter',name:'Starter',regularCents:9900,workers:25,supervisors:2,sites:1,characters:200000,transcriptionMinutes:60},
  {id:'pro',name:'Pro',regularCents:29900,workers:100,supervisors:5,sites:3,characters:750000,transcriptionMinutes:300},
  {id:'business',name:'Business',regularCents:79900,workers:300,supervisors:15,sites:10,characters:2500000,transcriptionMinutes:1000},
  {id:'enterprise',name:'Enterprise',regularCents:249900,workers:1000,supervisors:40,sites:25,characters:10000000,transcriptionMinutes:3000},
].map(plan=>Object.freeze({...plan,monthlyCents:Math.round(plan.regularCents*.9)})));
export const subscriptionPlan=id=>SUBSCRIPTION_PLANS.find(plan=>plan.id===id);
export const formatSubscriptionPrice=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);

// Internal cost reserves, never a claim that money has reached a provider.
export function providerBudget(planId){
  const plan=subscriptionPlan(planId);if(!plan)throw Error('Invalid subscription plan');
  const million=plan.characters/1000000;
  return Object.freeze({translationCents:Math.ceil(million*3000),voiceCents:Math.ceil(million*2500),
    textAICents:Math.ceil(million*1000),retryCents:Math.ceil(million*1300),
    transcriptionCents:Math.ceil(plan.transcriptionMinutes/60*11.1)});
}
