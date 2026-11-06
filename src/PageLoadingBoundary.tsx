import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {pageLoads,loadingRoute} from './page-load-state';
import {BrandLoader} from './BrandLoader';
import {gsap,ScrollTrigger} from './gsap-scroll';

export function PageLoadingBoundary({children}:{children:ReactNode}){
  const content=useRef<HTMLDivElement>(null),[loading,setLoading]=useState(true);
  const [loaderCycle,setLoaderCycle]=useState(0),cycleCounter=useRef(0),animationComplete=useRef<(cycle:number)=>void>(()=>{});
  useLayoutEffect(()=>{
    let route=loadingRoute(location.hash),generation=0,disposed=false,active=true,assets=0,timer:ReturnType<typeof setTimeout>|undefined,frame=0;
    let fontsReady=false,animationReady=false;
    let landingVisited=false;
    const accountsVisited=new Set<string>();
    const seen=new Set<string>();
    const paused=new Set<gsap.core.Animation>();
    const resume=()=>{for(const animation of paused)if(animation.parent)animation.resume();paused.clear();};
    const resetTimer=()=>{clearTimeout(timer);};
    const hasVisibleLoading=()=>Array.from(content.current?.querySelectorAll('[data-page-loading], .loading-page, .loading')??[]).some(element=>!element.closest('[hidden]'));
    const check=()=>{
      resetTimer();
      if(!active||disposed||!animationReady||!fontsReady||assets||pageLoads.size||hasVisibleLoading())return;
      if(document.fonts.status==='loading'){
        fontsReady=false;const cycle=generation;
        void document.fonts.ready.then(()=>{if(!disposed&&cycle===generation){fontsReady=true;scheduleScan();}});return;
      }
      // Let response parsing, React commits and lazy chunk fallbacks finish before revealing.
      const cycle=generation;
      timer=setTimeout(()=>{
        if(disposed||cycle!==generation||!animationReady||assets||pageLoads.size||hasVisibleLoading())return;
        active=false;pageLoads.finish();setLoading(false);
        resume();requestAnimationFrame(()=>{if(!disposed)ScrollTrigger.refresh();});
        document.dispatchEvent(new Event('understood:page-ready'));
      },220);
    };
    const preload=(src:string)=>{
      if(!src||seen.has(src))return;seen.add(src);assets++;
      const cycle=generation,image=new Image();
      const complete=()=>{image.onload=null;image.onerror=null;if(disposed||cycle!==generation)return;assets--;check();};
      image.onload=()=>{void image.decode().catch(()=>{}).finally(complete);};
      image.onerror=complete;image.src=src;
    };
    const scan=()=>{
      if(!active||disposed||!content.current)return;
      if(content.current.querySelector('.landing-page'))landingVisited=true;
      // Do not spend the hero's entrance animation behind the loading screen.
      for(const animation of gsap.globalTimeline.getChildren(false,true,true)){
        if(animation.paused()||animation.scrollTrigger)continue;
        const targets=animation instanceof gsap.core.Timeline?animation.getChildren(true,true,false).flatMap(child=>(child as gsap.core.Tween).targets()):(animation as gsap.core.Tween).targets();
        if(targets.some(target=>target instanceof Element&&content.current!.contains(target))){animation.pause();paused.add(animation);}
      }
      for(const img of content.current.querySelectorAll('img'))preload(img.currentSrc||img.src);
      // CSS hero and auth photography must be ready as well as <img> assets.
      for(const element of content.current.querySelectorAll('*')){
        const background=getComputedStyle(element).backgroundImage;
        if(background==='none')continue;
        for(const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g))preload(match[1]);
      }
      check();
    };
    const scheduleScan=()=>{resetTimer();cancelAnimationFrame(frame);frame=requestAnimationFrame(scan);};
    const observer=new MutationObserver(scheduleScan);
    const start=()=>{
      generation=++cycleCounter.current;resume();active=true;assets=0;seen.clear();fontsReady=false;animationReady=false;setLoaderCycle(generation);setLoading(true);pageLoads.start();resetTimer();
      const cycle=generation;
      void document.fonts.ready.then(()=>{if(!disposed&&cycle===generation){fontsReady=true;scheduleScan();}});
      scheduleScan();
    };
    animationComplete.current=cycle=>{if(disposed||!active||cycle!==generation)return;animationReady=true;check();};
    const navigate=()=>{
      const next=loadingRoute(location.hash);if(next===route)return;route=next;
      if(next==='landing'&&!landingVisited){landingVisited=true;if(!active)start();}
      else if(active)scheduleScan();
    };
    const enterAccount=(event:Event)=>{
      const key=(event as CustomEvent<unknown>).detail;
      if(typeof key!=='string'||!key||accountsVisited.has(key))return;
      accountsVisited.add(key);if(!active)start();
    };
    if(content.current)observer.observe(content.current,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','hidden']});
    const unsubscribe=pageLoads.subscribe(scheduleScan);
    window.addEventListener('hashchange',navigate);document.addEventListener('understood:account-entry',enterAccount);start();
    return()=>{disposed=true;generation=++cycleCounter.current;animationComplete.current=()=>{};resume();resetTimer();cancelAnimationFrame(frame);observer.disconnect();unsubscribe();window.removeEventListener('hashchange',navigate);document.removeEventListener('understood:account-entry',enterAccount);pageLoads.finish();};
  },[]);
  return <><div ref={content} className="page-loading-content" inert={loading} aria-hidden={loading||undefined} style={loading?{visibility:'hidden'}:undefined}>{children}</div>{loading&&<BrandLoader key={loaderCycle} onComplete={()=>animationComplete.current(loaderCycle)}/>}</>;
}
