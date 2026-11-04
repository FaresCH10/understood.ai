import {useContext,useRef,useState,type ReactNode} from 'react';
import {Building2,ChartNoAxesCombined,ChevronDown,FileText,Mail,ShieldCheck,SlidersHorizontal,Users,Waypoints} from 'lucide-react';
import {StaffLanguageContext,useStaffText} from './staff-language';
import {gsap,useGSAP} from './gsap';
import './settings-workspace.css';

const copy={
  en:{workspace:'Workspace settings',intro:'Make Understood work for your team.',workspaceGroup:'Workspace',manageGroup:'Administration',org:'Identity, sites and languages',staff:'People and permissions',invites:'Invite your colleagues',billing:'Billing and payment records',setup:'Prepare your workspace',usage:'Your plan and activity',privacy:'Data policies and requests'},
  ar:{workspace:'إعدادات مساحة العمل',intro:'اضبط Understood بما يناسب فريقك.',workspaceGroup:'مساحة العمل',manageGroup:'الإدارة',org:'الهوية والمواقع واللغات',staff:'الأشخاص والصلاحيات',invites:'دعوة زملائك',billing:'الفواتير وسجلات الدفع',setup:'تجهيز مساحة العمل',usage:'خطتك ونشاطك',privacy:'سياسات البيانات والطلبات'},
  ur:{workspace:'ورک اسپیس کی ترتیبات',intro:'Understood کو اپنی ٹیم کے مطابق بنائیں۔',workspaceGroup:'ورک اسپیس',manageGroup:'انتظام',org:'شناخت، مقامات اور زبانیں',staff:'لوگ اور اجازتیں',invites:'ساتھیوں کو مدعو کریں',billing:'بلنگ اور ادائیگی کے ریکارڈ',setup:'ورک اسپیس تیار کریں',usage:'آپ کا منصوبہ اور سرگرمی',privacy:'ڈیٹا کی پالیسیاں اور درخواستیں'},
};

/** One local navigation for every settings route; existing screens own their data and forms. */
export function SettingsLayout({active,view,role,credential,organization,site,navigate,children}:{active:boolean;view:string;role:string;credential:boolean;organization?:string;site?:string;navigate:(path:string)=>void;children:ReactNode}){
  const t=useStaffText(),text=copy[useContext(StaffLanguageContext)];
  const navigation=useRef<HTMLDivElement>(null),marker=useRef<HTMLSpanElement>(null);
  const managed=['owner','administrator','auditor'].includes(role);
  const items=[
    {key:'settings',label:'Organization & site',hint:text.org,icon:Building2,show:true},
    {key:'settings/staff',label:'Staff & access',hint:text.staff,icon:Users,show:managed},
    {key:'settings/invitations',label:'Invitations',hint:text.invites,icon:Mail,show:managed&&credential},
    {key:'settings/invoices',label:'Invoices',hint:text.billing,icon:FileText,show:['owner','auditor'].includes(role)},
    {key:'settings/onboarding',label:'Pilot setup',hint:text.setup,icon:Waypoints,show:role==='owner'},
    {key:'settings/usage',label:'Plan & usage',hint:text.usage,icon:ChartNoAxesCombined,show:true},
    {key:'settings/retention',label:'Privacy & retention',hint:text.privacy,icon:ShieldCheck,show:true},
  ].filter(item=>item.show);
  const selected=items.find(item=>item.key==='settings/invoices'?view.startsWith(item.key):view===item.key);
  useGSAP((_context,contextSafe)=>{
    const track=navigation.current,indicator=marker.current;if(!active||!track||!indicator)return;
    const move=contextSafe!((animate:boolean)=>{
      const target=track.querySelector<HTMLElement>('[aria-current="page"]');if(!target)return;
      const position={x:target.offsetLeft,y:target.offsetTop,width:target.offsetWidth,height:target.offsetHeight,opacity:1};
      if(!animate||matchMedia('(prefers-reduced-motion: reduce)').matches)gsap.set(indicator,position);
      else gsap.to(indicator,{...position,duration:.3,ease:'power3.out',overwrite:true});
      const viewport=track.parentElement;
      if(viewport&&viewport.scrollWidth>viewport.clientWidth){
        const bounds=target.getBoundingClientRect(),frame=viewport.getBoundingClientRect();
        if(bounds.left<frame.left||bounds.right>frame.right)target.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
      }
    });
    move(true);
    const observer=new ResizeObserver(()=>move(false));observer.observe(track);
    return()=>observer.disconnect();
  },{scope:navigation,dependencies:[active,view,role,credential]});
  if(!active)return <>{children}</>;
  return <div className="settings-workspace">
    <aside className="settings-rail">
      <div className="settings-rail-heading"><SlidersHorizontal size={19} aria-hidden="true"/><p>{t('Settings')}</p></div>
      <p className="settings-intro">{text.intro}</p>
      <nav aria-label={t('Settings views')}><div className="settings-nav-track" ref={navigation}>
        <span ref={marker} className="settings-active-marker" aria-hidden="true"/>
        {items.map(({key,label,icon:Icon})=><button key={key} type="button" aria-current={selected?.key===key?'page':undefined} aria-pressed={selected?.key===key} onClick={()=>navigate(key)}><Icon size={17} aria-hidden="true"/><span>{t(label)}</span></button>)}
      </div></nav>
      <div className="settings-scope"><span>{text.workspaceGroup}</span><strong dir="auto">{organization}</strong><small dir="auto">{site}</small></div>
    </aside>
    <div className="settings-body" data-settings-section={selected?.key.split('/')[1]||'organization'}>
      <p className="settings-section-context">{text.workspace}<span aria-hidden="true">/</span>{selected?.hint}</p>
      {children}
    </div>
  </div>;
}

/** Feedback for a form or detail sheet opened by the user, never for a whole page. */
export function useSettingsReveal<T extends HTMLElement>(enabled:boolean,transitionKey?:unknown){
  const ref=useRef<T>(null);
  useGSAP(()=>{
    if(!enabled||!ref.current||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    gsap.fromTo(ref.current,{opacity:.4,y:8},{opacity:1,y:0,duration:.25,ease:'power2.out',clearProps:'opacity,transform'});
  },{scope:ref,dependencies:[enabled,transitionKey],revertOnUpdate:true});
  return ref;
}

export function SettingsPolicy({title,needsAttention=false,children}:{title:string;needsAttention?:boolean;children:ReactNode}){
  const [expanded,setExpanded]=useState(false);
  const content=useSettingsReveal<HTMLDivElement>(expanded||needsAttention);
  return <details className="settings-policy" open={expanded||needsAttention} onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary><h2>{title}</h2><ChevronDown size={18} aria-hidden="true"/></summary>
    <div className="settings-policy-content" ref={content}>{children}</div>
  </details>;
}
