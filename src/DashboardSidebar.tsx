import {SidebarResizeHandle} from './SidebarResizeHandle';
import {useEffect,useRef,type ComponentType,type ReactNode} from 'react';
import {ChevronDown,ChevronRight,LogOut,PanelLeftClose,Settings} from 'lucide-react';
import {gsap,useGSAP} from './gsap';

type Item={key:string;label:string;icon:ComponentType<{size?:number}>;active:boolean};
export function DashboardSidebar({brand,items,moreItems,name,email,identity,moreLabel,settingsLabel,signOutLabel,closeLabel,accountLabel,onClose,navigate,logout,disabled}:{brand:ReactNode;items:Item[];moreItems:Item[];name?:string;email?:string;identity:string;moreLabel:string;settingsLabel:string;signOutLabel:string;closeLabel:string;accountLabel:string;onClose:()=>void;navigate:(path:string)=>void;logout:()=>void;disabled:boolean}){
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
  const animate=contextSafe((element:HTMLDetailsElement)=>{
    if(!element.open||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const panel=element.querySelector(':scope > .disclosure-content');
    if(panel)gsap.fromTo(panel,{opacity:0,y:6},{opacity:1,y:0,duration:.18,ease:'power2.out',overwrite:true,clearProps:'transform,opacity'});
  });
  useEffect(()=>{
    const el=root.current;if(!el)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){if(account.current?.open)setAccount(false,true);else el.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(detail=>{detail.open=false;(detail.firstElementChild as HTMLElement)?.focus();});}};
    const outside=(event:PointerEvent)=>{if(account.current?.open&&!account.current.contains(event.target as Node))setAccount(false);};
    document.addEventListener('keydown',close);document.addEventListener('pointerdown',outside);
    return()=>{document.removeEventListener('keydown',close);document.removeEventListener('pointerdown',outside);};
  },[setAccount]);
  const link=(item:Item)=><button key={item.key} aria-current={item.active?'page':undefined} className={`sidebar-link ${item.active?'active':''}`} onClick={()=>navigate(item.key)}><item.icon size={19}/><span>{item.label}</span></button>;
  return <aside ref={root} id="dashboard-sidebar" className="sidebar dashboard-sidebar" inert={disabled}>
    <div className="sidebar-heading">{brand}<button className="icon-button sidebar-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}><PanelLeftClose size={20}/></button></div>
    <nav aria-label={accountLabel}><div className="sidebar-group">{items.map(link)}</div>{moreItems.length>0&&<details className="sidebar-more" onToggle={event=>animate(event.currentTarget)}><summary>{moreLabel}<ChevronDown size={16}/></summary><div className="sidebar-group disclosure-content">{moreItems.map(link)}</div></details>}</nav>
    <details ref={account} className="account-disclosure">
      <summary className="profile" aria-label={accountLabel} onClick={event=>{event.preventDefault();setAccount(!accountExpanded.current);}}><span className="avatar">{initials}</span><span><strong><bdi>{name}</bdi></strong><small>{identity}</small></span><ChevronDown className="account-chevron" size={16}/></summary>
      <div ref={accountPanel} className="account-options disclosure-content"><div className="account-address"><span className="account-menu-avatar" aria-hidden="true">{initials}</span><div className="account-menu-identity"><div className="account-menu-name"><strong><bdi>{name}</bdi></strong><span className="account-role">{identity}</span></div>{email&&<small><bdi>{email}</bdi></small>}</div></div><div className="account-actions"><button className="account-action" onClick={()=>{setAccount(false);navigate('settings');}}><Settings size={18}/><span>{settingsLabel}</span><ChevronRight className="account-action-arrow" size={15}/></button><button className="account-action account-sign-out" onClick={()=>{setAccount(false);logout();}}><LogOut size={18}/><span>{signOutLabel}</span></button></div></div>
    </details>
    <SidebarResizeHandle sidebar={root}/>
  </aside>;
}
