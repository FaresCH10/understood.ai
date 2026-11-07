import {useRef,useState,type CSSProperties,type FocusEvent,type PointerEvent} from 'react';
import {ArrowRight,Check,ChevronDown} from 'lucide-react';
import {gsap,useGSAP,ScrollTrigger} from './gsap-scroll';
import {landingCopy,type LandingLocale} from './landing-content';
import './landing-plans.css';

type PlanId='pilot'|'pro'|'business'|'enterprise';
type PlanSpec={id:PlanId;name:string;base:number;seat:number;min:number;featured?:boolean;from?:boolean;copy:Record<LandingLocale,{blurb:string;description:string;features:string[];cta:string;note:string}>};

const formatNumber=(value:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value);

const plans:PlanSpec[]=[
  {id:'pilot',name:'Pilot',base:0,seat:0,min:25,copy:{
    en:{blurb:'For your first crew',description:'Give one crew clear instructions in the languages they work in, and see who has responded.',features:['One site · up to 25 active workers','14 days from approved activation','Written, voice and choice checks','Responses, clarification and reports'],cta:'Request a pilot',note:'Approval required. Scope and start date agreed with you.'},
    ar:{blurb:'لفريقك الأول',description:'امنح فريقاً واحداً تعليمات واضحة بلغات عمله، واطّلع على من استجاب.',features:['موقع واحد · حتى 25 عاملاً نشطاً','14 يوماً من التفعيل بعد الموافقة','فحوص مكتوبة وصوتية وخيارات متعددة','الردود وطلبات التوضيح والتقارير'],cta:'اطلب برنامجاً تجريبياً',note:'يتطلب الموافقة وتحديد النطاق وتاريخ البدء معك.'}}},
  {id:'pro',name:'Pro',base:149,seat:2.4,min:100,featured:true,copy:{
    en:{blurb:'For growing teams',description:'Run everyday instructions across crews, with site workspaces and follow-up in one place.',features:['Core instruction and follow-up tools','Crews and site-scoped workspaces','Supervisor roles and access controls','Publication history and report exports'],cta:'Discuss your team',note:'We’ll arrange billing and activation with you.'},
    ar:{blurb:'للفرق المتنامية',description:'شغّل التعليمات اليومية عبر الأطقم، مع مساحات عمل للمواقع والمتابعة في مكان واحد.',features:['أدوات التعليمات والمتابعة الأساسية','أطقم ومساحات عمل لكل موقع','أدوار المشرفين وصلاحيات الوصول','سجل النشر وتصدير التقارير'],cta:'ناقش احتياجات فريقك',note:'نرتب الفوترة والتفعيل معك.'}}},
  {id:'business',name:'Business',base:499,seat:1.85,min:300,copy:{
    en:{blurb:'For multi-site operations',description:'Standardise instructions across sites, with every version and response kept accountable.',features:['Everything in Pro','Multiple sites and crews','Versioned instructions and response history','Onboarding for your first rollout'],cta:'Plan your rollout',note:'We map sites, languages and crews with you.'},
    ar:{blurb:'للعمليات متعددة المواقع',description:'وحّد التعليمات بين المواقع، واحتفظ بكل نسخة ورد لمساءلة واضحة.',features:['كل ما في Pro','مواقع وأطقم متعددة','إصدارات التعليمات وسجل الردود','تهيئة لأول عملية تعميم'],cta:'ناقش خطة التعميم',note:'نحدد المواقع واللغات والأطقم معك.'}}},
  {id:'enterprise',name:'Enterprise',base:1250,seat:1.25,min:2000,from:true,copy:{
    en:{blurb:'For groups and franchises',description:'A shared standard across brands and sites, with procurement and security review support.',features:['Everything in Business','Flexible site and crew structure','Security review and procurement support','Dedicated onboarding and success'],cta:'Talk to us',note:'Annual agreement, invoiced.'},
    ar:{blurb:'للمجموعات والامتيازات',description:'معيار مشترك بين العلامات والمواقع، مع دعم الشراء ومراجعة الأمان.',features:['كل ما في Business','هيكل مرن للمواقع والأطقم','دعم مراجعة الأمان والمشتريات','تهيئة ونجاح مخصصان'],cta:'تواصل معنا',note:'اتفاق سنوي بفاتورة.'}}},
];

