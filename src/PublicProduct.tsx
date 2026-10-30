import {useState} from 'react';
import {ArrowLeft,AudioLines} from 'lucide-react';
import {PUBLIC_SECTIONS} from './public-navigation';
import {landingCopy,type LandingLocale} from './landing-content';
import {LandingPage} from './LandingPage';
import {LandingDemo} from './LandingDemo';
import {PublicHeader} from './PublicHeader';
import {PilotForm} from './PublicPilot';
import {ContactPage} from './PublicContact';
import './public-product.css';
import './landing-page.css';

const localeKey='understood:public-language';
function savedLocale():LandingLocale{try{return sessionStorage.getItem(localeKey)==='ar'?'ar':'en';}catch{return 'en';}}
export default function PublicProduct({view,registrationAvailable=false}:{view:string;registrationAvailable?:boolean}){
  const [locale,setLocale]=useState<LandingLocale>(savedLocale),t=landingCopy[locale];
  function changeLocale(value:LandingLocale){setLocale(value);try{sessionStorage.setItem(localeKey,value);}catch{}}
  return <div className="public-product marketing-site" id="home" lang={locale} dir={locale==='ar'?'rtl':'ltr'}>
    <a className="public-skip" href="#public-main" onClick={event=>{event.preventDefault();document.getElementById('public-main')?.focus();}}>{t.skip}</a>
    <PublicHeader locale={locale} onLocale={changeLocale} view={view} registrationAvailable={registrationAvailable}/>
    <main id="public-main" tabIndex={-1}>
      {view==='contact'?<ContactPage locale={locale}/>:view==='pilot'?<div className="public-legacy-page" lang="en" dir="ltr"><PilotForm/></div>:view==='walkthrough'?<div className="landing-standalone-demo landing-container"><a className="landing-text-link" href="#home"><ArrowLeft size={17} aria-hidden="true"/>Understood</a><header className="landing-section-heading"><h1>{t.workflowTitle}</h1><p>{t.workflowBody}</p></header><LandingDemo locale={locale}/></div>:<LandingPage key={locale} view={view} locale={locale} registrationAvailable={registrationAvailable}/>}
    </main>
    <footer className="landing-footer"><div className="landing-container"><div className="landing-footer-top"><div><a className="landing-brand" href="#home">Understood<AudioLines size={25} aria-hidden="true"/></a><p>{t.footer}</p></div><nav aria-label={locale==='ar'?'روابط التذييل':'Footer navigation'}>{PUBLIC_SECTIONS.map(section=><a key={section.id} href={`#${section.id}`}>{section[locale]}</a>)}</nav></div><div className="landing-footer-bottom"><p>{t.footerNote}</p><div><a href="#contact">{locale==='ar'?'تواصل معنا':'Contact us'}</a><a href="#pilot">{t.contact}</a><a href="#sign-in">{t.signIn}</a></div></div></div></footer>
  </div>;
}
