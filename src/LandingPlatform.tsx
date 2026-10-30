import {useRef} from 'react';
import {ArrowRight,Check,CheckCheck,FileText,MessageCircle,Volume2} from 'lucide-react';
import {gsap,useGSAP} from './gsap-scroll';
import type {LandingLocale} from './landing-content';
import './landing-platform.css';

const copy={
  en:{title:'One instruction. One team.',body:'Send work instructions in your team’s languages. See who needs help and who has finished.',
    stages:[{title:'Send it clearly',body:'Write or record an instruction, review it, then choose who receives it.'},{title:'Check understanding',body:'Workers read or listen in their language and answer a question about the instruction.'},{title:'Follow through',body:'Review responses, clarify problems, and see when workers mark their work done.'}],
    instruction:'Put finished items on the blue shelf. Leave the walkway clear.',name:'Shelf colour handover',crew:'Assigned to the warehouse crew',question:'Which shelf is for finished items?',answer:'Blue shelf',worker:'Worker’s view',supervisor:'Supervisor’s view',matched:'Understanding check passed',help:'Help requests stay with the instruction',done:'Worker marked the work done',sample:'Illustrative example · not live activity',link:'Try the instruction example'},
  ar:{title:'تعليمات واضحة. فهم مشترك.',body:'أرسل تعليمات العمل بلغات فريقك. اعرف من يحتاج إلى المساعدة ومن أنهى عمله.',
    stages:[{title:'أرسل بوضوح',body:'اكتب التعليمات أو سجّلها، راجعها، ثم اختر من يتلقاها.'},{title:'تحقّق من الفهم',body:'يقرأ العامل أو يستمع بلغته ويجيب عن سؤال يتعلق بالتعليمات.'},{title:'تابع حتى الإنجاز',body:'راجع الإجابات، وضّح المشكلات، واعرف متى يسجّل العامل إنجاز العمل.'}],
    instruction:'ضع المنتجات المكتملة على الرف الأزرق. أبقِ الممر خالياً.',name:'ترتيب المنتجات على الرفوف',crew:'مُسندة إلى فريق المستودع',question:'على أي رف توضع المنتجات المكتملة؟',answer:'الرف الأزرق',worker:'واجهة العامل',supervisor:'واجهة المشرف',matched:'اجتاز سؤال التحقق من الفهم',help:'طلبات المساعدة مرتبطة بالتعليمات',done:'سجّل العامل إنجاز العمل',sample:'مثال توضيحي · ليس نشاطاً مباشراً',link:'جرّب مثال التعليمات'},
};

export function LandingPlatform({locale}:{locale:LandingLocale}){
  const root=useRef<HTMLElement>(null),t=copy[locale];
  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add({motion:'(prefers-reduced-motion: no-preference)',mobile:'(max-width: 700px)'},context=>{
      if(!context.conditions?.motion)return;
      const lineStart=context.conditions.mobile?{scaleY:0}:{scaleX:0};
      gsap.timeline({scrollTrigger:{id:'platform-instruction-journey',trigger:root.current,start:'top 76%',once:true},defaults:{ease:'power2.out'}})
        .from('.platform-purpose-heading > *',{y:18,opacity:0,stagger:.12,duration:.6})
        .from('.platform-purpose-line',{...lineStart,duration:.85},'-=.15')
        .from('.platform-purpose-step',{y:26,opacity:0,stagger:.2,duration:.65},'<')
        .from('.platform-example-paper',{y:12,opacity:0,duration:.45},'-=.3')
        .from('.platform-example-answer',{scale:.96,opacity:0,duration:.4},'>-.1')
        .from('.platform-example-result li',{x:locale==='ar'?-12:12,opacity:0,stagger:.15,duration:.4},'>-.1');
    });
    return()=>media.revert();
  },{scope:root,dependencies:[locale],revertOnUpdate:true});
  return <section ref={root} className="landing-section landing-container platform-purpose" id="platform" aria-labelledby="platform-title">
    <header className="platform-purpose-heading"><h2 id="platform-title">{t.title}</h2><p>{t.body}</p></header>
    <div className="platform-purpose-story">
      <span className="platform-purpose-line" aria-hidden="true"/>
      <ol className="platform-purpose-steps">
        {t.stages.map((stage,index)=><li className="platform-purpose-step" key={stage.title}>
          <span className="platform-purpose-number" aria-hidden="true">0{index+1}</span><h3>{stage.title}</h3><p>{stage.body}</p>
          <div className="platform-purpose-example">
            {index===0?<><div className="platform-example-label"><FileText size={17}/><span>{t.name}</span></div><blockquote className="platform-example-paper">{t.instruction}</blockquote><div className="platform-example-foot"><CheckCheck size={16}/>{t.crew}</div></>:
              index===1?<><div className="platform-example-label"><Volume2 size={17}/><span>{t.worker}</span><span className="platform-example-language">{locale==='ar'?'العربية':'English'}</span></div><p className="platform-example-question">{t.question}</p><div className="platform-example-answer"><Check size={18}/>{t.answer}</div></>:
              <><div className="platform-example-label"><span>{t.supervisor}</span></div><ul className="platform-example-result"><li><Check size={17}/>{t.matched}</li><li><MessageCircle size={17}/>{t.help}</li><li><CheckCheck size={17}/>{t.done}</li></ul></>}
          </div>
        </li>)}
      </ol>
    </div>
    <div className="platform-purpose-footer"><span>{t.sample}</span><a className="landing-text-link" href="#how-it-works">{t.link}<ArrowRight size={17} className="landing-forward" aria-hidden="true"/></a></div>
  </section>;
}
