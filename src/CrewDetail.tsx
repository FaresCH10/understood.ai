import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ChevronLeft,ChevronRight,FileText,Plus,RefreshCw,Send,UserRound,Users} from 'lucide-react';
import {CrewActions} from './People';
import {CrewWorkerPicker} from './CrewWorkerPicker';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {readCrewChange,readCrewMembers,type CrewMembers,type CrewSummary} from './crew-overview';
import {peopleErrorText,peopleLanguageNames,peoplePageText,type PeopleLocale} from './people-locale';
import './crew-detail.css';

const copy={
 en:{back:'Crews',loading:'Loading crew…',retry:'Try again',members:'Crew members',add:'Add existing worker',directory:'Manage workers',send:'Send instruction to crew',reports:'Crew response report',active:'Active',archived:'Archived',search:'Search members',status:'Worker access',all:'All workers',enabled:'Active workers',disabled:'Disabled workers',disabledMember:'Disabled',empty:'No members match these filters.',profile:'Open worker profile',previous:'Previous members',next:'Next members',refresh:'Refresh crew',note:'Membership changes apply to future sends. Previous assignments and reports keep the crew recorded at publication.',archivedNote:'This crew is archived. Restore it to add members or send new instructions.',saved:'Crew membership saved.'},
 ar:{back:'الفرق',loading:'جارٍ تحميل الفريق…',retry:'إعادة المحاولة',members:'أعضاء الفريق',add:'إضافة عامل موجود',directory:'إدارة العمال',send:'إرسال تعليمات إلى الفريق',reports:'تقرير إجابات الفريق',active:'نشط',archived:'مؤرشف',search:'البحث عن الأعضاء',status:'وصول العامل',all:'جميع العمال',enabled:'العمال النشطون',disabled:'العمال المعطلون',disabledMember:'معطل',empty:'لا يوجد أعضاء يطابقون عوامل التصفية.',profile:'فتح ملف العامل',previous:'الأعضاء السابقون',next:'الأعضاء التاليون',refresh:'تحديث الفريق',note:'تُطبق تغييرات العضوية على الإرسال المستقبلي. تحتفظ التكليفات والتقارير السابقة بالفريق المسجل عند النشر.',archivedNote:'هذا الفريق مؤرشف. استعده لإضافة الأعضاء أو إرسال تعليمات جديدة.',saved:'تم حفظ عضوية الفريق.'},
};

