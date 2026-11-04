import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,ChevronRight,LifeBuoy,Search} from 'lucide-react';
import {findHelpGuides,helpGuides,type HelpLocale,type HelpRole} from './help-content';
import './help-center.css';

const copy={
  en:{title:'Help for every workday.',intro:'Practical guides for the people sharing instructions, doing the work and keeping everything running.',home:'Help center',search:'Search help articles',placeholder:'Try “access link”, “audio” or “invoices”',all:'All guides',worker:'For workers',supervisor:'For supervisors',owner:'For owners',one:'guide',clear:'Clear search',results:'guides',empty:'No guides found',emptyBody:'Try a different phrase or choose All guides.',reset:'Clear filters',contact:'Contact support',contactBody:'Tell us the workspace and site, the screen, the error and when it happened. Leave out passwords, private access links, recordings and worker personal data.',still:'Need a little more help?',demo:'Try the interactive walkthrough',back:'Return to workspace',contents:'In this guide',related:'Keep exploring',notFound:'This guide could not be found.',read:'Read guide',support:'For urgent work questions, contact your site supervisor directly. This help center does not send an operational help request.'},
  ar:{title:'مساعدة لكل يوم عمل.',intro:'أدلة عملية لمن يرسل التعليمات وينفّذ العمل ويدير الفريق.',home:'مركز المساعدة',search:'ابحث في أدلة المساعدة',placeholder:'جرّب «رابط الوصول» أو «الصوت» أو «الفواتير»',all:'كل الأدلة',worker:'للعمال',supervisor:'للمشرفين',owner:'للمالكين',one:'دليل',clear:'مسح البحث',results:'أدلة',empty:'لم نعثر على أدلة',emptyBody:'جرّب عبارة أخرى أو اختر كل الأدلة.',reset:'مسح التصفية',contact:'تواصل مع الدعم',contactBody:'اذكر مساحة العمل والموقع والشاشة والخطأ ووقت حدوثه. لا ترفق كلمات المرور أو الروابط الخاصة أو التسجيلات أو بيانات العمال الشخصية.',still:'هل تحتاج إلى مساعدة إضافية؟',demo:'جرّب الجولة التفاعلية',back:'العودة إلى مساحة العمل',contents:'في هذا الدليل',related:'اكتشف المزيد',notFound:'تعذّر العثور على هذا الدليل.',read:'اقرأ الدليل',support:'للأسئلة العاجلة المتعلقة بالعمل، تواصل مباشرة مع مشرف الموقع. لا يرسل مركز المساعدة طلب متابعة تشغيلياً.'},
};

export function HelpCenter({view,locale}:{view:string;locale:HelpLocale}){
  const t=copy[locale],heading=useRef<HTMLHeadingElement>(null);
  const [query,setQuery]=useState(''),[role,setRole]=useState<HelpRole>('all');
  const slug=view==='support'?'':view.slice('support/'.length),guide=helpGuides.find(item=>item.id===slug);
  const matches=findHelpGuides(query,role,locale),article=guide?.[locale];
  useEffect(()=>{heading.current?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});},[view]);
  function goToSection(index:number){const section=document.getElementById(`help-section-${index}`);section?.focus({preventScroll:true});section?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  return <div className="help-center landing-container">
    <nav className="help-breadcrumb" aria-label={t.home}><a href="#support"><LifeBuoy size={17} aria-hidden="true"/>{t.home}</a>{article&&<><ChevronRight size={14} aria-hidden="true"/><span>{article.title}</span></>}<a className="help-workspace" href="#sign-in">{t.back}<ArrowRight size={15} aria-hidden="true"/></a></nav>
    {!slug?<>
      <header className="help-heading"><h1 ref={heading} tabIndex={-1}>{t.title}</h1><p>{t.intro}</p></header>
      <div className="help-search-area"><label className="help-search"><Search size={22} aria-hidden="true"/><span className="sr-only">{t.search}</span><input type="search" value={query} maxLength={160} placeholder={t.placeholder} onChange={event=>setQuery(event.target.value)}/>{query&&<button type="button" onClick={()=>setQuery('')}>{t.clear}</button>}</label>
        <div className="help-filters" role="group" aria-label={t.home}>{(['all','worker','supervisor','owner'] as const).map(value=><button type="button" key={value} aria-pressed={role===value} onClick={()=>setRole(value)}>{t[value]}</button>)}</div>
      </div>
      <p className="help-result-count" role="status" aria-live="polite">{matches.length} {matches.length===1?t.one:t.results}</p>
      <div className="help-guide-list">{matches.map(item=><a className="help-guide-row" key={item.id} href={`#support/${item.id}`}><div><span className="help-audience">{t[item.role]}</span><h2>{item[locale].title}</h2><p>{item[locale].summary}</p></div><ArrowRight size={20} aria-hidden="true"/></a>)}</div>
      {!matches.length&&<div className="help-empty"><BookOpen size={30} aria-hidden="true"/><h2>{t.empty}</h2><p>{t.emptyBody}</p><button type="button" onClick={()=>{setQuery('');setRole('all');}}>{t.reset}</button></div>}
    </>:article&&guide?<>
      <header className="help-heading help-article-heading"><p className="help-audience">{t[guide.role]}</p><h1 ref={heading} tabIndex={-1}>{article.title}</h1><p>{article.summary}</p></header>
      <div className="help-article-layout"><aside className="help-contents"><p>{t.contents}</p>{article.sections.map((section,index)=><button key={section.title} onClick={()=>goToSection(index)}>{section.title}</button>)}<a href="#walkthrough"><BookOpen size={16} aria-hidden="true"/>{t.demo}</a></aside>
        <article className="help-article">{article.sections.map((section,index)=><section key={section.title}><h2 tabIndex={-1} id={`help-section-${index}`}>{section.title}</h2>{section.body.map(body=><p key={body}>{body}</p>)}</section>)}<p className="help-operational-note">{t.support}</p></article>
      </div>
      <section className="help-related"><h2>{t.related}</h2><div>{helpGuides.filter(item=>item.id!==guide.id).sort((a,b)=>Number(b.role===guide.role)-Number(a.role===guide.role)).slice(0,2).map(item=><a key={item.id} href={`#support/${item.id}`}>{item[locale].title}<ArrowRight size={17} aria-hidden="true"/></a>)}</div></section>
    </>:<div className="help-empty"><h1 ref={heading} tabIndex={-1}>{t.notFound}</h1><a href="#support"><ArrowLeft size={17} aria-hidden="true"/>{t.home}</a></div>}
    <section className="help-contact"><div><h2>{t.still}</h2><p>{t.contactBody}</p></div><div><a className="landing-button landing-button--primary" href="#contact">{t.contact}<ArrowRight size={17} aria-hidden="true"/></a><a className="help-demo-link" href="#walkthrough">{t.demo}</a></div></section>
  </div>;
}
