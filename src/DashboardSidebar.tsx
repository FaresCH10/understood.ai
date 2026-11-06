import {SidebarResizeHandle} from './SidebarResizeHandle';
import {useContext,useEffect,useRef,useState,type ComponentType,type ReactNode} from 'react';
import {Ellipsis,BookOpen,ChevronDown,ChevronRight,LifeBuoy,LogOut,Mail,PanelLeftClose,Settings} from 'lucide-react';
import {gsap,useGSAP} from './gsap';
import {StaffLanguageContext} from './staff-language';

const accountCopy={
  en:{more:'More',help:'Help & support',center:'Help center',guide:'Interactive walkthrough',contact:'Contact support',settings:'Workspace preferences',helpHint:'Find answers and get in touch'},
  ar:{more:'المزيد',help:'المساعدة والدعم',center:'مركز المساعدة',guide:'جولة تفاعلية',contact:'تواصل مع الدعم',settings:'تفضيلات مساحة العمل',helpHint:'اعثر على إجابات وتواصل معنا'},
  ur:{more:'مزید',help:'مدد اور معاونت',center:'مدد کا مرکز',guide:'انٹرایکٹو رہنمائی',contact:'معاونت سے رابطہ کریں',settings:'ورک اسپیس کی ترجیحات',helpHint:'جوابات تلاش کریں اور رابطہ کریں'},
};

