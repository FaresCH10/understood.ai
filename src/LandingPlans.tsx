import {useRef} from 'react';
import {ArrowRight,Check,ChevronDown,Users,ArrowUpRight} from 'lucide-react';
import {gsap,useGSAP,ScrollTrigger} from './gsap-scroll';
import {landingCopy,type LandingLocale} from './landing-content';
import './landing-plans.css';

export function LandingPlans({locale,registrationAvailable}:{locale:LandingLocale;registrationAvailable:boolean}){
  const root=useRef<HTMLElement>(null),t=landingCopy[locale],ar=locale==='ar';
  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      const timeline=gsap.timeline({defaults:{ease:'power2.out',duration:.6}})
        .from('.plans-studio-heading > *',{y:18,opacity:0,stagger:.1})
        .from('.plans-studio-board',{y:24,duration:.7},'-.2')
        .from('.plans-trial-duration',{y:24,duration:.8},'-.4')
        .from('.plans-studio-checks li',{x:ar?12:-12,stagger:.1,duration:.4},'-.45')
        .from('.plans-pilot-steps li',{y:14,stagger:.12,duration:.5},'-.5')
        .from('.plans-studio-board .landing-button',{y:8,stagger:.1,duration:.4},'-.25');
      ScrollTrigger.create({id:'plans-studio',trigger:root.current,start:'top 78%',animation:timeline,toggleActions:'play none none none'});
    });
    return()=>media.revert();
  },{scope:root,dependencies:[locale],revertOnUpdate:true});
  return <section ref={root} id="plans" className="landing-section landing-container plans-studio" aria-labelledby="plans-title">
    <header className="plans-studio-heading"><h2 id="plans-title">{ar?'ابدأ صغيراً. توسّع بثقة.':'Start small. Move forward.'}</h2><p>{ar?'جرّب مع فريقك أولاً. ثم خطّط للخطوة التالية لشركتك.':'Try it with your team first. Then find the right next step for your company.'}</p></header>
    <div className="plans-studio-board">
      <article className="plans-studio-trial"><div className="plans-option-label"><span>{t.trialName}</span><span>{ar?'01':'01'}</span></div>
        <h3 className="plans-trial-duration">{t.trialDays}</h3><div className="plans-worker-limit"><Users size={18} aria-hidden="true"/>{t.trialLimit}</div>
        <p>{registrationAvailable?t.trialBody:t.trialUnavailable}</p>
        <ul className="plans-studio-checks">{t.trialPoints.map(point=><li key={point}><Check size={17} aria-hidden="true"/>{point}</li>)}</ul>
        <a className="landing-button landing-button--light" href={registrationAvailable?'#register':'#how-it-works'}>{registrationAvailable?t.trialCta:t.demoCta}<ArrowRight size={18} className="landing-forward" aria-hidden="true"/></a>
        {registrationAvailable&&<p className="plans-studio-note">{ar?'دون بطاقة دفع أو رسوم تلقائية.':'No card. No automatic charge.'}</p>}
      </article>
      <article className="plans-studio-pilot"><div className="plans-option-label"><span>{t.pilotName}</span><span>02</span></div>
        <h3>{ar?'خطوتك التالية، معاً.':'Your next step, together.'}</h3><p>{t.pilotBody}</p>
        <ol className="plans-pilot-steps">{t.pilotPoints.map((point,index)=><li key={point}><span aria-hidden="true">0{index+1}</span><span>{point}</span></li>)}</ol>
        <a className="landing-button landing-button--primary" href="#pilot">{t.pilotLink}<ArrowUpRight size={18} aria-hidden="true"/></a><p className="plans-studio-note">{t.pilotNote}</p>
      </article>
    </div>
    <div className="plans-studio-faq"><h3>{ar?'قبل أن تبدأ':'Before you start'}</h3><div>{t.faqs.map(item=><details key={item.q}><summary>{item.q}<ChevronDown size={18} aria-hidden="true"/></summary><p>{item.a}</p></details>)}</div></div>
  </section>;
}
