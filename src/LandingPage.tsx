import {useEffect,useRef} from 'react';
import {Globe2,KeyRound,MessageCircle,Mic} from 'lucide-react';
import {ScrollTrigger} from './gsap-scroll';
import {landingCopy,type LandingLocale} from './landing-content';
import {LandingHero} from './LandingHero';
import {HeroJourney} from './HeroJourney';
import {LandingPlatform} from './LandingPlatform';
import {LandingSections} from './LandingSections';
import {publicLandingTarget} from './public-navigation';

export function LandingPage({view,locale,registrationAvailable}:{view:string;locale:LandingLocale;registrationAvailable:boolean}){
  const t=landingCopy[locale],root=useRef<HTMLDivElement>(null);
  const motionPaused=false;
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{
      ScrollTrigger.refresh();
      const target=publicLandingTarget(view),section=root.current?.querySelector<HTMLElement>(`#${target}`);
      if(target==='landing-top')window.scrollTo({top:0,behavior:'instant'});
      else if(section)section.scrollIntoView({behavior:'instant',block:'start'});
    });
    return()=>cancelAnimationFrame(frame);
  },[view]);

  useEffect(()=>{const frame=requestAnimationFrame(()=>ScrollTrigger.refresh());return()=>cancelAnimationFrame(frame);},[locale]);

  return <div className="landing-page" ref={root}>
    <LandingHero locale={locale} registrationAvailable={registrationAvailable} motionPaused={motionPaused}/>
    <HeroJourney locale={locale} motionPaused={motionPaused}/>
    <div className="landing-capability-strip"><div className="landing-container">{t.strip.map((text,index)=>{const Icon=[Mic,KeyRound,Globe2,MessageCircle][index];return <span key={text}><Icon size={19} aria-hidden="true"/>{text}</span>;})}</div></div>

    <LandingPlatform locale={locale}/>

    <LandingSections locale={locale} registrationAvailable={registrationAvailable}/>
  </div>;
}
