import {useRef} from 'react';
import {ArrowRight,Volume2} from 'lucide-react';
import {gsap,useGSAP,ScrollTrigger} from './gsap-scroll';
import type {LandingLocale} from './landing-content';
import './hero-journey.css';

const scenes=[
  {id:'retail',width:1122,height:1402,en:{sector:'Retail & warehousing',title:'Keep every handover clear.',body:'Share stockroom and shift instructions in the languages your team uses.'},ar:{sector:'التجزئة والمستودعات',title:'تسليم واضح بين الورديات.',body:'شارك تعليمات المستودع والوردية باللغات التي يستخدمها فريقك.'},messages:[{language:'ur',label:'Urdu',direction:'rtl',text:'براہ کرم سامان کی گنتی کریں اور نظام میں تصدیق کریں۔'},{language:'en',label:'English',direction:'ltr',text:'Please count the items and confirm in the system.'}]},
  {id:'site',width:1375,height:1144,en:{sector:'Site operations',title:'One update, across the site.',body:'Give the right people a shared instruction. Keep responses and follow-up together.'},ar:{sector:'عمليات الموقع',title:'تحديث واحد لأفراد الموقع.',body:'أرسل التعليمات المشتركة إلى الأشخاص المعنيين، واجمع الردود والمتابعة في مكان واحد.'},messages:[{language:'ar',label:'Arabic',direction:'rtl',text:'يرجى الحفاظ على النظافة واتباع إجراءات السلامة في الموقع.'}]},
  {id:'hospitality',width:1355,height:1160,en:{sector:'Hospitality',title:'A clearer start to every shift.',body:'Send room preparation and service briefings to the crew who needs them.'},ar:{sector:'الضيافة',title:'بداية أوضح لكل وردية.',body:'أرسل تعليمات تجهيز الغرف وإحاطات الخدمة إلى الطاقم المعني.'},messages:[{language:'id',label:'Indonesian',direction:'ltr',text:'Mohon bersihkan kamar dan laporkan setelah selesai.'}]},
  {id:'food',width:1122,height:1402,en:{sector:'Food service',title:'Make the next instruction clear.',body:'Share preparation and hygiene briefings, then review your team’s responses.'},ar:{sector:'الخدمات الغذائية',title:'تعليمات واضحة للخطوة التالية.',body:'شارك إحاطات التحضير والنظافة، ثم راجع ردود فريقك.'},messages:[{language:'ru',label:'Russian',direction:'ltr',text:'Пожалуйста, соблюдайте санитарные правила и используйте СИЗ.'},{language:'en',label:'English',direction:'ltr',text:'Please follow hygiene rules and use PPE.'}]},
] as const;
const languageNames={Urdu:'الأردية',English:'الإنجليزية',Arabic:'العربية',Indonesian:'الإندونيسية',Russian:'الروسية'};

