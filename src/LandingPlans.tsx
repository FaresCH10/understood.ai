import {Check,ArrowRight} from 'lucide-react';
import {SUBSCRIPTION_PLANS,formatSubscriptionPrice} from '../server/subscription-plans.mjs';
import {landingCopy,type LandingLocale} from './landing-content';
import './landing-plans.css';

export function LandingPlans({locale,registrationAvailable}:{locale:LandingLocale;registrationAvailable:boolean}){
  const ar=locale==='ar',t=landingCopy[locale];
  const number=(n:number)=>new Intl.NumberFormat(ar?'ar':'en-US').format(n);
  const blurbs=ar?['لفريق واحد','للفرق المتنامية','للعمليات متعددة المواقع','للمؤسسات الكبيرة']:['For one team','For growing teams','For multi-site operations','For larger organizations'];
  return <section id="plans" className="landing-section landing-container plans-studio subscription-plans" aria-labelledby="plans-title">
    <header className="plans-studio-heading"><h2 id="plans-title">{ar?'خطة تناسب فريقك. وسعر واضح.':'The right plan for your team.'}</h2><p>{ar?'تعليمات وصوت وتوضيحات في مساحة عمل واحدة. خصم 10% على الاشتراك الشهري لكل خطة.':'Instructions, voice and clarifications in one workspace. Save 10% on every monthly plan.'}</p></header>
    <p className="plans-offer-note">{ar?'خصم 10% على كل دفعة شهرية، بلا التزام سنوي.':'10% off every monthly payment. No annual commitment.'}</p>
    <p className="plans-pricing-note">{ar?'ابدأ مع Starter. خطط Pro وBusiness وEnterprise قادمة قريباً.':'Start with Starter. Pro, Business and Enterprise are coming soon.'}</p>
    <div className="plans-card-grid">{SUBSCRIPTION_PLANS.map((plan,index)=><article key={plan.id} className={`plans-card${plan.available?' plans-card--featured':' plans-card--coming-soon'}`}>
      {!plan.available&&<span className="plans-card-badge">{ar?'قريباً':'Coming soon'}</span>}
      <div className="plans-card-heading"><h3>{plan.name}</h3><span>{blurbs[index]}</span></div>
      <div className="plans-card-price"><p className="plans-price-original"><del><bdi dir="ltr">{formatSubscriptionPrice(plan.regularCents)}</bdi></del> <span>{ar?'خصم 10%':'10% off'}</span></p>
        <p className="plans-price-main">{plan.id==='enterprise'&&<span className="plans-price-from">{ar?'ابتداءً من':'From'}</span>}<bdi dir="ltr"><strong>{formatSubscriptionPrice(plan.monthlyCents)}</strong></bdi><span className="plans-price-period">{ar?'/شهرياً':'/month'}</span></p></div>
      <ul className="plans-card-features">{[
        ar?`حتى ${number(plan.workers)} عاملاً`:`Up to ${number(plan.workers)} workers`,
        ar?`${number(plan.supervisors)} مشرفين · ${number(plan.sites)} مواقع`:`${number(plan.supervisors)} supervisors · ${number(plan.sites)} ${plan.sites===1?'site':'sites'}`,
        ar?`${number(plan.characters)} حرف للترجمة والصوت شهرياً`:`${number(plan.characters)} translation & voice characters/month`,
        ar?`${number(plan.transcriptionMinutes)} دقيقة تفريغ صوتي شهرياً`:`${number(plan.transcriptionMinutes)} transcription minutes/month`,
        ar?'تعليمات وأسئلة وتوضيحات وتقارير':'Instructions, questions, clarifications & reports',
      ].map(feature=><li key={feature}><Check size={17} aria-hidden="true"/>{feature}</li>)}</ul>
      <div className="plans-card-action">{plan.available?<><a className="landing-button landing-button--light" href={registrationAvailable?`#register/${plan.id}`:'#contact'}>{ar?`اختر ${plan.name}`:`Choose ${plan.name}`}<ArrowRight size={18} aria-hidden="true"/></a><p>{ar?'تحقق من البريد ثم أكمل الاشتراك.':'Verify your email, then complete your subscription.'}</p></>:<><button type="button" className="landing-button landing-button--outline" disabled>{ar?'قريباً':'Coming soon'}</button><p>{ar?'غير متاحة للاشتراك حالياً.':'Not available for subscription yet.'}</p></>}</div>
    </article>)}</div>
    <p className="plans-pricing-note">{ar?'الأسعار بالدولار، قبل الضرائب. تُحسب كل نسخة لغوية من التعليمات والأسئلة ورسائل التوضيح ضمن الرصيد الشهري. لا يستهلك تشغيل الصوت المحفوظ رصيد توليد جديداً. تُجدّد الحصص كل فترة اشتراك ولا تنتقل للشهر التالي.':'Prices in USD, before applicable taxes. Each language version of instructions, questions and clarification messages uses the monthly allowance. Playing existing audio does not use new generation allowance. Allowances renew each subscription period and do not roll over.'}</p>
    <p className="plans-pricing-note">{ar?'تُحدَّد احتياجات التكامل والبنية التحتية المخصصة للمؤسسات بعرض منفصل.':'Enterprise integrations and dedicated infrastructure are quoted separately.'}</p>
    <div className="plans-studio-faq"><h3>{ar?'قبل أن تبدأ':'Before you start'}</h3><div>{t.faqs.map(item=><details key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>)}</div></div>
  </section>;
}
