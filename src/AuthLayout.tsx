import {useRef,type ReactNode} from 'react';
import {AudioLines,Globe2,Smartphone,Zap} from 'lucide-react';
import {gsap,useGSAP} from './gsap';
import './auth-layout.css';

type AuthLayoutProps={children:ReactNode;variant?:'sign-in'|'register'|'worker';note?:ReactNode};

/** A shared visual shell. Authentication and registration stay in their own forms. */
export function AuthLayout({children,variant='sign-in',note}:AuthLayoutProps){
  const root=useRef<HTMLElement>(null),story=useRef<HTMLDivElement>(null);
  const animations=useRef<gsap.core.Animation[]>([]);
  const entranceAnimation=useRef<gsap.core.Timeline|null>(null);
  const playback=useRef({visible:true});

  function syncPlayback(){
    const stop=!playback.current.visible||document.hidden;
    // Finish the entrance when a visitor skips past the scene to the form.
    if(stop)entranceAnimation.current?.progress(1);
    for(const animation of animations.current)animation.paused(stop);
  }

  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      const entrance=gsap.timeline({defaults:{ease:'power2.out',duration:.65}})
        .from('.auth-background',{opacity:0,duration:1.2},0)
        .from('.auth-copy > *',{y:18,opacity:0,stagger:.09},.08)
        .from('.auth-person',{y:42,opacity:0,duration:1.05},.12)
        .from('.auth-card',{y:16,opacity:0,duration:.7},.18)
        .from('.auth-callout',{y:20,scale:.96,opacity:0,stagger:.16,duration:.6},.5);
      const background=gsap.to('.auth-background-drift',{x:12,y:-6,scale:1.025,duration:14,ease:'sine.inOut',repeat:-1,yoyo:true});
      const person=gsap.to('.auth-person-drift',{y:-7,rotation:.18,duration:5.5,ease:'sine.inOut',repeat:-1,yoyo:true,delay:1.2});
      const cards=gsap.utils.toArray<HTMLElement>('.auth-callout-float',root.current).map((element,index)=>
        gsap.to(element,{y:index===1?7:-6,duration:3.7+index*.6,delay:1.4+index*.2,ease:'sine.inOut',repeat:-1,yoyo:true}));
      entranceAnimation.current=entrance;
      animations.current=[background,person,...cards];
      syncPlayback();
      const observer=new IntersectionObserver(([entry])=>{playback.current.visible=entry.isIntersecting;syncPlayback();});
      if(story.current)observer.observe(story.current);
      document.addEventListener('visibilitychange',syncPlayback);
      return()=>{observer.disconnect();document.removeEventListener('visibilitychange',syncPlayback);animations.current=[];entranceAnimation.current=null;};
    });
    return()=>media.revert();
  },{scope:root});

  return <main className={`auth-shell auth-shell--${variant}`} ref={root}>
    <a className="skip-link" href="#auth-form">Skip to {variant==='register'?'registration':'sign in'}</a>
    <div className="auth-scenery" aria-hidden="true">
      <div className="auth-background-drift"><img className="auth-background" src="/auth/gulf-workplace.jpg" alt="" width="1600" height="900" fetchPriority="high"/></div>
      <div className="auth-background-wash"/>
    </div>
    <div className="auth-story" ref={story}>
      <a className="auth-brand" href="#home" aria-label="Understood home">Understood<AudioLines size={25} strokeWidth={2}/></a>
      <div className="auth-copy">
        <p className="auth-eyebrow">Built for the Arabian Gulf</p>
        <p className="auth-headline">Frontline teams<br/>keep things moving.<span>Clear instructions.<br/>Stronger operations.</span></p>
        <p className="auth-description">Bring every person into the conversation. Share instructions, listen in your own language, and start the day on the same page.</p>
      </div>
      <div className="auth-person-drift" aria-hidden="true"><img className="auth-person" src="/auth/worker-tablet.png" alt="" width="1300" height="1209" fetchPriority="high"/></div>
      <ul className="auth-callouts" aria-label="Made for your team">
        <li className="auth-callout-slot auth-callout-slot--device"><div className="auth-callout-float"><div className="auth-callout"><Smartphone size={29}/><div><strong>Works on shared devices</strong><span lang="ar" dir="rtl">يعمل على الأجهزة المشتركة</span></div></div></div></li>
        <li className="auth-callout-slot auth-callout-slot--languages"><div className="auth-callout-float"><div className="auth-callout"><Globe2 size={30}/><div><strong>Arabic and English</strong><span lang="ar" dir="rtl">بالعربية والإنجليزية</span></div></div></div></li>
        <li className="auth-callout-slot auth-callout-slot--setup"><div className="auth-callout-float"><div className="auth-callout"><Zap size={31}/><div><strong>Fast first-time setup</strong><span lang="ar" dir="rtl">إعداد سريع للمرة الأولى</span></div></div></div></li>
      </ul>
      <div className="auth-story-footer"><span>One team. Every language.</span></div>
    </div>
    <div className="auth-form-column"><section className="auth-card" id="auth-form" tabIndex={-1} aria-label={variant==='register'?'Create your workspace':variant==='worker'?'Worker sign in':'Supervisor sign in'}>{children}</section><p className="auth-card-footnote">{note??<>Clear communication starts here.<span lang="ar" dir="rtl">التواصل الواضح يبدأ هنا.</span></>}</p></div>
  </main>;
}
