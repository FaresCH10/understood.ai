import {useEffect,useRef,useState} from 'react';
import {ArrowRight,AudioLines,Check,ChevronRight,FileText,Globe2,KeyRound,MessageCircle,Mic,Pause,Play,ShieldCheck,Users} from 'lucide-react';
import {gsap,useGSAP,ScrollTrigger} from './gsap-scroll';
import {WORKER_LOCALES} from '../server/languages.mjs';
import {landingCopy,type LandingLocale} from './landing-content';
import {LandingDemo} from './LandingDemo';
import {LandingHero} from './LandingHero';
import {HeroJourney} from './HeroJourney';
import {CompanyPreview,SupervisorPreview,WorkerPreview} from './LandingIllustrations';
import {publicLandingTarget} from './public-navigation';

export function LandingPage({view,locale,registrationAvailable}:{view:string;locale:LandingLocale;registrationAvailable:boolean}){
  const t=landingCopy[locale],root=useRef<HTMLDivElement>(null);
  const [platformView,setPlatformView]=useState<'supervisor'|'worker'>('supervisor'),[industry,setIndustry]=useState(0),[motionPaused,setMotionPaused]=useState(false);
  const scenario=t.industries[industry],rolePoints=platformView==='supervisor'?t.supervisorPoints:t.workerPoints;
  useGSAP(()=>{
    if(motionPaused)return;
    const media=gsap.matchMedia();let disposed=false;
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      gsap.utils.toArray<HTMLElement>('.landing-section',root.current).forEach(section=>{
        const targets=section.querySelectorAll('[data-reveal]');
        if(targets.length)gsap.from(targets,{y:24,opacity:0,stagger:.075,duration:.7,ease:'power2.out',scrollTrigger:{id:`landing-reveal-${section.id}`,trigger:section,start:'top 86%',once:true}});
      });
      gsap.fromTo('.landing-workflow-line',{scaleY:0},{scaleY:1,ease:'none',scrollTrigger:{id:'landing-workflow-progress',trigger:'.landing-workflow-steps',start:'top 65%',end:'bottom 65%',scrub:.7}});
      const refresh=()=>{if(!disposed)ScrollTrigger.refresh();};
      const pictures=[...root.current!.querySelectorAll('img')];
      pictures.forEach(picture=>picture.addEventListener('load',refresh));
      void document.fonts.ready.then(refresh);refresh();
      return()=>pictures.forEach(picture=>picture.removeEventListener('load',refresh));
    });
    return()=>{disposed=true;media.revert();};
  },{scope:root,dependencies:[locale,motionPaused],revertOnUpdate:true});

  useEffect(()=>{
    if(view==='platform/worker')setPlatformView('worker');
    if(view==='platform/supervisor')setPlatformView('supervisor');
    const frame=requestAnimationFrame(()=>{
      ScrollTrigger.refresh();
      const target=publicLandingTarget(view),section=root.current?.querySelector<HTMLElement>(`#${target}`);
      if(target==='landing-top')window.scrollTo({top:0,behavior:'instant'});
      else if(section)section.scrollIntoView({behavior:'instant',block:'start'});
    });
    return()=>cancelAnimationFrame(frame);
  },[view]);

  useEffect(()=>{const frame=requestAnimationFrame(()=>ScrollTrigger.refresh());return()=>cancelAnimationFrame(frame);},[platformView,industry,locale]);

  return <div className="landing-page" ref={root}>
    <LandingHero locale={locale} registrationAvailable={registrationAvailable} motionPaused={motionPaused}/>
    <HeroJourney locale={locale} motionPaused={motionPaused}/>
    <div className="landing-capability-strip"><div className="landing-container">{t.strip.map((text,index)=>{const Icon=[Mic,KeyRound,Globe2,MessageCircle][index];return <span key={text}><Icon size={19} aria-hidden="true"/>{text}</span>;})}</div></div>

    <section className="landing-section landing-container" id="platform" aria-labelledby="platform-title">
      <header className="landing-section-heading" data-reveal><h2 id="platform-title">{t.platformTitle}</h2><p>{t.platformBody}</p></header>
      <div className="landing-platform-layout"><div className="landing-platform-copy" data-reveal><div className="landing-view-switch" role="group" aria-label={locale==='ar'?'واجهة المنصة':'Platform view'}><button type="button" aria-pressed={platformView==='supervisor'} onClick={()=>{location.hash='platform/supervisor';}}>{t.supervisor}</button><button type="button" aria-pressed={platformView==='worker'} onClick={()=>{location.hash='platform/worker';}}>{t.worker}</button></div><h3>{platformView==='supervisor'?t.supervisorTitle:t.workerTitle}</h3><p>{platformView==='supervisor'?t.supervisorBody:t.workerBody}</p><ul className="landing-check-list">{rolePoints.map(point=><li key={point}><Check size={17} aria-hidden="true"/>{point}</li>)}</ul><a className="landing-text-link" href="#sign-in">{t.signIn}<ArrowRight size={17} className="landing-forward" aria-hidden="true"/></a></div><div className="landing-platform-stage" data-reveal>{platformView==='supervisor'?<SupervisorPreview locale={locale}/>:<WorkerPreview locale={locale}/>}</div></div>
    </section>

    <section className="landing-section landing-workflow-section" id="how-it-works" aria-labelledby="workflow-title"><div className="landing-container">
      <header className="landing-section-heading" data-reveal><h2 id="workflow-title">{t.workflowTitle}</h2><p>{t.workflowBody}</p></header><div className="landing-workflow-layout"><div className="landing-steps-stage"><span className="landing-workflow-line" aria-hidden="true"/><ol className="landing-workflow-steps">{t.steps.map((step,index)=>{const Icon=[Mic,AudioLines,MessageCircle][index];return <li key={step.title} data-reveal><div className="landing-step-icon"><Icon size={23} aria-hidden="true"/></div><div><h3>{step.title}</h3><p>{step.body}</p></div></li>;})}</ol></div><div className="landing-workflow-demo" data-reveal><LandingDemo locale={locale} motionPaused={motionPaused}/></div></div>
    </div></section>

    <section className="landing-section landing-container landing-languages-layout" id="languages" aria-labelledby="languages-title"><div data-reveal><h2 id="languages-title">{t.languagesTitle}</h2><p className="landing-section-lead">{t.languagesBody}</p><ul className="landing-check-list">{t.languagePoints.map(point=><li key={point}><Check size={17} aria-hidden="true"/>{point}</li>)}</ul><p className="landing-coverage-note">{t.languageCoverage}</p><p className="landing-language-fact">{t.languageFact}</p></div><div className="landing-language-board" data-reveal><div className="landing-language-total"><Globe2 size={32} aria-hidden="true"/><span><strong>{WORKER_LOCALES.length}</strong>{t.interfaceLabel}</span></div><ul>{WORKER_LOCALES.map(language=><li key={language.code}><span lang={language.code} dir={language.direction}>{language.name}</span><span>{language.englishName}</span></li>)}</ul></div></section>

    <section className="landing-section landing-companies-section" id="companies" aria-labelledby="companies-title"><div className="landing-container"><header className="landing-section-heading" data-reveal><h2 id="companies-title">{t.companiesTitle}</h2><p>{t.companiesBody}</p></header><div className="landing-industry-picker" role="group" aria-label={locale==='ar'?'أمثلة القطاعات':'Industry examples'} data-reveal>{t.industries.map((item,index)=><button type="button" key={item.name} aria-pressed={industry===index} onClick={()=>setIndustry(index)}>{item.name}</button>)}</div><div className="landing-industry-scene" data-reveal><div className="landing-industry-story"><FileText size={25} aria-hidden="true"/><h3>{scenario.title}</h3><p>{scenario.body}</p><blockquote>{scenario.instruction}</blockquote><span className="landing-illustration-caption">{t.exampleSource}</span></div><CompanyPreview locale={locale}/></div><div className="landing-company-controls" id="company-controls">{t.companyControls.map((control,index)=>{const Icon=[Users,FileText,ShieldCheck][index];return <article key={control.title} data-reveal><Icon size={24} aria-hidden="true"/><h3>{control.title}</h3><p>{control.body}</p></article>;})}</div></div></section>

    <section className="landing-section landing-container landing-plans-section" id="plans" aria-labelledby="plans-title"><header className="landing-section-heading" data-reveal><h2 id="plans-title">{t.plansTitle}</h2><p>{t.plansBody}</p></header><div className="landing-plan-grid"><article className="landing-plan" data-reveal><span className="landing-plan-name">{t.trialName}</span><h3>{t.trialDays}</h3><strong>{t.trialLimit}</strong><p>{registrationAvailable?t.trialBody:t.trialUnavailable}</p><ul className="landing-check-list">{t.trialPoints.map(point=><li key={point}><Check size={17} aria-hidden="true"/>{point}</li>)}</ul><a className="landing-button landing-button--primary" href={registrationAvailable?'#register':'#walkthrough'}>{registrationAvailable?t.trialCta:t.demoCta}<ArrowRight size={18} className="landing-forward" aria-hidden="true"/></a></article><article className="landing-plan landing-plan--company" data-reveal><span className="landing-plan-name">{t.pilotName}</span><h3>{t.pilotTitle}</h3><p>{t.pilotBody}</p><ul className="landing-check-list">{t.pilotPoints.map(point=><li key={point}><Check size={17} aria-hidden="true"/>{point}</li>)}</ul><a className="landing-button landing-button--light" href="#pilot">{t.pilotLink}<ArrowRight size={18} className="landing-forward" aria-hidden="true"/></a><p className="landing-plan-note">{t.pilotNote}</p></article></div><div className="landing-faq"><h3 data-reveal>{t.faqTitle}</h3><div>{t.faqs.map(item=><details key={item.q} data-reveal><summary>{item.q}<ChevronRight size={19} aria-hidden="true"/></summary><p>{item.a}</p></details>)}</div></div></section>
    <div className="landing-motion-control landing-container"><button type="button" aria-pressed={motionPaused} onClick={()=>setMotionPaused(value=>!value)}>{motionPaused?<Play size={14} aria-hidden="true"/>:<Pause size={14} aria-hidden="true"/>}{motionPaused?t.resume:t.pause}</button></div>
  </div>;
}
