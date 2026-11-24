import {useRef} from 'react';
import {Mic,Send,MessageCircle} from 'lucide-react';
import {gsap,useGSAP,ScrollTrigger} from './gsap-scroll';
import {LandingLanguages} from './LandingLanguages';
import {LandingPlans} from './LandingPlans';
import {LandingContact} from './PublicContact';
import {landingCopy,type LandingLocale} from './landing-content';
import {LandingDemo} from './LandingDemo';
import {CompanyPreview} from './LandingIllustrations';
import './landing-sections.css';

const copy={
  en:{workflow:'See it in action.',workflowBody:'A clear instruction. A relevant question. A response you can follow up on.',
    languages:'Your team. Their languages.',languagesBody:'Give workers a familiar interface and prepare instructions in the languages they use.',
    languageNote:'Interface languages',languageDetail:'Instruction text and speech are prepared separately. Availability depends on your configured services and the versions ready for each instruction.',
    companies:'Your people. Connected.',companiesBody:'Bring workers, crews and supervisors together around the work that needs doing.',
    companyPoints:[{title:'Give everyone access',body:'Assign worker IDs and passwords. Workers do not need a company email.'},{title:'Reach the right crew',body:'Send to everyone, selected crews, or individual workers.'},{title:'Keep the context together',body:'Return to the instruction, responses and clarification when a worker needs help.'}],
    industries:'For everyday work in',plans:'Start with one team.',plansBody:'Choose the monthly plan that fits your team.',
    trial:'Try Understood',pilot:'Choose a company plan',pilotBody:'Tell us about your sites, team and languages. Start with one useful instruction.',
    faq:'Before you start',trialNote:'No card. No automatic charge.'},
  ar:{workflow:'جرّبها بنفسك.',workflowBody:'تعليمات واضحة. سؤال مرتبط بها. وإجابة يمكنك متابعتها.',
    languages:'فريقك. بلغاتهم.',languagesBody:'واجهة مألوفة للعامل، وتعليمات مُعدّة باللغات التي يستخدمها فريقك.',
    languageNote:'لغات واجهة العامل',languageDetail:'يُعدّ نص التعليمات والصوت بشكل منفصل. يعتمد توفرهما على الخدمات المضبوطة والنسخ الجاهزة لكل تعليمات.',
    companies:'أفراد فريقك. على تواصل.',companiesBody:'اجمع العمال والفرق والمشرفين حول العمل المطلوب إنجازه.',
    companyPoints:[{title:'دخول لكل عامل',body:'عيّن أرقام العمال وكلمات المرور. لا يحتاج العامل إلى بريد إلكتروني للشركة.'},{title:'أرسل للفريق المعني',body:'أرسل للجميع، أو لفرق محددة، أو لعمال تختارهم.'},{title:'كل التفاصيل في مكان واحد',body:'ارجع إلى التعليمات والإجابات والتوضيحات عندما يحتاج العامل إلى المساعدة.'}],
    industries:'للمهام اليومية في',plans:'ابدأ بفريق واحد.',plansBody:'جرّب سير العمل مع فريق صغير، أو ناقش تجربة مخصصة لشركتك.',
    trial:'جرّب Understood',pilot:'اختر خطة لشركتك',pilotBody:'أخبرنا عن مواقعك وفريقك ولغاتهم. ابدأ بتعليمات واحدة مفيدة.',
    faq:'قبل أن تبدأ',trialNote:'دون بطاقة دفع أو رسوم تلقائية.'},
};

function SectionHeading({id,title,body}:{id:string;title:string;body:string}){
  return <header className="landing-unified-heading"><h2 id={id}>{title}</h2><p>{body}</p></header>;
}

