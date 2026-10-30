import {useEffect,useRef,useState,type RefObject} from 'react';
import {useStaffText} from './staff-language';
import {DEFAULT_SIDEBAR_WIDTH,MIN_SIDEBAR_WIDTH,SIDEBAR_WIDTH_KEY,sidebarWidth,sidebarWidthLimit,sidebarDragWidth} from './sidebar-width';

export function SidebarResizeHandle({sidebar}:{sidebar:RefObject<HTMLElement|null>}){
 const tr=useStaffText();
 const [width,setWidth]=useState(()=>{let saved=DEFAULT_SIDEBAR_WIDTH;try{const raw=localStorage.getItem(SIDEBAR_WIDTH_KEY);if(raw!==null&&raw.trim()&&Number.isFinite(Number(raw)))saved=Number(raw);}catch{}return sidebarWidth(saved,window.innerWidth<=760?920:window.innerWidth);});
 const [maximum,setMaximum]=useState(()=>sidebarWidthLimit(window.innerWidth));
 const drag=useRef<{pointerId:number;startX:number;startWidth:number;lastWidth:number;rtl:boolean}|null>(null),frame=useRef<number|null>(null),widthRef=useRef(width);
 const shell=()=>sidebar.current?.closest<HTMLElement>('.staff-shell');
 function apply(next:number){widthRef.current=next;shell()?.style.setProperty('--sidebar-width',`${next}px`);setWidth(next);}
 function save(next:number){try{localStorage.setItem(SIDEBAR_WIDTH_KEY,String(next));}catch{/* Resizing remains usable without storage. */}}
 function finish(){
  const active=drag.current;if(!active)return;drag.current=null;
  if(frame.current!==null){cancelAnimationFrame(frame.current);frame.current=null;}
  apply(active.lastWidth);save(active.lastWidth);shell()?.classList.remove('sidebar-resizing');
 }
 useEffect(()=>{
  const element=sidebar.current?.closest<HTMLElement>('.staff-shell');element?.style.setProperty('--sidebar-width',`${widthRef.current}px`);
  const resize=()=>{setMaximum(sidebarWidthLimit(window.innerWidth));if(window.innerWidth>760)apply(sidebarWidth(widthRef.current,window.innerWidth));};
  window.addEventListener('resize',resize);
  return()=>{window.removeEventListener('resize',resize);if(frame.current!==null)cancelAnimationFrame(frame.current);element?.classList.remove('sidebar-resizing');};
 },[sidebar]);
 return <div className="sidebar-resize-handle" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={tr('Resize sidebar')} aria-controls="dashboard-sidebar staff-main" aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={maximum} aria-valuenow={width} aria-valuetext={`${width}px`} title={tr('Drag to resize. Double-click to reset.')}
  onPointerDown={event=>{
   if(event.button!==0||!event.isPrimary)return;
   event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
   drag.current={pointerId:event.pointerId,startX:event.clientX,startWidth:widthRef.current,lastWidth:widthRef.current,rtl:getComputedStyle(sidebar.current!).direction==='rtl'};
   shell()?.classList.add('sidebar-resizing');event.currentTarget.focus();
  }}
  onPointerMove={event=>{
   const active=drag.current;if(!active||active.pointerId!==event.pointerId)return;
   active.lastWidth=sidebarDragWidth(active.startWidth,event.clientX-active.startX,active.rtl,window.innerWidth);
   if(frame.current===null)frame.current=requestAnimationFrame(()=>{frame.current=null;if(drag.current)apply(drag.current.lastWidth);});
  }}
  onPointerUp={event=>{if(drag.current?.pointerId!==event.pointerId)return;finish();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
  onPointerCancel={finish} onLostPointerCapture={finish}
  onDoubleClick={()=>{const next=sidebarWidth(DEFAULT_SIDEBAR_WIDTH,window.innerWidth);apply(next);save(next);}}
  onKeyDown={event=>{
   const rtl=getComputedStyle(sidebar.current!).direction==='rtl',step=event.shiftKey?32:8;
   let next:number;
   if(event.key==='ArrowRight'||event.key==='ArrowLeft')next=sidebarDragWidth(widthRef.current,event.key==='ArrowRight'?step:-step,rtl,window.innerWidth);
   else if(event.key==='Home')next=MIN_SIDEBAR_WIDTH;
   else if(event.key==='End')next=sidebarWidthLimit(window.innerWidth);
   else return;
   event.preventDefault();apply(next);save(next);
  }}><span aria-hidden="true"/></div>;
}
