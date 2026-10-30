import {useRef,useState} from 'react';
import {AudioLines,Check,CheckCheck,Globe2,ArrowUpRight} from 'lucide-react';
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
      const timeline=gsap.timeline({defaults:{ease:'power2.out'}})
        .from('.language-showcase-heading > *',{y:18,opacity:0,stagger:.1,duration:.55})
        .from('.language-showcase-board',{y:24,duration:.7},'-.2')
        .from('.language-choice',{y:12,stagger:.035,duration:.4},'-.35')
        .from('.language-showcase-benefits li',{y:10,opacity:0,stagger:.1,duration:.4},'-.2');
      ScrollTrigger.create({id:'language-showcase',trigger:root.current,start:'top 78%',animation:timeline,toggleActions:'play none none none'});
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
            <div className="language-preview-brand"><span>Understood<AudioLines size={19} aria-hidden="true"/></span><span lang={language.code} dir={language.direction}>{language.name}</span></div>
            <div lang={language.code} dir={language.direction} className="language-preview-body"><h3>{labels.title}</h3><div className="language-preview-progress"><span aria-hidden="true"/><span>{labels.progress}</span></div><div className="language-preview-done"><CheckCheck size={20} aria-hidden="true"/><span>{labels.done}</span><Check size={17} aria-hidden="true"/></div></div>
            <figcaption>{c.preview}</figcaption>
          </figure>
        </div>
        <p className="language-preview-note">{c.note}</p>
      </div>
      <div className="language-showcase-picker"><div className="language-picker-heading"><h3 id="language-picker-title">{c.choose}</h3><ArrowUpRight size={22} aria-hidden="true"/></div><p>{c.hint}</p>
        <div className="language-choice-grid" role="group" aria-labelledby="language-picker-title">{WORKER_LOCALES.map(item=><button type="button" className="language-choice" key={item.code} aria-label={item.englishName} aria-pressed={selected===item.code} onClick={()=>setSelected(item.code)}><span lang={item.code} dir={item.direction}>{item.name}</span><span>{item.englishName}</span>{selected===item.code&&<Check size={13} aria-hidden="true"/>}</button>)}</div>
        <p className="language-script-note">{c.scripts}</p>
      </div>
    </div>
    <ul className="language-showcase-benefits">{t.languagePoints.map(point=><li key={point}><Check size={17} aria-hidden="true"/>{point}</li>)}</ul>
    <p className="language-showcase-coverage">{c.coverage}</p>
  </section>;
}
