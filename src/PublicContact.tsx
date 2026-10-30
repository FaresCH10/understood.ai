import {useEffect,useRef} from 'react';
import {ArrowLeft,ArrowRight,Mail,ArrowUpRight} from 'lucide-react';
import {gsap,useGSAP} from './gsap-scroll';
import type {LandingLocale} from './landing-content';
import './public-contact.css';

// Public contact address. Change it here when the company mailbox is ready.
export const CONTACT_EMAIL='fareschrayteh1@gmail.com';
const copy={
  en:{sectionTitle:'Let’s talk about your team.',sectionBody:'Questions about Understood, your team’s languages, or getting started? Get in touch.',contact:'Contact us',back:'Back to Understood',title:'A conversation starts here.',body:'Tell us about your team, your sites, and what you want to make clearer. Or simply ask us a question.',email:'Email us',note:'Opens your email app. You can also copy the address below.',address:'Our email address',prompt:'A helpful starting point',details:'Include your company name, team size, and the languages your workers use. It helps us understand what you need.',subject:'Understood inquiry'},
  ar:{sectionTitle:'لنتحدث عن فريقك.',sectionBody:'هل لديك أسئلة عن Understood أو لغات فريقك أو كيفية البدء؟ تواصل معنا.',contact:'تواصل معنا',back:'العودة إلى Understood',title:'تبدأ المحادثة من هنا.',body:'أخبرنا عن فريقك ومواقع عملك وما ترغب في توضيحه، أو اطرح علينا سؤالك.',email:'راسلنا عبر البريد',note:'يفتح تطبيق البريد الإلكتروني. يمكنك أيضاً نسخ العنوان أدناه.',address:'بريدنا الإلكتروني',prompt:'نقطة بداية مفيدة',details:'اذكر اسم شركتك وعدد أفراد فريقك واللغات التي يستخدمها العمال لمساعدتنا على فهم احتياجاتك.',subject:'استفسار عن Understood'},
};

export function LandingContact({locale}:{locale:LandingLocale}){
  const root=useRef<HTMLElement>(null),t=copy[locale];
  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      gsap.from('.landing-contact-inner > *',{y:18,opacity:0,stagger:.12,duration:.55,ease:'power2.out',scrollTrigger:{trigger:root.current,start:'top 85%',once:true}});
    });
    return()=>media.revert();
  },{scope:root,dependencies:[locale],revertOnUpdate:true});
  return <section ref={root} className="landing-contact" aria-labelledby="landing-contact-title"><div className="landing-container landing-contact-inner"><div><h2 id="landing-contact-title">{t.sectionTitle}</h2><p>{t.sectionBody}</p></div><a className="landing-button landing-button--light" href="#contact">{t.contact}<ArrowRight size={18} className="landing-forward" aria-hidden="true"/></a></div></section>;
}

export function ContactPage({locale}:{locale:LandingLocale}){
  const root=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null),t=copy[locale];
  useEffect(()=>{window.scrollTo({top:0,behavior:'instant'});heading.current?.focus({preventScroll:true});},[]);
  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      gsap.from('.contact-intro > *, .contact-email-panel, .contact-context',{y:18,opacity:0,stagger:.1,duration:.5,ease:'power2.out'});
    });
    return()=>media.revert();
  },{scope:root,dependencies:[locale],revertOnUpdate:true});
  const mailto=`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t.subject)}`;
  return <div ref={root} className="contact-page landing-container">
    <a className="landing-text-link contact-back" href="#home"><ArrowLeft size={17} className="landing-forward" aria-hidden="true"/>{t.back}</a>
    <header className="contact-intro"><h1 ref={heading} tabIndex={-1}>{t.title}</h1><p>{t.body}</p></header>
    <div className="contact-layout"><section className="contact-email-panel" aria-labelledby="contact-email-title"><Mail size={28} aria-hidden="true"/><h2 id="contact-email-title">{t.email}</h2><p>{t.note}</p><a className="contact-address" href={mailto} aria-label={`${t.address}: ${CONTACT_EMAIL}`}><bdi>{CONTACT_EMAIL}</bdi></a><a className="landing-button landing-button--primary" href={mailto}>{t.email}<ArrowUpRight size={18} aria-hidden="true"/></a></section><aside className="contact-context"><h2>{t.prompt}</h2><p>{t.details}</p></aside></div>
  </div>;
}
