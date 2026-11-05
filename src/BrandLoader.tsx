import {useId,useRef,useState} from 'react';
import {MorphSVGPlugin} from 'gsap/MorphSVGPlugin';
import {gsap,useGSAP} from './gsap';
import {brandMark,BRAND_CYCLE_SECONDS} from './brand-mark';
import './brand-loader.css';
import './page-loading.css';

gsap.registerPlugin(MorphSVGPlugin);

export type BrandLoaderProps={
  label?:string;
  theme?:'light'|'dark';
  compact?:boolean;
  paused?:boolean;
  progress?:number|null;
  replay?:number;
  reducedMotion?:boolean;
  showMotionControl?:boolean;
  language?:string;
  onComplete?:()=>void;
};

/** With onComplete, play once and hold the finished logo while the page prepares. */
export function BrandLoader({label='Loading Understood…',theme='light',compact=false,paused=false,progress=null,replay=0,reducedMotion=false,showMotionControl=false,language='en',onComplete}:BrandLoaderProps){
  const scope=useRef<HTMLDivElement>(null),timeline=useRef<gsap.core.Timeline|null>(null);
  const completion=useRef(onComplete),completed=useRef(false);completion.current=onComplete;
  const [locallyPaused,setLocallyPaused]=useState(false);
  const motion=useRef({paused,locallyPaused,progress});motion.current={paused,locallyPaused,progress};
  const id=`brand-${useId().replace(/[^a-zA-Z0-9_-]/g,'')}`;
  const ref=(name:string)=>`${id}-${name}`;
  const url=(name:string)=>`url(#${ref(name)})`;

  useGSAP(()=>{
    const root=scope.current;if(!root)return;
    completed.current=false;
    const notifyComplete=()=>{if(completed.current)return;completed.current=true;completion.current?.();};
    const media=gsap.matchMedia();
    media.add({motion:'(prefers-reduced-motion: no-preference)',reduce:'(prefers-reduced-motion: reduce)'},context=>{
      const select=gsap.utils.selector(root),ribbon=select('.brand-ribbon'),paths=select('.brand-silhouette'),folds=select('.brand-fold'),bars=select('.brand-bar');
      const thread=select('.brand-thread'),shine=select('.brand-shine'),aura=select('.brand-aura'),shadow=select('.brand-shadow');
      if(context.conditions?.reduce||reducedMotion||completed.current&&completion.current){
        // Explicitly restore every layer after a mid-cycle preference change.
        // Reverting a timeline's from/to tweens can otherwise leave its fold
        // layers at their hidden starting values.
        timeline.current=null;
        [...ribbon,...folds,...bars,...aura,...shadow,...thread,...shine].forEach(node=>{node.removeAttribute('style');node.removeAttribute('transform');});
        paths.forEach(node=>node.setAttribute('d',brandMark.silhouette));
        bars.forEach((node,index)=>{const bar=brandMark.bars[index];for(const name of ['x','y','width','height','rx'] as const)node.setAttribute(name,String(bar[name]));});
        shine.forEach(node=>{node.setAttribute('opacity','0');node.setAttribute('transform','rotate(-26 183 117)');});
        thread.forEach(node=>node.setAttribute('opacity','0'));
        notifyComplete();
        return;
      }
      const phase=motion.current;
      const sequence=gsap.timeline({repeat:-1,paused:phase.paused||phase.locallyPaused||document.hidden||phase.progress!==null,defaults:{ease:'power3.inOut'}});
      timeline.current=sequence;
      sequence
        .set(ribbon,{opacity:0,x:-62,y:8,rotation:-12,scale:.86,svgOrigin:'183 117'})
        .set(paths,{morphSVG:{shape:brandMark.ribbon,shapeIndex:0}})
        .set(folds,{opacity:0})
        .set(bars,{opacity:0})
        .set(thread,{opacity:0,strokeDasharray:620,strokeDashoffset:620})
        .set(shine,{x:-410,opacity:0})
        .set(shadow,{scaleX:.45,opacity:0,transformOrigin:'50% 50%'})
        .set(aura,{scale:.7,opacity:0,transformOrigin:'50% 50%'})
        .to(thread,{opacity:.72,strokeDashoffset:0,duration:.85,ease:'power2.out'},.06)
        .to(thread,{opacity:0,duration:.3},.65)
        .to(ribbon,{opacity:1,x:0,y:0,scale:1,rotation:4,duration:1.05,ease:'power3.out'},.28)
        .to(paths,{morphSVG:{shape:brandMark.curling,shapeIndex:0},duration:1.15,ease:'power2.inOut'},.55)
        .to(paths,{morphSVG:{shape:brandMark.silhouette,shapeIndex:0},duration:.95,ease:'power3.inOut'},1.48)
        .to(ribbon,{rotation:0,duration:.95,ease:'power2.out'},1.48)
        .to(folds,{opacity:1,duration:.8,ease:'sine.inOut',stagger:.12},1.65)
        .to(aura,{opacity:1,scale:1,duration:1.5,ease:'sine.out'},1.2)
        .to(shadow,{opacity:1,scaleX:1,duration:1.4},1.1)
        .to(shine,{x:410,opacity:.75,duration:1.25,ease:'sine.inOut'},3.05)
        .to(shine,{opacity:0,duration:.25},4.1)
        .to(ribbon,{y:-2,duration:.8,ease:'sine.inOut'},3.55)
        .to(ribbon,{y:0,duration:.8,ease:'sine.inOut'},4.35)
        .to([ribbon,...bars],{opacity:0,duration:.38,ease:'sine.in'},5.25)
        .to([aura,shadow],{opacity:0,duration:.45},5.3)
        .set({}, {},BRAND_CYCLE_SECONDS);
      // Animate the bar geometry directly: SVG transform-origin compensation can
      // otherwise shift these six-pixel gaps when replaying or seeking a timeline.
      brandMark.bars.forEach((bar,index)=>{
        const at=[2.55,2.68,2.88,3.01][index];
        sequence.fromTo(bars[index],{opacity:0,attr:{x:bar.x+(bar.side==='left'?18:-18)+6,y:bar.y+bar.height/2-2,width:16,height:4,rx:8}},
          {opacity:1,attr:{x:bar.x,y:bar.y,width:bar.width,height:bar.height,rx:bar.rx},duration:index<2?.62:.55,ease:'back.out(1.7)'},at)
          .to(bars[index],{attr:{height:bar.height*1.07,y:bar.y-bar.height*.035},duration:.2,ease:'sine.out'},3.65+index*.055)
          .to(bars[index],{attr:{height:bar.height,y:bar.y},duration:.38,ease:'sine.inOut'},3.95+index*.055);
      });
      // Four times the original pace. Stop on the complete mark before its fade-out.
      sequence.timeScale(4).call(()=>{if(completion.current){sequence.pause();notifyComplete();}},[],5.15);
      if(phase.progress!==null)sequence.progress(Math.min(1,Math.max(0,phase.progress)),true).pause();
      const visibility=()=>{
        const value=motion.current;
        if(document.hidden||value.paused||value.locallyPaused||value.progress!==null||completed.current&&completion.current)sequence.pause();else sequence.resume();
      };
      document.addEventListener('visibilitychange',visibility);
      return()=>{document.removeEventListener('visibilitychange',visibility);sequence.kill();timeline.current=null;};
    });
    return()=>media.revert();
  },{scope,dependencies:[replay,reducedMotion],revertOnUpdate:true});

  useGSAP(()=>{
    const animation=timeline.current;if(!animation)return;
    if(progress!==null){animation.progress(Math.min(1,Math.max(0,progress)),true).pause();return;}
    if(paused||locallyPaused||document.hidden||completed.current&&completion.current)animation.pause();else animation.resume();
  },{scope,dependencies:[paused,locallyPaused,progress]});

  const isPaused=paused||locallyPaused;
  return <div ref={scope} className={`brand-loader brand-loader--${theme}${compact?' brand-loader--compact':''}${reducedMotion?' brand-loader--still':''}`} lang={language} data-brand-loader="">
    <span className="brand-loader-status" role="status">{label}</span>
    <div className="brand-aura" aria-hidden="true"/>
    <svg className="brand-loader-art" viewBox={brandMark.viewBox} fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={ref('body')} x1="88" y1="0" x2="267" y2="240" gradientUnits="userSpaceOnUse"><stop stopColor="#168a78"/><stop offset=".42" stopColor="#07574e"/><stop offset=".75" stopColor="#063f3b"/><stop offset="1" stopColor="#0f7968"/></linearGradient>
        <linearGradient id={ref('left')} x1="79" y1="4" x2="170" y2="181" gradientUnits="userSpaceOnUse"><stop stopColor="#198d79"/><stop offset=".58" stopColor="#117b6c"/><stop offset="1" stopColor="#0a5b51"/></linearGradient>
        <linearGradient id={ref('front')} x1="129" y1="243" x2="310" y2="98" gradientUnits="userSpaceOnUse"><stop stopColor="#128777"/><stop offset=".47" stopColor="#29a382"/><stop offset="1" stopColor="#3fbb88"/></linearGradient>
        <linearGradient id={ref('bars')} x1="10" y1="60" x2="350" y2="170" gradientUnits="userSpaceOnUse"><stop stopColor="#38ac80"/><stop offset=".45" stopColor="#129c8b"/><stop offset="1" stopColor="#008d8c"/></linearGradient>
        <linearGradient id={ref('edge')} x1="102" y1="230" x2="292" y2="80" gradientUnits="userSpaceOnUse"><stop stopColor="#c7fce3" stopOpacity=".08"/><stop offset=".6" stopColor="#9cf2c8" stopOpacity=".5"/><stop offset="1" stopColor="#b9ffe2" stopOpacity="0"/></linearGradient>
        <linearGradient id={ref('silk')}><stop stopColor="white" stopOpacity="0"/><stop offset=".48" stopColor="#d5ffe8" stopOpacity=".04"/><stop offset=".5" stopColor="#d5ffe8" stopOpacity=".4"/><stop offset=".65" stopColor="white" stopOpacity="0"/></linearGradient>
        <linearGradient id={ref('thread')}><stop stopColor="#4ac5a2" stopOpacity="0"/><stop offset=".5" stopColor="#52d9b2"/><stop offset="1" stopColor="#24a18d" stopOpacity="0"/></linearGradient>
        <radialGradient id={ref('shadow')}><stop stopColor="#063e33" stopOpacity=".17"/><stop offset="1" stopColor="#063e33" stopOpacity="0"/></radialGradient>
        <clipPath id={ref('clip')}><path className="brand-silhouette" d={brandMark.silhouette}/></clipPath>
      </defs>
      <ellipse className="brand-shadow" cx="183" cy="267" rx="135" ry="13" fill={url('shadow')}/>
      <path className="brand-thread" d={brandMark.thread} stroke={url('thread')} strokeWidth="1.4" strokeLinecap="round" opacity="0"/>
      <g className="brand-ribbon">
        <path className="brand-silhouette" d={brandMark.silhouette} fill={url('body')}/>
        <g clipPath={url('clip')}>
          <path className="brand-fold" d={brandMark.leftFold} fill={url('left')}/>
          <path className="brand-fold" d={brandMark.frontFold} fill={url('front')}/>
          <path className="brand-fold" d={brandMark.seam} stroke={url('edge')} strokeWidth=".9"/>
          <rect className="brand-shine" x="-110" y="-100" width="160" height="460" fill={url('silk')} transform="rotate(-26 183 117)" opacity="0"/>
        </g>
      </g>
      {brandMark.bars.map((bar,index)=><rect key={index} className={`brand-bar brand-bar--${bar.side}`} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={bar.rx} fill={url('bars')}/>)}
    </svg>
    {showMotionControl&&!reducedMotion&&<button type="button" className="brand-motion-toggle" aria-label={language==='ar'?(isPaused?'استئناف الحركة':'إيقاف الحركة مؤقتًا'):(isPaused?'Resume animation':'Pause animation')} aria-pressed={isPaused} onClick={()=>setLocallyPaused(value=>!value)}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">{isPaused?<path d="m7 4 9 6-9 6Z" fill="currentColor"/>:<g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7 5v10M13 5v10"/></g>}</svg>
    </button>}
  </div>;
}
