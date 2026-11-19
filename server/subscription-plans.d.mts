export type SubscriptionPlanId='starter'|'pro'|'business'|'enterprise';
export type SubscriptionPlan={id:SubscriptionPlanId;name:string;regularCents:number;monthlyCents:number;workers:number;supervisors:number;sites:number;characters:number;transcriptionMinutes:number};
export const SUBSCRIPTION_DISCOUNT_PERCENT:number;
export const SUBSCRIPTION_PLANS:readonly SubscriptionPlan[];
export function subscriptionPlan(id:unknown):SubscriptionPlan|undefined;
export function formatSubscriptionPrice(cents:number):string;
export function providerBudget(id:string):Readonly<Record<string,number>>;
