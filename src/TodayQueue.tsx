import {useContext,useRef,type KeyboardEvent,type ReactNode} from 'react';
import {Clock3,MessageCircle,TriangleAlert} from 'lucide-react';
import {StaffLanguageContext,useStaffText} from './staff-language';
import {gsap,useGSAP} from './gsap';
import './today-dashboard.css';

export type TodayQueueGroup='cases'|'waiting'|'delivery';
const groups=[{key:'cases',label:'Needs attention',icon:MessageCircle},{key:'waiting',label:'Waiting for replies',icon:Clock3},{key:'delivery',label:'Delivery problems',icon:TriangleAlert}] as const;

export function TodayQueue({group,onGroup,counts,motionKey,children}:{group:TodayQueueGroup;onGroup:(value:TodayQueueGroup)=>void;counts:Record<TodayQueueGroup,number>;motionKey:string;children:ReactNode}){
  const t=useStaffText(),root=useRef<HTMLDivElement>(null),marker=useRef<HTMLSpanElement>(null),interacted=useRef(false);
  const language=useContext(StaffLanguageContext);
  useGSAP((_context,contextSafe)=>{
    const element=root.current,indicator=marker.current;if(!element||!indicator)return;
    const resize=contextSafe!(()=>{
      const target=element.querySelector<HTMLElement>('[aria-selected=true]');if(!target)return;
      gsap.killTweensOf(indicator);
      gsap.set(indicator,{x:target.offsetLeft,y:target.offsetTop,width:target.offsetWidth,height:target.offsetHeight,opacity:1});
    });
    const observer=new ResizeObserver(resize),tabs=element.querySelector('.today-queue-tabs');if(tabs)observer.observe(tabs);
    return()=>observer.disconnect();
  },{scope:root});
  useGSAP(()=>{
    const element=root.current,indicator=marker.current;if(!element||!indicator)return;
    const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const place=(animate:boolean)=>{
      const target=element.querySelector<HTMLElement>('[aria-selected=true]');if(!target)return;
      const next={x:target.offsetLeft,y:target.offsetTop,width:target.offsetWidth,height:target.offsetHeight,opacity:1};
      if(animate&&!reduce)gsap.to(indicator,{...next,duration:.28,ease:'power3.out',overwrite:true});else gsap.set(indicator,next);
    };
    place(interacted.current);
    gsap.killTweensOf(element.querySelectorAll('[role=tabpanel]'));
    gsap.set(element.querySelectorAll('[role=tabpanel]'),{clearProps:'opacity,transform'});
    if(interacted.current&&!reduce){
      const panel=element.querySelector('[role=tabpanel]:not([hidden])');
      if(panel)gsap.fromTo(panel,{opacity:.45,y:5},{opacity:1,y:0,duration:.22,ease:'power2.out',clearProps:'opacity,transform'});
    }
  },{scope:root,dependencies:[group,motionKey,language]});
  function select(value:TodayQueueGroup){interacted.current=true;onGroup(value);}
  function keyboard(event:KeyboardEvent<HTMLButtonElement>,index:number){
    const rtl=getComputedStyle(event.currentTarget).direction==='rtl';
    const offset=event.key==='ArrowRight'?(rtl?-1:1):event.key==='ArrowLeft'?(rtl?1:-1):0;
    if(!offset&&!['Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?groups.length-1:(index+offset+groups.length)%groups.length;
    select(groups[next].key);root.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
  }
  return <div ref={root} className="today-queue">
    <div className="today-queue-tabs" role="tablist" aria-label={t('All open work')}>
      <span ref={marker} className="today-queue-marker" aria-hidden="true"/>
      {groups.map(({key,label,icon:Icon},index)=><button key={key} id={`today-tab-${key}`} role="tab" aria-selected={group===key} aria-controls={`today-panel-${key}`} tabIndex={group===key?0:-1} onClick={()=>select(key)} onKeyDown={event=>keyboard(event,index)}><Icon size={16} aria-hidden="true"/><span>{t(label)}</span><strong>{t.number(counts[key])}</strong></button>)}
    </div>
    <div className="today-queue-panels">{children}</div>
  </div>;
}

export function TodayLoading(){
  const t=useStaffText();
  return <div className="today-loading" role="status"><p>{t('Loading overview...')}</p><div aria-hidden="true"><div className="today-loading-summary"/><div className="today-loading-columns"><div/><div/></div></div></div>;
}
