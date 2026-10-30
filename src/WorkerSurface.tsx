import {useRef,type ReactNode} from 'react';
import {gsap,useGSAP} from './gsap';

// Keep the working surface mounted so navigation guards continue to protect drafts.
export function WorkerSurface({children,view}:{children:ReactNode;view:string}){
  const root=useRef<HTMLElement>(null);
  useGSAP((_context,contextSafe)=>{
    const motion=window.matchMedia('(prefers-reduced-motion: no-preference)');
    if(!motion.matches)return;
    const seen=new WeakSet<Element>();
    const reveal=contextSafe!(()=>{
      if(!root.current||!motion.matches)return;
      const fresh=Array.from(root.current.querySelectorAll('.worker-page-heading,.device-heading,.worker-card,.worker-help-contact,.worker-inbox-help,.device-expiry,.device-danger-card,.empty-state')).filter(element=>!seen.has(element));
      fresh.forEach(element=>seen.add(element));
      if(fresh.length)gsap.from(fresh,{y:12,opacity:0,duration:.38,stagger:{each:.045,amount:.16},ease:'power2.out',clearProps:'transform,opacity'});
    });
    reveal();
    const observer=new MutationObserver(reveal);
    if(root.current)observer.observe(root.current,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },{scope:root,dependencies:[view],revertOnUpdate:true});
  return <main ref={root} className="worker-content" id="worker-main" tabIndex={-1}>{children}</main>;
}