export default function CrewDetail({id,authority,locale,navigate}:{id:string;authority:StaffRequestAuthority;locale:PeopleLocale;navigate:(route:string)=>void}){
 const {request,current}=useStaffRequest(authority),t=copy[locale],languages=peopleLanguageNames(locale),scope=authority.session.staffScope||'';
 const [crew,setCrew]=useState<CrewSummary|null>(null),[members,setMembers]=useState<CrewMembers|null>(null),[search,setSearch]=useState(''),[status,setStatus]=useState<'all'|'active'|'inactive'>('all'),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState(''),[adding,setAdding]=useState(false);
 const addTrigger=useRef<HTMLButtonElement>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');setMembers(null);
  const query=new URLSearchParams({crewId:id,search,language:'all',status,page:String(page),pageSize:'10'});
  void Promise.all([request(`/api/people/crews/${encodeURIComponent(id)}`,undefined,controller.signal),request(`/api/people/workers?${query}`,undefined,controller.signal)]).then(([raw,workers])=>{
   const next=readCrewChange(raw,scope,id),list=readCrewMembers(workers,{scope,crewId:id,page,pageSize:10,status});
   if(!controller.signal.aborted&&current()){setCrew({...next,metrics:null});setMembers(list);}
  }).catch(reason=>{if(!controller.signal.aborted&&current())setError(peopleErrorText(locale,reason));}).finally(()=>{if(!controller.signal.aborted&&current())setLoading(false);});
  return()=>controller.abort();
 },[id,scope,search,status,page,revision,locale,request,current]);
 useEffect(()=>{heading.current?.focus();},[id]);
 const pages=Math.max(1,Math.ceil((members?.total||0)/10));
 function closePicker(){setAdding(false);requestAnimationFrame(()=>addTrigger.current?.focus());}
 return <div className="crew-detail people-localized" lang={locale} dir={locale==='ar'?'rtl':'ltr'}>
  <button className="back-link" onClick={()=>navigate('people/crews')}><ArrowLeft size={18}/>{t.back}</button>
  <div className="page-header"><div><h1 ref={heading} tabIndex={-1}>{crew?.name||(error?(locale==='ar'?'الفريق غير متاح':'Crew unavailable'):t.loading)}</h1>{crew&&<p>{crew.active?t.active:t.archived} · {crew.member_count} {t.enabled}</p>}</div>{crew&&<CrewActions crew={crew} authority={authority} locale={locale} disabled={loading} onChanged={text=>{if(current()){setMessage(text);setRevision(n=>n+1);}}}/>}</div>
  {message&&<p role="status" className="notice notice-green">{message}</p>}
  {error&&<div className="notice" role="alert"><span>{error}</span><button className="button outline" onClick={()=>setRevision(n=>n+1)}>{t.retry}</button></div>}
  {crew&&<><div className="actions crew-detail-links"><button className="button primary" disabled={!crew.active||loading||crew.member_count===0} onClick={()=>navigate(`send/crew/${encodeURIComponent(id)}`)}><Send size={18}/>{t.send}</button><button className="button outline" onClick={()=>navigate(`reports/crew/${encodeURIComponent(id)}`)}><FileText size={18}/>{t.reports}</button><button className="button outline" onClick={()=>navigate(`people/crew/${encodeURIComponent(id)}/workers`)}><Users size={18}/>{t.directory}</button></div>
   {!crew.active&&<p className="notice notice-amber">{t.archivedNote}</p>}<p className="notice notice-blue">{t.note}</p>
   <section className="panel"><div className="people-panel-heading"><h2>{t.members}{members?` (${members.total})`:''}</h2><div className="actions"><button ref={addTrigger} className="button outline" disabled={loading||!crew.active} onClick={()=>setAdding(true)}><Plus size={18}/>{t.add}</button><button className="icon-button" title={t.refresh} aria-label={t.refresh} disabled={loading} onClick={()=>setRevision(n=>n+1)}><RefreshCw size={18}/></button></div></div>
    <div className="filters"><label className="field">{t.search}<input type="search" aria-label={t.search} dir="auto" maxLength={80} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><label className="field">{t.status}<select aria-label={t.status} value={status} onChange={e=>{setStatus(e.target.value as 'all'|'active'|'inactive');setPage(1);}}><option value="all">{t.all}</option><option value="active">{t.enabled}</option><option value="inactive">{t.disabled}</option></select></label></div>
    {loading?<p role="status">{t.loading}</p>:members?.items.length?<div className="row-list">{members.items.map(worker=><button key={worker.id} className="item-row" onClick={()=>navigate(`people/worker/${encodeURIComponent(worker.id)}`)}><UserRound size={21}/><span className="item-main"><strong><bdi>{worker.name||worker.code}</bdi></strong><small><bdi>{worker.code}</bdi> · {languages[worker.language]} · {worker.active?t.active:t.disabledMember}</small></span><ChevronRight size={18}/><span className="sr-only">{t.profile}</span></button>)}</div>:!error&&<p className="empty-state">{t.empty}</p>}
    {members&&<div className="crew-pagination"><span>{peoplePageText(locale,page,pages)}</span><div className="actions"><button className="icon-button" title={t.previous} aria-label={t.previous} disabled={loading||page<=1} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={18}/></button><button className="icon-button" title={t.next} aria-label={t.next} disabled={loading||page>=pages} onClick={()=>setPage(n=>n+1)}><ChevronRight size={18}/></button>{page>pages&&<button className="button outline" onClick={()=>setPage(1)}>1</button>}</div></div>}
   </section></>}
  {adding&&crew&&<CrewWorkerPicker crew={crew} authority={authority} locale={locale} onClose={closePicker} onAdded={()=>{if(current()){setMessage(t.saved);setRevision(n=>n+1);closePicker();}}}/>}
 </div>;
}
