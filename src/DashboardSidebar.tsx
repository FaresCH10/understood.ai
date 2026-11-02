import {SidebarResizeHandle} from './SidebarResizeHandle';
import {useEffect,useRef,type ComponentType,type ReactNode} from 'react';
import {ChevronDown,ChevronRight,LogOut,PanelLeftClose,Settings} from 'lucide-react';
import {gsap,useGSAP} from './gsap';

type Item={key:string;label:string;icon:ComponentType<{size?:number}>;active:boolean};
export function DashboardSidebar({brand,items,name,email,identity,settingsLabel,signOutLabel,closeLabel,accountLabel,onClose,navigate,logout,disabled}:{brand:ReactNode;items:Item[];name?:string;email?:string;identity:string;settingsLabel:string;signOutLabel:string;closeLabel:string;accountLabel:string;onClose:()=>void;navigate:(path:string)=>void;logout:()=>void;disabled:boolean}){
  const root=useRef<HTMLElement>(null);
  const account=useRef<HTMLDetailsElement>(null),accountPanel=useRef<HTMLDivElement>(null);
  const accountExpanded=useRef(false),accountMotion=useRef<ReturnType<typeof gsap.timeline>|null>(null);
  const initials=name?.split(' ').map(word=>word[0]).join('').slice(0,2);
  const {contextSafe}=useGSAP(()=>{}, {scope:root});
  const setAccount=contextSafe((open:boolean,restoreFocus=false)=>{
    const detail=account.current,panel=accountPanel.current;if(!detail||!panel)return;
    accountExpanded.current=open;accountMotion.current?.kill();
    const arrow=detail.querySelector('.account-chevron');
    if(open){detail.open=true;panel.inert=false;}else panel.inert=true;
    const finish=()=>{if(!accountExpanded.current){detail.open=false;if(restoreFocus)(detail.firstElementChild as HTMLElement)?.focus();}};
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){
      gsap.set([panel,...panel.querySelectorAll('.account-action')],{clearProps:'opacity,transform'});gsap.set(arrow,{rotate:open?180:0});finish();return;
    }
    const timeline=gsap.timeline({onComplete:open?undefined:finish});accountMotion.current=timeline;
    if(open){
      timeline.fromTo(panel,{opacity:0,y:10,scale:.98,transformOrigin:'50% 100%'},{opacity:1,y:0,scale:1,duration:.16,ease:'power2.out',clearProps:'opacity,transform'},0)
        .fromTo(panel.querySelectorAll('.account-action'),{opacity:0,y:4},{opacity:1,y:0,duration:.12,stagger:.02,ease:'power2.out',clearProps:'opacity,transform'},.025);
    }else timeline.to(panel,{opacity:0,y:6,scale:.985,duration:.13,ease:'power2.in'},0);
    timeline.to(arrow,{rotate:open?180:0,duration:.16,ease:'power2.out'},0);
  });
  useEffect(()=>{
    const el=root.current;if(!el)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){if(account.current?.open)setAccount(false,true);else el.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(detail=>{detail.open=false;(detail.firstElementChild as HTMLElement)?.focus();});}};
    const outside=(event:PointerEvent)=>{if(account.current?.open&&!account.current.contains(event.target as Node))setAccount(false);};
    document.addEventListener('keydown',close);document.addEventListener('pointerdown',outside);
    return()=>{document.removeEventListener('keydown',close);document.removeEventListener('pointerdown',outside);};
  },[setAccount]);
  const iconParts=(icon:SVGSVGElement)=>[icon,...icon.querySelectorAll<SVGElement>('path,circle,rect,line,polyline,polygon')];
  const animateIcon=contextSafe((button:HTMLButtonElement,key:string,entering:boolean)=>{
    const icon=button.querySelector<SVGSVGElement>('svg');
    if(!icon||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const parts=iconParts(icon);
    gsap.killTweensOf(parts);
    if(!entering){gsap.to(parts,{x:0,y:0,rotate:0,scale:1,scaleY:1,opacity:1,duration:.2,ease:'power2.out',overwrite:true});return;}
    const paths=[...icon.querySelectorAll('path')];
    if(key==='reports'){
      const bars=paths.slice(1);
      for(const bar of bars){const box=bar.getBBox();gsap.set(bar,{svgOrigin:`${box.x+box.width/2} ${box.y+box.height}`});}
      gsap.fromTo(bars,{scaleY:.2},{scaleY:1,duration:.5,ease:'back.out(2.2)',stagger:.07,overwrite:true});
      return;
    }
    if(key==='competencies'){
      const parts=iconParts(icon);
      gsap.set(parts,{svgOrigin:'12 12'});
      gsap.fromTo(parts,{scale:.82},{scale:1,duration:.45,ease:'elastic.out(1,.5)',stagger:.03,overwrite:true});
      return;
    }
    if(key==='calendar'){
      const dots=[...icon.querySelectorAll<SVGPathElement>('path[d$="h.01"]')];
      gsap.fromTo(dots,{y:0},{y:-1.8,duration:.15,ease:'power2.out',stagger:.03,yoyo:true,repeat:1,overwrite:true});
      return;
    }
    if(key==='briefings'){
      gsap.fromTo(paths.slice(2),{x:-2.2},{x:0,duration:.3,ease:'power3.out',stagger:.05,overwrite:true});
      return;
    }
    if(key==='people'){
      const head=icon.querySelector<SVGCircleElement>('circle');
      if(head){
        const cx=Number(head.getAttribute('cx')),cy=Number(head.getAttribute('cy'));
        gsap.set(head,{svgOrigin:`${cx} ${cy}`});
        gsap.fromTo(head,{scale:.72},{scale:1,duration:.45,ease:'elastic.out(1,.45)',overwrite:true});
      }
      gsap.fromTo(icon,{y:0},{y:-1.5,duration:.18,yoyo:true,repeat:1,ease:'power2.out',overwrite:true});
      return;
    }
    if(key==='people/crews'){
      gsap.fromTo(icon,{rotate:0},{rotate:-7,duration:.18,ease:'power2.out',yoyo:true,repeat:1,overwrite:true});
      return;
    }
    if(key==='clarifications'){
      gsap.fromTo(icon,{rotate:0},{rotate:-9,duration:.17,ease:'power2.out',yoyo:true,repeat:1,overwrite:true});
      return;
    }
    if(key==='language-requests'){
      gsap.fromTo(icon,{rotate:0},{rotate:14,duration:.2,ease:'power2.inOut',yoyo:true,repeat:1,overwrite:true});
      return;
    }
    gsap.fromTo(icon,{y:0},{y:-2.5,duration:.16,ease:'power2.out',yoyo:true,repeat:1,overwrite:true});
  });
  const link=(item:Item)=><button key={item.key} aria-current={item.active?'page':undefined} className={`sidebar-link ${item.active?'active':''}`} onClick={()=>navigate(item.key)} onPointerEnter={event=>{if(event.pointerType==='mouse')animateIcon(event.currentTarget,item.key,true);}} onPointerLeave={event=>{if(event.pointerType==='mouse')animateIcon(event.currentTarget,item.key,false);}}><item.icon size={19}/><span>{item.label}</span></button>;
  return <aside ref={root} id="dashboard-sidebar" className="sidebar dashboard-sidebar" inert={disabled}>
    <div className="sidebar-heading">{brand}<button className="icon-button sidebar-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}><PanelLeftClose size={20}/></button></div>
    <nav aria-label={accountLabel}><div className="sidebar-group">{items.map(link)}</div></nav>
    <details ref={account} className="account-disclosure">
      <summary className="profile" aria-label={accountLabel} onClick={event=>{event.preventDefault();setAccount(!accountExpanded.current);}}><span className="avatar">{initials}</span><span><strong><bdi>{name}</bdi></strong><small>{identity}</small></span><ChevronDown className="account-chevron" size={16}/></summary>
      <div ref={accountPanel} className="account-options disclosure-content"><div className="account-address"><span className="account-menu-avatar" aria-hidden="true">{initials}</span><div className="account-menu-identity"><div className="account-menu-name"><strong><bdi>{name}</bdi></strong><span className="account-role">{identity}</span></div>{email&&<small><bdi>{email}</bdi></small>}</div></div><div className="account-actions"><button className="account-action" onClick={()=>{setAccount(false);navigate('settings');}}><Settings size={18}/><span>{settingsLabel}</span><ChevronRight className="account-action-arrow" size={15}/></button><button className="account-action account-sign-out" onClick={()=>{setAccount(false);logout();}}><LogOut size={18}/><span>{signOutLabel}</span></button></div></div>
    </details>
    <SidebarResizeHandle sidebar={root}/>
  </aside>;
}
