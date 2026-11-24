import {BrandLogo} from './BrandLogo';
import {useRef,useState} from 'react';
import {Check,CheckCheck,Globe2,ArrowUpRight} from 'lucide-react';
import {WORKER_LOCALES} from '../server/languages.mjs';
import {workerWorkText} from './worker-work-text';
import {landingCopy,type LandingLocale} from './landing-content';
import {gsap,useGSAP,ScrollTrigger} from './gsap-scroll';
import './landing-languages.css';

const copy={
  en:{title:'One team. Many languages.',body:'A familiar interface helps every worker take the next step. Pick a language and see it for yourself.',choose:'Choose a language',preview:'Worker interface preview',note:'Sample interface labels from Understood. This preview does not change your account language.',coverage:'Instruction translations and audio are prepared separately. Availability depends on the services configured for your workspace.',count:'worker interface options',hint:'Select a language to preview',scripts:'Punjabi includes two script options.'},
  ar:{title:'فريق واحد. لغات متعددة.',body:'واجهة مألوفة تساعد كل عامل على اتخاذ الخطوة التالية. اختر لغة وجرّبها بنفسك.',choose:'اختر لغة',preview:'معاينة واجهة العامل',note:'نصوص توضيحية من واجهة Understood. لا تغيّر هذه المعاينة لغة حسابك.',coverage:'تُعدّ ترجمة التعليمات والصوت بشكل منفصل. يعتمد توفرهما على الخدمات المضبوطة لمساحة عملك.',count:'خيارات لغة لواجهة العامل',hint:'اختر لغة لمعاينة الواجهة',scripts:'تتوفر البنجابية بخيارين للكتابة.'},
};

export function LandingLanguages({locale}:{locale:LandingLocale}){
  const root=useRef<HTMLElement>(null),[selected,setSelected]=useState<string>('ar'),c=copy[locale],t=landingCopy[locale];
  const language=WORKER_LOCALES.find(item=>item.code===selected)!,labels=workerWorkText(selected);
  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      const select=gsap.utils.selector(root);
      gsap.from(select('.language-showcase-heading > *'),{
        y:20,opacity:0,stagger:.1,duration:.6,ease:'power2.out',clearProps:'transform,opacity',
        scrollTrigger:{id:'language-showcase',trigger:root.current,start:'clamp(top 85%)',once:true},
      });
      gsap.timeline({defaults:{ease:'power2.out'},scrollTrigger:{
        id:'language-preview-reveal',trigger:select('.language-showcase-display')[0],start:'clamp(top 88%)',once:true,
      }})
        .from(select('.language-showcase-count, .language-live-content'),{y:24,opacity:0,duration:.6,stagger:.12,clearProps:'transform,opacity'})
        .from(select('.language-preview-progress, .language-preview-done'),{x:locale==='ar'?-18:18,opacity:0,duration:.45,stagger:.1,clearProps:'transform,opacity'},'-.3');
      gsap.timeline({defaults:{ease:'power2.out'},scrollTrigger:{
        id:'language-picker-reveal',trigger:select('.language-showcase-picker')[0],start:'clamp(top 90%)',once:true,
      }})
        .from(select('.language-picker-heading, .mobile-language-select'),{y:16,opacity:0,duration:.45,clearProps:'transform,opacity'})
        .from(select('.language-choice'),{y:14,scale:.97,opacity:0,duration:.4,stagger:{each:.035,from:'start'},clearProps:'transform,opacity'},'-.15');
      gsap.from(select('.language-showcase-benefits li'),{
        y:12,opacity:0,stagger:.1,duration:.45,ease:'power2.out',clearProps:'transform,opacity',
        scrollTrigger:{id:'language-benefits',trigger:select('.language-showcase-benefits')[0],start:'clamp(top 92%)',once:true},
      });
    });
    return()=>media.revert();
  },{scope:root,dependencies:[locale],revertOnUpdate:true});
  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      gsap.from('.language-native-heading, .language-preview-body',{y:12,opacity:.25,duration:.35,ease:'power2.out'});
    });
    return()=>media.revert();
  },{scope:root,dependencies:[selected],revertOnUpdate:true});
  return <section ref={root} id="languages" className="landing-section landing-container language-showcase" aria-labelledby="languages-title">
    <header className="language-showcase-heading"><h2 id="languages-title">{c.title}</h2><p>{c.body}</p></header>
    <div className="language-showcase-board">
      <div className="language-showcase-display">
        <div className="language-showcase-count"><Globe2 size={19} aria-hidden="true"/><span><strong>{WORKER_LOCALES.length}</strong> {c.count}</span></div>
        <div className="language-live-content" aria-live="polite" aria-atomic="true">
          <div className="language-native-heading"><span lang={language.code} dir={language.direction}>{language.name}</span><span>{language.englishName}</span></div>
          <figure className="language-interface-preview">
            <div className="language-preview-brand"><span><BrandLogo/></span><span lang={language.code} dir={language.direction}>{language.name}</span></div>
            <div lang={language.code} dir={language.direction} className="language-preview-body"><h3>{labels.title}</h3><div className="language-preview-progress"><span aria-hidden="true"/><span>{labels.progress}</span></div><div className="language-preview-done"><CheckCheck size={20} aria-hidden="true"/><span>{labels.done}</span><Check size={17} aria-hidden="true"/></div></div>
            <figcaption>{c.preview}</figcaption>
          </figure>
        </div>
        <p className="language-preview-note">{c.note}</p>
      </div>
      <div className="language-showcase-picker"><div className="language-picker-heading"><h3 id="language-picker-title">{c.choose}</h3><ArrowUpRight size={22} aria-hidden="true"/></div><p>{c.hint}</p>
        <label className="mobile-language-select">{c.choose}<select value={selected} onChange={event=>setSelected(event.target.value)}>{WORKER_LOCALES.map(item=><option key={item.code} value={item.code}>{item.name} · {item.englishName}</option>)}</select></label>
        <div className="language-choice-grid" role="group" aria-labelledby="language-picker-title">{WORKER_LOCALES.map(item=><button type="button" className="language-choice" key={item.code} aria-label={item.englishName} aria-pressed={selected===item.code} onClick={()=>setSelected(item.code)}><span lang={item.code} dir={item.direction}>{item.name}</span><span>{item.englishName}</span>{selected===item.code&&<Check size={13} aria-hidden="true"/>}</button>)}</div>
        <p className="language-script-note">{c.scripts}</p>
      </div>
    </div>
    <ul className="language-showcase-benefits">{t.languagePoints.map(point=><li key={point}><Check size={17} aria-hidden="true"/>{point}</li>)}</ul>
    <p className="language-showcase-coverage">{c.coverage}</p>
  </section>;
}