export function LandingSections({locale,registrationAvailable}:{locale:LandingLocale;registrationAvailable:boolean}){
  const root=useRef<HTMLDivElement>(null),t=landingCopy[locale],c=copy[locale];
  useGSAP(()=>{
    const media=gsap.matchMedia();
    let disposed=false;
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      const select=gsap.utils.selector(root);
      for(const section of select('.landing-unified-section')){
        const q=gsap.utils.selector(section);
        const timeline=gsap.timeline({defaults:{ease:'power2.out',duration:.6}});
        timeline.from(q('.landing-unified-heading > *'),{y:18,opacity:0,stagger:.1});
        if(section.id==='how-it-works')timeline.from(q('.unified-workflow-track'),{scaleY:0,duration:.85},'-.2').from(q('.unified-workflow-steps > li'),{x:locale==='ar'?18:-18,opacity:0,stagger:.15},'<').from(q('.unified-demo'),{y:26,opacity:0,duration:.75},'-.65');

        if(section.id==='companies'){
          q('.unified-company-points > li').forEach((point:HTMLElement,index:number)=>{
            const details=gsap.utils.selector(point);
            gsap.timeline({defaults:{ease:'power2.out'},scrollTrigger:{
              id:`company-point-${index}`,trigger:point,start:'clamp(top 88%)',once:true,
            }})
              .from(details(':scope > span'),{scale:.9,opacity:0,duration:.4,clearProps:'transform,opacity'})
              .from(details(':scope > div'),{x:locale==='ar'?-22:22,opacity:0,duration:.55,clearProps:'transform,opacity'},'-.25');
          });
          gsap.timeline({defaults:{ease:'power2.out'},scrollTrigger:{
            id:'company-preview-reveal',trigger:q('.unified-company-preview')[0],start:'clamp(top 88%)',once:true,
          }})
            .from(q('.landing-company-preview'),{y:28,scale:.97,opacity:0,duration:.65,clearProps:'transform,opacity'})
            .from(q('.landing-company-preview dl > div'),{x:locale==='ar'?16:-16,opacity:0,duration:.45,stagger:.12,clearProps:'transform,opacity'},'-.3');
          gsap.from(q('.unified-industry-list > li'),{
            y:14,opacity:0,stagger:.07,duration:.45,ease:'power2.out',clearProps:'transform,opacity',
            scrollTrigger:{id:'company-industries',trigger:q('.unified-company-industries')[0],start:'clamp(top 90%)',once:true},
          });
        }

        ScrollTrigger.create({id:`unified-${section.id}`,trigger:section,start:'top 78%',animation:timeline,toggleActions:'play none none none'});
      }
    });
    media.add('(min-width: 801px) and (prefers-reduced-motion: no-preference)',()=>{
      gsap.fromTo('.unified-company-preview',{y:12},{y:-12,ease:'none',scrollTrigger:{
        id:'company-preview-drift',trigger:root.current?.querySelector('#companies'),
        start:'clamp(top bottom)',end:'clamp(bottom top)',scrub:.7,invalidateOnRefresh:true,
      }});
    });
    const refresh=()=>{if(!disposed)ScrollTrigger.refresh();};
    void document.fonts.ready.then(refresh);
    return()=>{disposed=true;media.revert();};
  },{scope:root,dependencies:[locale],revertOnUpdate:true});

  return <div ref={root} className="landing-unified-sections">
    <section id="how-it-works" className="landing-section landing-unified-section unified-workflow" aria-labelledby="workflow-title"><div className="landing-container">
      <SectionHeading id="workflow-title" title={c.workflow} body={c.workflowBody}/>
      <div className="unified-workflow-layout"><div className="unified-workflow-guide"><span className="unified-workflow-track" aria-hidden="true"/><ol className="unified-workflow-steps">{t.steps.map((step,index)=>{const Icon=[Mic,Send,MessageCircle][index];return <li key={step.title}><span className="unified-step-marker" aria-hidden="true"><Icon size={20}/></span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>;})}</ol></div><div className="unified-demo"><LandingDemo locale={locale}/></div></div>
    </div></section>

    <LandingLanguages locale={locale}/>

    <section id="companies" className="landing-section landing-unified-section unified-companies" aria-labelledby="companies-title"><div className="landing-container">
      <SectionHeading id="companies-title" title={c.companies} body={c.companiesBody}/>
      <div className="unified-company-layout" id="company-controls"><ol className="unified-company-points">{c.companyPoints.map((point,index)=><li key={point.title}><span aria-hidden="true">0{index+1}</span><div><h3>{point.title}</h3><p>{point.body}</p></div></li>)}</ol><div className="unified-company-preview"><CompanyPreview locale={locale}/></div></div>
      <div className="unified-company-industries"><p>{c.industries}</p><ul className="unified-industry-list">{t.industries.map(item=><li key={item.name}>{item.name}</li>)}</ul></div>
    </div></section>

    <LandingPlans locale={locale} registrationAvailable={registrationAvailable}/>
    <LandingContact locale={locale}/>
  </div>;
}
