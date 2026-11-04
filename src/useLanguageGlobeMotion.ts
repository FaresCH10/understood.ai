import type {RefObject} from 'react';
import {gsap,useGSAP} from './gsap';

/** Move the map inside a stationary globe. Pause in place when hover ends. */
export function useLanguageGlobeMotion(root:RefObject<HTMLElement|null>,selector:string,disabled=false){
  useGSAP(()=>{
    const trigger=root.current?.querySelector<HTMLElement>(selector);
    const map=trigger?.querySelector<SVGGElement>('.language-globe-map');
    if(!trigger || !map || disabled)return;
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      let hovered=false,focused=false;
      const spin=gsap.fromTo(map,{x:0},{x:-24,duration:3.2,repeat:-1,ease:'none',paused:true});
      const animate=()=>{
        if(hovered || focused)spin.play();else spin.pause();
      };
      const enter=(event:PointerEvent)=>{if(event.pointerType==='touch')return;hovered=true;animate();};
      const leave=()=>{hovered=false;animate();};
      const focus=()=>{focused=!!trigger.querySelector(':focus-visible') || trigger.matches(':focus-visible');animate();};
      const blur=(event:FocusEvent)=>{if(event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget))return;focused=false;animate();};
      trigger.addEventListener('pointerenter',enter);trigger.addEventListener('pointerleave',leave);
      trigger.addEventListener('focusin',focus);trigger.addEventListener('focusout',blur);
      return()=>{
        trigger.removeEventListener('pointerenter',enter);trigger.removeEventListener('pointerleave',leave);
        trigger.removeEventListener('focusin',focus);trigger.removeEventListener('focusout',blur);
      };
    });
    return()=>media.revert();
  },{scope:root,dependencies:[selector,disabled],revertOnUpdate:true});
}