export function LandingPlans({locale,registrationAvailable}:{locale:LandingLocale;registrationAvailable:boolean}){
  const root=useRef<HTMLElement>(null),t=landingCopy[locale],ar=locale==='ar';
  const [billing,setBilling]=useState<'annual'|'monthly'>('annual');
  const [workers,setWorkers]=useState(250);
  const [expandedPlans,setExpandedPlans]=useState<Record<string,boolean>>({});
  const [calculatorOpen,setCalculatorOpen]=useState(false);
  const totalStates=useRef<Record<string,{value:number}>>({});
  const labels=ar?{
    heading:'ابدأ بفريق واحد. وتوسّع إلى كل موقع.',
    intro:'ابدأ ببرنامج تجريبي موجّه. خطط التعميم المدفوعة معروضة بشكل منفصل بالدولار.',
    billing:'فوترة الخطط المدفوعة',annual:'سنوي',annualHint:'وفّر 16.7%',monthly:'شهري',monthlyHint:'+20%',
    workers:'العمال النشطون',scaleMin:'25',scaleMax:'5,000',
    calcNote:'العامل النشط هو من تلقّى تعليماً واحداً على الأقل خلال الشهر.',
    popular:'الأكثر اختياراً',from:'ابتداءً من',perMonth:'/شهرياً',perWorkerMonth:'/للعامل النشط شهرياً',
    seat:'لكل عامل نشط شهرياً',minimum:(min:number)=>`${formatNumber(min)} عاملاً كحد أدنى`,
    example:'إجمالي تقديري',forWorkers:'لـ',workerNoun:'عاملاً نشطاً',minimumApplies:'يُطبَّق الحد الأدنى',
    billedAnnual:'فوترة سنوية',billedMonthly:'فوترة شهرية',
    pricingNote:'الأسعار بالدولار الأمريكي شهرياً، قبل ضريبة القيمة المضافة. الفوترة الشهرية أعلى بنسبة 20% من السنوية. تُحدَّد الضرائب المطبقة في الفاتورة.',
    faq:'قبل أن تبدأ',
  }:{
    heading:'Start with one crew. Grow to every site.',
    intro:'Begin with a guided pilot. Paid rollout plans are shown separately in USD.',
    billing:'Paid-plan billing',annual:'Annual',annualHint:'Save 16.7%',monthly:'Monthly',monthlyHint:'+20%',
    workers:'Active workers',scaleMin:'25',scaleMax:'5,000',
    calcNote:'An active worker received at least one instruction that month.',
    popular:'Most popular',from:'From',perMonth:'/mo',perWorkerMonth:'/active worker /mo',
    seat:'per active worker / month',minimum:(min:number)=>`${formatNumber(min)}-worker minimum`,
    example:'Example total',forWorkers:'for',workerNoun:'active workers',minimumApplies:'Minimum applies',
    billedAnnual:'billed annually',billedMonthly:'billed monthly',
    pricingNote:'Prices are in USD per month, excluding VAT. Monthly billing is 20% above annual. Applicable taxes are confirmed on the invoice.',
    faq:'Before you start',
  };
  const {contextSafe}=useGSAP({scope:root});
  const animateCard=contextSafe((card:HTMLElement,active:boolean)=>{
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    gsap.to(card,{y:active?-6:0,duration:.25,ease:'power2.out',overwrite:'auto'});
    gsap.to(card.querySelector('.plans-card-action svg'),{x:active?(ar?-4:4):0,duration:.25,ease:'power2.out',overwrite:'auto'});
  });
  const interactions={
    onPointerEnter:(event:PointerEvent<HTMLElement>)=>{if(event.pointerType!=='touch'&&window.matchMedia('(hover: hover) and (pointer: fine)').matches)animateCard(event.currentTarget,true);},
    onPointerLeave:(event:PointerEvent<HTMLElement>)=>{if(!event.currentTarget.matches(':focus-within'))animateCard(event.currentTarget,false);},
    onFocus:(event:FocusEvent<HTMLElement>)=>animateCard(event.currentTarget,true),
    onBlur:(event:FocusEvent<HTMLElement>)=>{if(!event.currentTarget.contains(event.relatedTarget)&&!event.currentTarget.matches(':hover'))animateCard(event.currentTarget,false);},
  };
  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      const timeline=gsap.timeline({defaults:{ease:'power2.out',duration:.55}})
        .from('.plans-studio-heading > *',{y:18,opacity:0,stagger:.1})
        .from('.plans-toolbar',{y:16,opacity:0,duration:.5},'-.2')
        .from('.plans-card-wrap',{y:30,opacity:0,stagger:.1},'-.15')
        .from('.plans-card-badge',{scale:.85,opacity:0,duration:.3,stagger:.08},'-.25')
        .from('.plans-card-rule',{scaleX:0,transformOrigin:ar?'right center':'left center',duration:.6,stagger:.08},'-.55')
        .from('.plans-card-action',{y:8,opacity:0,stagger:.07,duration:.35},'-.4');
      ScrollTrigger.create({id:'plans-cards',trigger:root.current,start:'top 80%',animation:timeline,once:true});
    });
    return()=>media.revert();
  },{scope:root,dependencies:[locale],revertOnUpdate:true});
  useGSAP(()=>{
    const pill=root.current?.querySelector<HTMLElement>('.plans-billing-pill');
    if(!pill)return;
    const xPercent=billing==='monthly'?(ar?-100:100):0;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){gsap.set(pill,{xPercent});return;}
    gsap.to(pill,{xPercent,duration:.38,ease:'power3.out',overwrite:'auto'});
  },{scope:root,dependencies:[billing,locale]});
  useGSAP(()=>{
    const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for(const plan of plans){
      const el=root.current?.querySelector<HTMLElement>(`[data-plan-total="${plan.id}"]`);
      if(!el)continue;
      const end=Number(el.dataset.planAmount);
      if(!Number.isFinite(end))continue;
      const state=totalStates.current[plan.id]??{value:end};
      totalStates.current[plan.id]=state;
      if(reduce){state.value=end;continue;}
      const start=state.value;
      if(start===end)continue;
      state.value=start;
      gsap.killTweensOf(state);
      el.textContent=formatNumber(Math.round(start));
      gsap.to(state,{value:end,duration:.5,ease:'power2.out',overwrite:true,onUpdate:()=>{el.textContent=formatNumber(Math.round(state.value));},onComplete:()=>{state.value=end;el.textContent=formatNumber(end);}});
    }
  },{scope:root,dependencies:[billing,workers,locale]});
  const progress=(workers-25)/(5000-25)*100;
  const sliderStyle={'--plans-progress':`${progress}%`} as CSSProperties;
  return <section ref={root} id="plans" className="landing-section landing-container plans-studio" aria-labelledby="plans-title">
    <header className="plans-studio-heading"><h2 id="plans-title">{labels.heading}</h2><p>{labels.intro}</p></header>
    <button type="button" className="mobile-pricing-toggle" aria-expanded={calculatorOpen} aria-controls="plans-calculator-controls" onClick={()=>setCalculatorOpen(value=>!value)}>{ar?'احسب تكلفة فريقك':'Estimate your team’s cost'}<ChevronDown size={17}/></button>
    <div id="plans-calculator-controls" className={`plans-toolbar ${calculatorOpen?'is-expanded':''}`}>
      <div className="plans-billing-group">
        <span className="plans-toolbar-label" id="plans-billing-label">{labels.billing}</span>
        <div className="plans-billing" role="group" aria-labelledby="plans-billing-label">
          <span className="plans-billing-pill" aria-hidden="true"/>
          <button type="button" aria-pressed={billing==='annual'} onClick={()=>setBilling('annual')}>{labels.annual}<small>{labels.annualHint}</small></button>
          <button type="button" aria-pressed={billing==='monthly'} onClick={()=>setBilling('monthly')}>{labels.monthly}<small><bdi dir="ltr">{labels.monthlyHint}</bdi></small></button>
        </div>
      </div>
      <div className="plans-calculator">
        <div className="plans-calculator-heading"><label htmlFor="plans-workers">{labels.workers}</label><output htmlFor="plans-workers">{formatNumber(workers)}</output></div>
        <input id="plans-workers" type="range" min={25} max={5000} step={25} value={workers} style={sliderStyle} onChange={event=>setWorkers(Number(event.target.value))}/>
        <div className="plans-scale" aria-hidden="true"><span>{labels.scaleMin}</span><span>{labels.scaleMax}</span></div>
        <p className="plans-calculator-note">{labels.calcNote}</p>
      </div>
    </div>
    <div className="plans-card-grid">
      {plans.map(plan=>{
        const copy=plan.copy[locale];
        const billable=Math.max(workers,plan.min);
        const total=Math.round((plan.base+plan.seat*billable)*(billing==='monthly'?1.2:1));
        const href=plan.id==='pilot'?'#pilot':`#register/${plan.id}`;
        const cta=plan.id==='pilot'?copy.cta:ar?`اختر ${plan.name}`:`Choose ${plan.name}`;
        return <div className="plans-card-wrap" key={plan.id}>
          <article {...interactions} className={`plans-card${plan.featured?' plans-card--featured':''}`} aria-labelledby={`plan-${plan.id}-title`}>
            {plan.featured&&<span className="plans-card-badge">{labels.popular}</span>}
            <div className="plans-card-heading"><h3 id={`plan-${plan.id}-title`}>{plan.name}</h3><span>{copy.blurb}</span></div>
            {plan.id==='pilot'?<div className="plans-card-price"><p className="plans-price-main"><strong>{ar?'برنامج تجريبي موجّه':'Guided pilot'}</strong></p><p className="plans-price-min">{ar?'14 يوماً · موقع واحد · حتى 25 عاملاً':'14 days · one site · up to 25 workers'}</p></div>:<div className="plans-card-price">
              <p className="plans-price-main">
                {plan.from&&<span className="plans-price-from">{labels.from}</span>}
                <bdi dir="ltr"><strong>{plan.base?`$${formatNumber(plan.base)}`:`$${plan.seat.toFixed(2)}`}</strong></bdi>
                <span className="plans-price-period">{plan.base?labels.perMonth:labels.perWorkerMonth}</span>
              </p>
              {plan.base>0&&<p className="plans-price-seat">+ <bdi dir="ltr">${plan.seat.toFixed(2)}</bdi> {labels.seat}</p>}
              <p className="plans-price-min">{labels.minimum(plan.min)}</p>
            </div>}
            <button type="button" className="mobile-plan-toggle" aria-expanded={!!expandedPlans[plan.id]} aria-controls={`plan-details-${plan.id}`} onClick={()=>setExpandedPlans(value=>({...value,[plan.id]:!value[plan.id]}))}>{ar?'تفاصيل الخطة':'Plan details'}<ChevronDown size={16}/></button>
            <div id={`plan-details-${plan.id}`} className={`plans-card-details ${expandedPlans[plan.id]?'is-expanded':''}`}>
            <p className="plans-card-description">{copy.description}</p>
            <span className="plans-card-rule" aria-hidden="true"/>
            <ul className="plans-card-features">{copy.features.map(point=><li key={point}><Check size={17} aria-hidden="true"/>{point}</li>)}</ul>
            {plan.id!=='pilot'&&<div className="plans-card-example" data-plan-example={plan.id}>
              <span>{labels.example}</span>
              <strong className="plans-example-total"><bdi dir="ltr">≈ $<span data-plan-total={plan.id} data-plan-amount={total}>{formatNumber(total)}</span></bdi><small>{labels.perMonth}</small></strong>
              <small>{labels.forWorkers} <bdi>{formatNumber(billable)}</bdi> {labels.workerNoun} · {billing==='annual'?labels.billedAnnual:labels.billedMonthly}</small>
              {billable!==workers&&<small className="plans-example-min">{labels.minimumApplies}</small>}
            </div>}
            </div>
            <div className="plans-card-action"><a className={`landing-button ${plan.featured?'landing-button--light':'landing-button--outline'}`} href={href}>{cta}<ArrowRight size={18} className="landing-forward" aria-hidden="true"/></a><p>{copy.note}</p></div>
          </article>
        </div>;
      })}
    </div>
    <a className="mobile-full-pricing landing-text-link" href="#pricing">{ar?'عرض مقارنة الخطط كاملة':'See full pricing and comparison'}<ArrowRight size={17}/></a>
    <p className="plans-pricing-note">{labels.pricingNote}</p>
    <p className="plans-inquiry-note">{t.pilotNote}</p>
    <div className="plans-studio-faq"><h3>{labels.faq}</h3><div>{t.faqs.map(item=><details key={item.q}><summary>{item.q}<ChevronDown size={18} aria-hidden="true"/></summary><p>{item.a}</p></details>)}</div></div>
  </section>;
}
