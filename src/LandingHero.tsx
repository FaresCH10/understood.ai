import {useRef} from 'react';
import {ArrowRight,Check,Play,Volume2} from 'lucide-react';
import {gsap,useGSAP,ScrollTrigger} from './gsap-scroll';
import {landingCopy,type LandingLocale} from './landing-content';
import './landing-hero.css';

const hindiInstruction='तैयार सामान नीले शेल्फ़ पर रखें। रास्ता खाली रखें।';

export function LandingHero({locale,registrationAvailable,motionPaused}:{locale:LandingLocale;registrationAvailable:boolean;motionPaused:boolean}){
  const t=landingCopy[locale],root=useRef<HTMLElement>(null);
  const messages=[{language:'hi',label:locale==='ar'?'الهندية':'Hindi',text:hindiInstruction},{language:'en',label:locale==='ar'?'الإنجليزية':'English',text:t.heroOriginal}];

  useGSAP(()=>{
    if(motionPaused)return;
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      gsap.timeline({id:'understood-hero-copy',defaults:{ease:'power3.out'}})
        .from('.hero-intro-kicker',{y:10,autoAlpha:0,duration:.45},.08)
        .from('.hero-heading-line>span',{yPercent:110,rotation:1.5,stagger:.1,duration:.75},.13)
        .from('.hero-intro-description',{y:14,autoAlpha:0,duration:.55},.55)
        .from('.hero-intro-actions>a',{y:18,autoAlpha:0,stagger:.1,duration:.5},.72)
        .from('.hero-intro-assurances>li',{y:8,autoAlpha:0,stagger:.07,duration:.4},1.02);
      const scene=gsap.timeline({id:'understood-hero-scene',paused:true,defaults:{ease:'power3.out'}})
        .from('.hero-intro-background img',{opacity:0,scale:1.035,duration:1.15},0)
        .from('.hero-worker-slide',{x:135,autoAlpha:0,duration:1},.2)
        .addLabel('worker-arrived',1.2)
        .from('.hero-message',{y:18,x:-8,scale:.9,autoAlpha:0,transformOrigin:'85% 100%',stagger:.18,duration:.5,ease:'back.out(1.35)'},'worker-arrived+=.08')
        .from('.hero-intro-scene>figcaption',{autoAlpha:0,duration:.35},1.85);
      const worker=root.current!.querySelector<HTMLImageElement>('.hero-intro-worker')!,showScene=()=>{scene.play();};
      if(worker.complete)showScene();else{worker.addEventListener('load',showScene,{once:true});worker.addEventListener('error',showScene,{once:true});}
      gsap.to('.hero-worker-parallax',{y:-18,ease:'none',scrollTrigger:{id:'landing-hero-parallax',trigger:root.current,start:'top top',end:'bottom top',scrub:1}});
      const refresh=()=>ScrollTrigger.refresh();
      const images=[...root.current!.querySelectorAll('img')];images.forEach(image=>image.addEventListener('load',refresh));
      return()=>{images.forEach(image=>image.removeEventListener('load',refresh));worker.removeEventListener('load',showScene);worker.removeEventListener('error',showScene);};
    });
    return()=>media.revert();
  },{scope:root,dependencies:[locale,motionPaused],revertOnUpdate:true});

  return <section className="hero-intro" id="landing-top" ref={root} aria-labelledby="landing-title">
    <div className="hero-intro-background" aria-hidden="true"><img src="/landing/gulf-site.jpg" width="1122" height="1402" alt="" fetchPriority="high"/></div>
    <div className="hero-intro-inner landing-container">
      <div className="hero-intro-copy">
        <p className="hero-intro-kicker">{t.heroKicker}</p>
        <h1 id="landing-title">{[t.heroTitle,t.heroMiddle,t.heroAccent].map(line=><span className="hero-heading-line" key={line}><span>{line}</span></span>)}</h1>
        <p className="hero-intro-description">{t.heroBody}</p>
        <div className="hero-intro-actions"><a className="landing-button landing-button--primary" href={registrationAvailable?'#register':'#pilot'}>{registrationAvailable?t.trialCta:t.pilotCta}<ArrowRight size={18} className="landing-forward" aria-hidden="true"/></a><a className="landing-button landing-button--outline" href="#how-it-works"><Play size={16} aria-hidden="true"/>{t.demoCta}</a></div>
        <ul className="hero-intro-assurances">{[registrationAvailable?t.heroNoCard:t.strip[0],t.heroWorkerAccess,t.heroSharedDevices].map(text=><li key={text}><Check size={15} aria-hidden="true"/>{text}</li>)}</ul>
      </div>
      <figure className="hero-intro-scene">
        <div className="hero-worker-parallax"><div className="hero-worker-slide"><img className="hero-intro-worker" src="/landing/site-worker.png" alt="" width="1122" height="1402" fetchPriority="high"/></div></div>
        <div className="hero-messages">{messages.map(message=><div className="hero-message" key={message.language}><span className="hero-message-language">{message.label}</span><div className="hero-message-content"><p lang={message.language} dir="ltr">{message.text}</p><Volume2 className="hero-message-speaker" size={23} aria-hidden="true"/></div></div>)}</div>
        <figcaption>{t.heroCaption}</figcaption>
      </figure>
    </div>
  </section>;
}
