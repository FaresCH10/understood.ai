import {useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowLeftRight} from 'lucide-react';
import {StaffLanguageContext} from './staff-language';

const scrollHint={en:'Scroll for more views',ar:'مرّر لعرض المزيد',ur:'مزید دیکھنے کے لیے اسکرول کریں'};

export function InstructionViewTabs({label,children}:{label:string;children:ReactNode}){
 const language=useContext(StaffLanguageContext),nav=useRef<HTMLElement>(null);
 const [overflowing,setOverflowing]=useState(false);
 useEffect(()=>{
  const element=nav.current;if(!element)return;
  const measure=()=>setOverflowing(element.scrollWidth>element.clientWidth+1);
  const observer=new ResizeObserver(measure);
  observer.observe(element);
  for(const child of element.children)observer.observe(child);
  measure();
  return()=>observer.disconnect();
 },[children]);
 return <><nav ref={nav} className="briefing-detail-tabs" aria-label={label}>{children}</nav>{overflowing&&<p className="instruction-tabs-hint"><ArrowLeftRight size={15} aria-hidden="true"/>{scrollHint[language]}</p>}</>;
}
