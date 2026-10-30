import {useRef,type PointerEvent,type FocusEvent} from 'react';
import {ArrowRight,Check,ChevronDown} from 'lucide-react';
import {gsap,useGSAP,ScrollTrigger} from './gsap-scroll';
import {landingCopy,type LandingLocale} from './landing-content';
import './landing-plans.css';

export function LandingPlans({locale,registrationAvailable}:{locale:LandingLocale;registrationAvailable:boolean}){
  const root=useRef<HTMLElement>(null),t=landingCopy[locale],ar=locale==='ar';
  const {contextSafe}=useGSAP({scope:root});
  const animateCard=contextSafe((card:HTMLElement,active:boolean)=>{
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    gsap.to(card,{y:active?-8:0,duration:.2,ease:'power2.out',overwrite:'auto'});
    gsap.to(card.querySelector('.plans-card-action svg'),{x:active?(ar?-4:4):0,duration:.2,ease:'power2.out',overwrite:'auto'});
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
        .from('.plans-card-wrap',{y:30,opacity:0,stagger:.13},'-.2')
        .from('.plans-card-rule',{scaleX:0,transformOrigin:ar?'right center':'left center',duration:.65,stagger:.1},'-.5')
        .from('.plans-card .landing-button',{y:8,opacity:0,stagger:.1,duration:.35},'-.3');
      ScrollTrigger.create({id:'plans-cards',trigger:root.current,start:'top 80%',animation:timeline,once:true});
    });
    return()=>media.revert();
  },{scope:root,dependencies:[locale],revertOnUpdate:true});
  return <section ref={root} id="plans" className="landing-section landing-container plans-studio" aria-labelledby="plans-title">
    <header className="plans-studio-heading"><h2 id="plans-title">{ar?'ابدأ صغيراً. توسّع بثقة.':'Start small. Move forward.'}</h2><p>{ar?'جرّب مع فريقك أولاً. ثم خطّط للخطوة التالية لشركتك.':'Try it with your team first. Then find the right next step for your company.'}</p></header>
    <div className="plans-card-grid">
      <div className="plans-card-wrap"><article {...interactions} className="plans-card" aria-labelledby="plan-starter-title">
        <div className="plans-card-heading"><h3 id="plan-starter-title">Starter</h3><span>{ar?'للفريق الأول':'For your first team'}</span></div>
        <p className="plans-card-price">{ar?'مجاناً':'Free'}<span>{t.trialDays}</span></p>
        <p className="plans-card-description">{registrationAvailable?t.trialBody:t.trialUnavailable}</p>
        <span className="plans-card-rule" aria-hidden="true"/>
        <ul className="plans-card-features">{[t.trialLimit,...t.trialPoints].map(point=><li key={point}><Check size={17} aria-hidden="true"/>{point}</li>)}</ul>
        <div className="plans-card-action"><a className="landing-button landing-button--outline" href={registrationAvailable?'#register':'#how-it-works'}>{registrationAvailable?t.trialCta:t.demoCta}<ArrowRight size={18} className="landing-forward" aria-hidden="true"/></a><p>{ar?'دون بطاقة دفع أو رسوم تلقائية.':'No card. No automatic charge.'}</p></div>
      </article></div>
      <div className="plans-card-wrap"><article {...interactions} className="plans-card plans-card--featured" aria-labelledby="plan-pro-title">
        <div className="plans-card-heading"><h3 id="plan-pro-title">Pro</h3><span>{ar?'للفرق المتنامية':'For growing teams'}</span></div>
        <p className="plans-card-price">{ar?'لنتحدث':'Let’s talk'}<span>{ar?'حسب احتياجات فريقك':'Based on your team'}</span></p>
        <p className="plans-card-description">{ar?'اجعل تعليمات العمل اليومية أوضح، وتابع الردود وطلبات المساعدة في مكان واحد.':'Bring everyday instructions, worker responses, and follow-up into one place.'}</p>
        <span className="plans-card-rule" aria-hidden="true"/>
        <ul className="plans-card-features">{(ar?['تعليمات مكتوبة أو صوتية','إعداد التعليمات بلغات فريقك','أسئلة مرتبطة بكل تعليمات','متابعة الردود وطلبات التوضيح']:['Written and recorded instructions','Instructions in your team’s languages','Instruction-specific questions','Responses and clarification follow-up']).map(point=><li key={point}><Check size={17} aria-hidden="true"/>{point}</li>)}</ul>
        <div className="plans-card-action"><a className="landing-button landing-button--light" href="#pilot">{ar?'ناقش احتياجات فريقك':'Discuss your team'}<ArrowRight size={18} className="landing-forward" aria-hidden="true"/></a><p>{ar?'نحدد نطاق التجربة معك.':'Pilot scope agreed with you.'}</p></div>
      </article></div>
      <div className="plans-card-wrap"><article {...interactions} className="plans-card" aria-labelledby="plan-business-title">
        <div className="plans-card-heading"><h3 id="plan-business-title">Business</h3><span>{ar?'للتوسع في الشركة':'For company rollouts'}</span></div>
        <p className="plans-card-price">{ar?'عرض مخصص':'Custom quote'}<span>{ar?'لنطاق عمل شركتك':'Built around your operation'}</span></p>
        <p className="plans-card-description">{ar?'خطّط لتعميم Understood على مواقعك وأطقمك، بدءاً بحالة استخدام واضحة.':'Plan how Understood fits your sites and crews, starting with a focused use case.'}</p>
        <span className="plans-card-rule" aria-hidden="true"/>
        <ul className="plans-card-features">{(ar?['تنظيم العمال ضمن أطقم','مساحات عمل محددة لكل موقع','صلاحيات للمشرفين','تقارير التعليمات وإنجاز العمل']:['Organize workers into crews','Site-scoped workspaces','Supervisor access controls','Instruction and completion reports']).map(point=><li key={point}><Check size={17} aria-hidden="true"/>{point}</li>)}</ul>
        <div className="plans-card-action"><a className="landing-button landing-button--outline" href="#pilot">{ar?'ناقش خطة التعميم':'Discuss your rollout'}<ArrowRight size={18} className="landing-forward" aria-hidden="true"/></a><p>{ar?'أخبرنا بالمواقع واللغات المطلوبة.':'Tell us your sites and languages.'}</p></div>
      </article></div>
    </div>
    <p className="plans-inquiry-note">{t.pilotNote}</p>
    <div className="plans-studio-faq"><h3>{ar?'قبل أن تبدأ':'Before you start'}</h3><div>{t.faqs.map(item=><details key={item.q}><summary>{item.q}<ChevronDown size={18} aria-hidden="true"/></summary><p>{item.a}</p></details>)}</div></div>
  </section>;
}