type Item={key:string;label:string;icon:ComponentType<{size?:number}>;active:boolean};
export function DashboardSidebar({brand,items,name,email,plan,identity,settingsLabel,signOutLabel,closeLabel,accountLabel,onClose,navigate,logout,disabled,open=true}:{brand:ReactNode;items:Item[];name?:string;email?:string;plan?:string;identity:string;settingsLabel:string;signOutLabel:string;closeLabel:string;accountLabel:string;onClose:()=>void;navigate:(path:string)=>void;logout:()=>void;disabled:boolean;open?:boolean}){
  const root=useRef<HTMLElement>(null);
  const more=useRef<HTMLDetailsElement>(null),morePanel=useRef<HTMLDivElement>(null);
  const moreKeys=new Set(['language-requests','reports']);
  const primaryItems=items.filter(item=>!moreKeys.has(item.key)),moreItems=items.filter(item=>moreKeys.has(item.key));
  const activeMoreKey=moreItems.find(item=>item.active)?.key;
  useEffect(()=>{if(activeMoreKey && more.current)more.current.open=true;},[activeMoreKey]);
  const copy=accountCopy[useContext(StaffLanguageContext)];
  const [helpOpen,setHelpOpen]=useState(false);
  const helpContent=useRef<HTMLDivElement>(null);
  const restoreAccountFocus=useRef(false);
  const motionReady=useRef(false);
  useGSAP(()=>{
    const element=root.current;if(!element)return;
    const target={xPercent:open?0:getComputedStyle(element).direction==='rtl'?100:-100,autoAlpha:open?1:0};
    if(!motionReady.current||matchMedia('(prefers-reduced-motion: reduce)').matches){gsap.set(element,target);motionReady.current=true;return;}
    gsap.to(element,{...target,duration:.26,ease:'power2.inOut',overwrite:true});
    // Preserve the current tween position when a user reverses direction quickly.
  },{scope:root,dependencies:[open]});
  const account=useRef<HTMLDetailsElement>(null),accountPanel=useRef<HTMLDivElement>(null);
  const accountExpanded=useRef(false),accountMotion=useRef<ReturnType<typeof gsap.timeline>|null>(null);
  const initials=name?.split(' ').map(word=>word[0]).join('').slice(0,2);
  const {contextSafe}=useGSAP(()=>{}, {scope:root});
  const animateMoreDots=contextSafe((trigger:HTMLElement,entering:boolean)=>{
    const dots=trigger.querySelectorAll('.sidebar-more-icon circle');
    gsap.killTweensOf(dots);
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){gsap.set(dots,{y:0});return;}
    if(entering)gsap.fromTo(dots,{y:0},{y:-3,duration:.16,stagger:.055,ease:'power2.out',yoyo:true,repeat:1});
    else gsap.to(dots,{y:0,duration:.14,ease:'power2.out',overwrite:true});
  });
  const animateMore=contextSafe(()=>{
    const panel=morePanel.current;if(!panel)return;
    gsap.killTweensOf(panel);
    if(more.current?.open&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      gsap.fromTo(panel,{height:0,opacity:0},{height:'auto',opacity:1,duration:.24,ease:'power2.out',clearProps:'height,opacity'});
    }else gsap.set(panel,{clearProps:'height,opacity'});
  });
  const setAccount=contextSafe((open:boolean,restoreFocus=false)=>{
    const detail=account.current,panel=accountPanel.current;if(!detail||!panel)return;
    accountExpanded.current=open;restoreAccountFocus.current=restoreFocus;
    const arrow=detail.querySelector('.account-chevron');
    if(open){detail.open=true;panel.inert=false;}else panel.inert=true;
    const finish=()=>{if(!accountExpanded.current){detail.open=false;setHelpOpen(false);if(restoreAccountFocus.current)(detail.firstElementChild as HTMLElement)?.focus();}};
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){
      accountMotion.current?.kill();accountMotion.current=null;
      gsap.set([panel,...panel.querySelectorAll('.account-action'),panel.querySelector('.account-address')],{clearProps:'opacity,transform'});gsap.set(arrow,{rotate:open?180:0});finish();return;
    }
    if(!accountMotion.current){
      accountMotion.current=gsap.timeline({paused:true,onReverseComplete:finish,defaults:{ease:'power3.out'}})
        .fromTo(panel,{opacity:0,y:18,scale:.94,transformOrigin:'50% 100%'},{opacity:1,y:0,scale:1,duration:.34,ease:'back.out(1.15)'},0)
        .fromTo(panel.querySelector('.account-address'),{opacity:0,y:8},{opacity:1,y:0,duration:.24},.06)
        .fromTo(panel.querySelectorAll('.account-actions > .account-action'),{opacity:0,y:9},{opacity:1,y:0,duration:.24,stagger:.045},.1)
        .to(arrow,{rotate:180,duration:.3},0);
    }
    if(open)accountMotion.current.timeScale(1).play();
    else if(accountMotion.current.progress()===0)finish();
    else accountMotion.current.timeScale(1.6).reverse();
  });
  useGSAP(()=>{
    if(helpOpen && helpContent.current && !matchMedia('(prefers-reduced-motion: reduce)').matches){
      gsap.fromTo(helpContent.current,{height:0,opacity:0},{height:'auto',opacity:1,duration:.24,ease:'power2.out',clearProps:'height,opacity'});
      gsap.fromTo(helpContent.current.children,{x:8,opacity:0},{x:0,opacity:1,duration:.22,stagger:.045,clearProps:'transform,opacity'});
    }
  },{scope:root,dependencies:[helpOpen],revertOnUpdate:true});
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
        gsap.fromTo(head,{scale:.86},{scale:1,duration:.3,ease:'back.out(1.5)',overwrite:true});
      }
      gsap.set(icon,{svgOrigin:'12 12'});
      gsap.fromTo(icon,{rotate:0,y:0},{rotate:-6,y:-1,duration:.16,yoyo:true,repeat:1,ease:'power2.out',overwrite:true});
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
  return <aside ref={root} id="dashboard-sidebar" className="sidebar dashboard-sidebar" inert={disabled||!open} aria-hidden={!open}>
    <div className="sidebar-heading">{brand}<button className="icon-button sidebar-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}><PanelLeftClose size={20}/></button></div>
    <nav aria-label={accountLabel}><div className="sidebar-group">{primaryItems.map(link)}{moreItems.length>0&&<details className="sidebar-more" ref={more} onToggle={animateMore}><summary className={`sidebar-link sidebar-more-trigger${activeMoreKey?' has-active':''}`} onPointerEnter={event=>{if(event.pointerType==='mouse')animateMoreDots(event.currentTarget,true);}} onPointerLeave={event=>{if(event.pointerType==='mouse')animateMoreDots(event.currentTarget,false);}} onFocus={event=>animateMoreDots(event.currentTarget,true)} onBlur={event=>animateMoreDots(event.currentTarget,false)}><Ellipsis className="sidebar-more-icon" size={19}/><span>{copy.more}</span><ChevronDown className="sidebar-more-chevron" size={15}/></summary><div className="sidebar-more-panel" ref={morePanel}>{moreItems.map(link)}</div></details>}</div></nav>
    <details ref={account} className="account-disclosure">
      <summary className="profile" aria-label={accountLabel} onClick={event=>{event.preventDefault();setAccount(!accountExpanded.current);}}><span className="avatar">{initials}</span><span><strong><bdi>{name}</bdi></strong><small>{identity}</small></span><ChevronDown className="account-chevron" size={16}/></summary>
      <div ref={accountPanel} className="account-options disclosure-content"><div className="account-address"><span className="account-menu-avatar" aria-hidden="true">{initials}</span><div className="account-menu-identity"><div className="account-menu-name"><strong><bdi>{name}</bdi></strong><span className="account-role">{identity}</span></div>{email&&<small><bdi>{email}</bdi></small>}{plan&&<small className="account-plan"><bdi>{plan}</bdi></small>}</div></div><div className="account-actions"><button className="account-action" onClick={()=>{setAccount(false);navigate('settings');}}><Settings size={18}/><span><strong>{settingsLabel}</strong><small>{copy.settings}</small></span><ChevronRight className="account-action-arrow" size={15}/></button><button className="account-action account-help" aria-expanded={helpOpen} aria-controls="account-help-content" onClick={()=>setHelpOpen(value=>!value)}><LifeBuoy size={18}/><span><strong>{copy.help}</strong><small>{copy.helpHint}</small></span><ChevronDown className="account-help-chevron" size={15}/></button><div ref={helpContent} className="account-help-content" id="account-help-content" hidden={!helpOpen}><button onClick={()=>{setAccount(false);navigate('support');}}><LifeBuoy size={16}/><span>{copy.center}</span><ChevronRight size={14}/></button><button onClick={()=>{setAccount(false);navigate('walkthrough');}}><BookOpen size={16}/><span>{copy.guide}</span><ChevronRight size={14}/></button><button onClick={()=>{setAccount(false);navigate('contact');}}><Mail size={16}/><span>{copy.contact}</span><ChevronRight size={14}/></button></div><button className="account-action account-sign-out" onClick={()=>{setAccount(false);logout();}}><LogOut size={18}/><span>{signOutLabel}</span></button></div></div>
    </details>
    <SidebarResizeHandle sidebar={root}/>
  </aside>;
}