export function HeroJourney({locale,motionPaused}:{locale:LandingLocale;motionPaused:boolean}){
  const root=useRef<HTMLElement>(null),svg=useRef<SVGSVGElement>(null),track=useRef<SVGPathElement>(null),trace=useRef<SVGPathElement>(null),signal=useRef<SVGCircleElement>(null);
  useGSAP(()=>{
    const section=root.current!,path=trace.current!,dot=signal.current!,progress={value:1};
    let length=0,frame=0,disposed=false;
    const draw=()=>{
      path.style.strokeDashoffset=String(1-progress.value);
      if(length){const point=path.getPointAtLength(length*progress.value);dot.setAttribute('transform',`translate(${point.x} ${point.y})`);}
    };
    const measure=()=>{
      const bounds=section.getBoundingClientRect(),width=section.clientWidth,height=section.offsetHeight;
      const points=[...section.querySelectorAll<HTMLElement>('.journey-artwork')].map(element=>{const box=element.getBoundingClientRect();return {x:box.left-bounds.left+box.width*.5,y:box.top-bounds.top+box.height*.55,top:box.top-bounds.top,bottom:box.bottom-bounds.top};});
      const start={x:width*(locale==='ar'?.2:.8),y:0},end={x:width*.5,y:height};
      let d='';
      if(width<=800){
        const edge=width-10;d=`M ${edge} 0`;
        for(const point of points){d+=` L ${edge} ${point.top-24} C ${edge} ${point.top+45}, ${point.x} ${point.top+25}, ${point.x} ${point.y} C ${point.x} ${point.bottom+20}, ${edge} ${point.bottom+20}, ${edge} ${point.bottom+48}`;}
        d+=` L ${edge} ${height}`;
      }else{
        let previous=start;d=`M ${start.x} 0`;
        for(const point of [...points,end]){const bend=(point.y-previous.y)*.78;d+=` C ${previous.x} ${previous.y+bend}, ${point.x} ${point.y-bend}, ${point.x} ${point.y}`;previous=point;}
      }
      svg.current!.setAttribute('viewBox',`0 0 ${width} ${height}`);track.current!.setAttribute('d',d);path.setAttribute('d',d);length=path.getTotalLength();draw();
    };
    measure();
    const media=gsap.matchMedia();
    if(!motionPaused)media.add('(prefers-reduced-motion: no-preference)',()=>{
      gsap.fromTo(progress,{value:0},{value:1,ease:'none',onUpdate:draw,scrollTrigger:{id:'hero-journey-line',trigger:section,start:'top 70%',end:'bottom 70%',scrub:.65}});
      gsap.from('.journey-introduction>*',{y:20,autoAlpha:0,stagger:.1,duration:.65,ease:'power2.out',scrollTrigger:{trigger:'.journey-introduction',start:'top 85%',once:true}});
      gsap.utils.toArray<HTMLElement>('.journey-scene',section).forEach((scene,index)=>{
        const select=gsap.utils.selector(scene),direction=index%2===0?-1:1;
        gsap.timeline({scrollTrigger:{id:`hero-journey-${scenes[index].id}`,trigger:scene,start:'top 72%',once:true},defaults:{ease:'power3.out'}})
          .from(select('.journey-copy'),{x:-direction*25,y:10,autoAlpha:0,duration:.65},0)
          .from(select('.journey-place'),{scale:1.035,autoAlpha:0,duration:.85},0)
          .from(select('.journey-person-entrance'),{x:direction*80,y:15,autoAlpha:0,duration:.9},.12)
          .from(select('.journey-message'),{y:18,scale:.92,autoAlpha:0,stagger:.16,duration:.5,ease:'back.out(1.3)'},1.06)
          .from(select('figcaption'),{autoAlpha:0,duration:.3},1.35);
      });
      return()=>{progress.value=1;draw();};
    });
    const refresh=()=>{if(disposed)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!disposed){measure();ScrollTrigger.refresh();}});};
    const observer=new ResizeObserver(refresh);observer.observe(section);
    const images=[...section.querySelectorAll('img')];images.forEach(image=>image.addEventListener('load',refresh));
    ScrollTrigger.addEventListener('refreshInit',measure);void document.fonts.ready.then(refresh);
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();images.forEach(image=>image.removeEventListener('load',refresh));ScrollTrigger.removeEventListener('refreshInit',measure);media.revert();};
  },{scope:root,dependencies:[locale,motionPaused],revertOnUpdate:true});

  return <section ref={root} className={`hero-journey ${motionPaused?'is-static':''}`} aria-labelledby="journey-title" data-testid="hero-journey">
    <svg ref={svg} className="journey-connection" aria-hidden="true" focusable="false" preserveAspectRatio="none"><path ref={track} className="journey-line-track"/><path ref={trace} className="journey-line-progress" pathLength="1"/><circle ref={signal} className="journey-signal" r="6"/></svg>
    <div className="landing-container journey-introduction"><h2 id="journey-title">{locale==='ar'?<>فرق مختلفة.<br/><span>وضوح مشترك.</span></>:<>Different teams.<br/><span>The same clarity.</span></>}</h2><p>{locale==='ar'?'من المستودع إلى الوردية التالية، تصل التعليمات باللغات التي يستخدمها فريقك.':'From the stockroom to the next shift, an instruction travels in the languages your team uses.'}</p></div>
    <ol className="journey-scenes landing-container">{scenes.map((scene,index)=>{const copy=scene[locale];return <li className={`journey-scene journey-scene--${scene.id}`} id={`journey-${scene.id}`} key={scene.id} data-side={index%2===0?'left':'right'}>
      <div className="journey-copy"><span className="journey-sector">{copy.sector}</span><h3>{copy.title}</h3><p>{copy.body}</p></div>
      <figure className="journey-visual"><div className="journey-artwork"><div className="journey-photo-window"><img className="journey-place" src={`/landing/journey/${scene.id}-place.jpg`} alt="" width="1600" height="1000" loading="lazy"/></div><div className="journey-person-window"><div className="journey-person-entrance"><img className="journey-person" src={`/landing/journey/${scene.id}.png`} alt="" width={scene.width} height={scene.height} loading="lazy"/></div></div></div>
        <div className="journey-messages">{scene.messages.map(message=><div className="journey-message" key={message.language}><span className="journey-language">{locale==='ar'?languageNames[message.label]:message.label}</span><div><p lang={message.language} dir={message.direction}>{message.text}</p><Volume2 size={21} aria-hidden="true"/></div></div>)}</div>
        <figcaption>{locale==='ar'?'تعليمات توضيحية':'Illustrative instruction'}</figcaption>
      </figure>
    </li>;})}</ol>
    <div className="journey-end landing-container"><p>{locale==='ar'?'فريق واحد. وتعليمات مشتركة.':'One team. A shared instruction.'}</p><a className="landing-text-link" href="#how-it-works">{locale==='ar'?'جرّب المثال':'Try the example'}<ArrowRight size={17} className="landing-forward" aria-hidden="true"/></a></div>
  </section>;
}
