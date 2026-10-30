import {useEffect,useRef,useState,type MouseEvent} from 'react';
import {AudioLines,ArrowRight,Globe2,Menu,X} from 'lucide-react';
import {PUBLIC_SECTIONS,publicLandingTarget} from './public-navigation';
import {landingCopy,type LandingLocale} from './landing-content';

export function PublicHeader({locale,onLocale,view,registrationAvailable}:{locale:LandingLocale;onLocale:(value:LandingLocale)=>void;view:string;registrationAvailable:boolean}){
  const t=landingCopy[locale],header=useRef<HTMLElement>(null),menuButton=useRef<HTMLButtonElement>(null);
  const [menuOpen,setMenuOpen]=useState(false);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!header.current?.contains(event.target)){setMenuOpen(false);header.current?.querySelectorAll('details[open]').forEach(element=>element.removeAttribute('open'));}};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[]);
  function closeNavigation(event:MouseEvent<HTMLAnchorElement>){
    if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    setMenuOpen(false);header.current?.querySelectorAll('details[open]').forEach(element=>element.removeAttribute('open'));
    if(event.currentTarget.hash===location.hash){const target=publicLandingTarget(location.hash.slice(1));if(target==='landing-top')window.scrollTo({top:0,behavior:'instant'});else document.getElementById(target)?.scrollIntoView({behavior:'instant',block:'start'});}
  }
  return <header className="landing-site-header" ref={header} onKeyDown={event=>{if(event.key==='Escape'){const disclosure=(event.target as HTMLElement).closest('details');setMenuOpen(false);header.current?.querySelectorAll('details[open]').forEach(element=>element.removeAttribute('open'));if(menuOpen)menuButton.current?.focus();else disclosure?.querySelector('summary')?.focus();}}}>
    <div className="landing-nav-inner landing-container"><a href="#home" className="landing-brand" aria-label={t.home}>Understood<AudioLines size={25} aria-hidden="true"/></a>
      <nav className={`landing-nav ${menuOpen?'is-open':''}`} id="landing-navigation" aria-label={t.navigation}>{PUBLIC_SECTIONS.map(section=><a key={section.id} href={`#${section.id}`} aria-current={publicLandingTarget(view)===section.id?'location':undefined} onClick={closeNavigation}>{section[locale]}</a>)}<a className="landing-mobile-signin" href="#sign-in" onClick={closeNavigation}>{t.signIn}</a></nav>
      <div className="landing-nav-actions"><label className="landing-site-language"><Globe2 size={17} aria-hidden="true"/><span className="visually-hidden">{locale==='ar'?'لغة الصفحة':'Page language'}</span><select aria-label={locale==='ar'?'لغة الصفحة':'Page language'} value={locale} onChange={event=>onLocale(event.target.value as LandingLocale)}><option value="en" lang="en">EN</option><option value="ar" lang="ar">العربية</option></select></label><a href="#sign-in" className="landing-nav-signin">{t.signIn}</a><a className="landing-button landing-button--primary landing-nav-trial" href={registrationAvailable?'#register':'#pilot'}>{registrationAvailable?t.trialCta:t.pilotCta}<ArrowRight size={16} className="landing-forward" aria-hidden="true"/></a><button className="landing-menu-button" type="button" ref={menuButton} aria-expanded={menuOpen} aria-controls="landing-navigation" aria-label={menuOpen?t.close:t.menu} onClick={()=>setMenuOpen(value=>!value)}>{menuOpen?<X size={22}/>:<Menu size={22}/>}</button></div>
    </div>
  </header>;
}
