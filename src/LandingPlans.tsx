import {Check,ArrowRight} from 'lucide-react';
import {useRef} from 'react';
import {gsap,useGSAP} from './gsap-scroll';
import {SUBSCRIPTION_PLANS,formatSubscriptionPrice} from '../server/subscription-plans.mjs';
import type {LandingLocale} from './landing-content';
import './landing-plans.css';

export function LandingPlans({locale,registrationAvailable}:{locale:LandingLocale;registrationAvailable:boolean}){
  const ar=locale==='ar';
  const root=useRef<HTMLElement>(null);
  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      const select=gsap.utils.selector(root);
      gsap.from(select('.plans-studio-heading > *, .plans-offer-note'),{
        y:20,opacity:0,duration:.6,stagger:.1,ease:'power2.out',clearProps:'transform,opacity',
        scrollTrigger:{id:'plans-heading',trigger:root.current,start:'clamp(top 85%)',once:true},
      });
      select('.plans-card').forEach((card:HTMLElement,index:number)=>{
        const q=gsap.utils.selector(card);
        gsap.timeline({
          defaults:{ease:'power2.out'},
          scrollTrigger:{id:`plan-card-${index}`,trigger:card,start:'clamp(top 92%)',once:true},
        })
          .from(card,{y:32,scale:.97,opacity:0,duration:.65,delay:window.matchMedia('(min-width: 801px)').matches?index*.09:0,clearProps:'transform,opacity'})
          .from(q('.plans-card-features > li'),{y:10,opacity:0,duration:.35,stagger:.055,clearProps:'transform,opacity'},'-.3');
      });
    });
    return()=>media.revert();
  },{scope:root,dependencies:[locale],revertOnUpdate:true});
  const number=(n:number)=>new Intl.NumberFormat(ar?'ar':'en-US').format(n);
  const blurbs=ar?['لفريق واحد','للفرق المتنامية','للعمليات متعددة المواقع','للمؤسسات الكبيرة']:['For one team','For growing teams','For multi-site operations','For larger organizations'];
  return <section ref={root} id="plans" className="landing-section landing-container plans-studio subscription-plans" aria-labelledby="plans-title">
    <header className="plans-studio-heading"><h2 id="plans-title">{ar?'خطة تناسب فريقك. وسعر واضح.':'The right plan for your team.'}</h2><p>{ar?'كل خطة تشمل التعليمات والأسئلة والتوضيحات والتقارير.':'Every plan includes instructions, questions, clarifications and reports.'}</p></header>
    <p className="plans-offer-note">{ar?'وفّر 10% شهرياً. بلا التزام سنوي.':'Save 10% monthly. No annual commitment.'}</p>
    <div className="plans-card-grid">{SUBSCRIPTION_PLANS.map((plan,index)=><article key={plan.id} className={`plans-card${plan.available?' plans-card--featured':' plans-card--coming-soon'}`}>
      <span className="plans-card-badge">{plan.available?(ar?'متاحة الآن':'Available now'):(ar?'قريباً':'Coming soon')}</span>
      <div className="plans-card-heading"><h3>{plan.name}</h3><span>{blurbs[index]}</span></div>
      <div className="plans-card-price"><p className="plans-price-original"><del><bdi dir="ltr">{formatSubscriptionPrice(plan.regularCents)}</bdi></del></p>
        <p className="plans-price-main"><bdi dir="ltr"><strong>{formatSubscriptionPrice(plan.monthlyCents)}</strong></bdi><span className="plans-price-period">{plan.id==='enterprise'?(ar?'السعر الابتدائي شهرياً':'starting price per month'):(ar?'شهرياً':'per month')}</span></p></div>
      <ul className="plans-card-features">{[
        ar?`حتى ${number(plan.workers)} عاملاً`:`Up to ${number(plan.workers)} workers`,
        ar?`${number(plan.supervisors)} مشرفين · ${number(plan.sites)} مواقع`:`${number(plan.supervisors)} supervisors · ${number(plan.sites)} ${plan.sites===1?'site':'sites'}`,
      ].map(feature=><li key={feature}><Check size={17} aria-hidden="true"/><span>{feature}</span></li>)}
        <li><Check size={17} aria-hidden="true"/><span>{ar?`${number(plan.characters)} حرف/شهر`:`${number(plan.characters)} characters/month`}<small>{ar?'الترجمة والصوت':'Translation & voice'}</small></span></li>
        <li><Check size={17} aria-hidden="true"/><span>{ar?`${number(plan.transcriptionMinutes)} دقيقة/شهر`:`${number(plan.transcriptionMinutes)} minutes/month`}<small>{ar?'تفريغ التسجيلات الصوتية':'Transcription'}</small></span></li>
      </ul>
      <div className="plans-card-action">{plan.available?<a className="landing-button landing-button--light" href={registrationAvailable?`#register/${plan.id}`:'#contact'}>{ar?`اختر ${plan.name}`:`Choose ${plan.name}`}<ArrowRight size={18} aria-hidden="true"/></a>:<button type="button" className="landing-button landing-button--outline" disabled>{ar?'قريباً':'Coming soon'}</button>}</div>
    </article>)}</div>
    <div className="plans-footnotes">
      <p className="plans-pricing-note">{ar?'الأسعار بالدولار، قبل الضرائب.':'Prices in USD, before applicable taxes.'}</p>
      <details className="plans-usage"><summary>{ar?'كيف يُحتسب الاستخدام':'How usage is counted'}</summary>
        <p>{ar?'تُحسب كل نسخة لغوية من التعليمات والأسئلة ورسائل التوضيح ضمن الرصيد الشهري. لا يستهلك تشغيل الصوت المحفوظ رصيد توليد جديداً. تُجدّد الحصص كل فترة اشتراك ولا تنتقل للشهر التالي.':'Each language version of instructions, questions and clarification messages uses the monthly allowance. Playing existing audio does not use new generation allowance. Allowances renew each subscription period and do not roll over.'}</p>
        <p>{ar?'تُحدَّد احتياجات التكامل والبنية التحتية المخصصة للمؤسسات بعرض منفصل.':'Enterprise integrations and dedicated infrastructure are quoted separately.'}</p>
      </details>
    </div>
  </section>;
}
