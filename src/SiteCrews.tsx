import {useEffect,useState} from 'react';
import {CheckCircle2,ChevronLeft,ChevronRight,Clock3,FileText,Plus,RefreshCw,TriangleAlert,UserRound,Users} from 'lucide-react';
import {CrewActions} from './People';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {completeStaffRequest} from './staff-request';
import {readCrewOverview,readCrewMembers,type CrewOverview,type CrewMembers} from './crew-overview';
import {peopleText,peopleLanguageNames,peoplePageText,peopleMessageText,peopleErrorText,type PeopleLocale} from './people-locale';
import {staffIdentityLabel} from './session-state';

const copy={
  en:{title:'Site crews',intro:'Crews at',directory:'Worker directory',create:'Create crew',refresh:'Refresh crews',loading:'Loading site crews...',retry:'Retry',
    publication:'Latest published instruction',noPublication:'No published instruction is available.',frozen:'Crew response counts use membership frozen at publication. Current members are shown separately.',unavailable:'Historical crew snapshot unavailable',
    assigned:'Assigned',responses:'Responses',matches:'Matches',clarifications:'Clarifications',pending:'Awaiting response',unassessed:'Awaiting AI check',primary:'Primary contact',deputy:'Deputy contact',notSet:'Not set',
    crews:'Crews',name:'Crew name',members:'Current active members',snapshotAssigned:'Assigned at publication',open:'Select crew',actions:'Crew actions',empty:'No crews match these filters.',
    selected:'Selected crew',choose:'Select a crew to see its current members.',manage:'Manage membership',loadingMembers:'Loading current members...',noMembers:'No active members in this crew.',openWorker:'Open worker',
    previousMembers:'Previous members',nextMembers:'Next members',activity:'Recent directory activity',allActivity:'View all activity',noActivity:'No directory activity recorded.',former:'Former site member',hidden:'Item unavailable',
    moved:'Worker membership changed',createdWorker:'Worker added',createdCrew:'Crew created',renamed:'Crew renamed',archived:'Crew archived',restored:'Crew restored',
    warning:'Response status is not proof of safe work or internal understanding.',moveWarning:'Moving a worker does not change previous assignments or frozen crew reports.',
    morning:'Good morning',afternoon:'Good afternoon',evening:'Good evening'},
  ar:{title:'فرق الموقع',intro:'الفرق في',directory:'دليل العمال',create:'إنشاء فريق',refresh:'تحديث الفرق',loading:'جارٍ تحميل فرق الموقع...',retry:'إعادة المحاولة',
    publication:'أحدث تعليمات منشورة',noPublication:'لا توجد تعليمات منشورة متاحة.',frozen:'تستخدم أعداد إجابات الفرق العضوية المحفوظة عند النشر. تُعرض العضوية الحالية بشكل منفصل.',unavailable:'لقطة عضوية الفرق السابقة غير متاحة',
    assigned:'مسندة',responses:'الإجابات',matches:'مطابقة الإجابات',clarifications:'تحتاج توضيحاً',pending:'بانتظار الإجابة',unassessed:'بانتظار تحقق الذكاء الاصطناعي',primary:'المسؤول الأساسي',deputy:'نائب المسؤول',notSet:'غير محدد',
    crews:'الفرق',name:'اسم الفريق',members:'الأعضاء النشطون حالياً',snapshotAssigned:'مسندة عند النشر',open:'اختيار الفريق',actions:'إجراءات الفريق',empty:'لا توجد فرق تطابق عوامل التصفية.',
    selected:'الفريق المحدد',choose:'اختر فريقاً لعرض أعضائه الحاليين.',manage:'إدارة العضوية',loadingMembers:'جارٍ تحميل الأعضاء الحاليين...',noMembers:'لا يوجد أعضاء نشطون في هذا الفريق.',openWorker:'فتح العامل',
    previousMembers:'الأعضاء السابقون',nextMembers:'الأعضاء التاليون',activity:'أحدث نشاط في الدليل',allActivity:'عرض كل النشاط',noActivity:'لا يوجد نشاط مسجل في الدليل.',former:'عضو سابق في الموقع',hidden:'العنصر غير متاح',
    moved:'تم تغيير عضوية عامل',createdWorker:'تمت إضافة عامل',createdCrew:'تم إنشاء فريق',renamed:'تم تغيير اسم فريق',archived:'تمت أرشفة فريق',restored:'تمت استعادة فريق',
    warning:'حالة الإجابة ليست دليلاً على العمل الآمن أو الفهم الداخلي.',moveWarning:'لا يغيّر نقل العامل التكليفات السابقة أو تقارير الفرق المحفوظة عند النشر.',
    morning:'صباح الخير',afternoon:'طاب نهارك',evening:'مساء الخير'},
};
export const siteCrewsText=copy;

export default function SiteCrews({authority,refresh,locale,onLocaleChange,navigate,name,greeting,canManageContacts}:{authority:StaffRequestAuthority;refresh:number;locale:PeopleLocale;onLocaleChange:(locale:PeopleLocale)=>void;navigate:(route:string)=>void;name?:string;greeting:string;canManageContacts:boolean}) {
  const {request,current}=useStaffRequest(authority),t=copy[locale],p=peopleText[locale],languages=peopleLanguageNames(locale);
  const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [data,setData]=useState<CrewOverview|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [selectedId,setSelectedId]=useState(''),[memberPage,setMemberPage]=useState(1),[members,setMembers]=useState<CrewMembers|null>(null),[memberLoading,setMemberLoading]=useState(false),[memberError,setMemberError]=useState(''),[memberRevision,setMemberRevision]=useState(0);
  const staffScope=authority.session.staffScope || '',query=new URLSearchParams({search,status,page:String(page),pageSize:'5'}).toString();
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setData(null);
    request(`/api/people/crew-overview?${query}`,undefined,controller.signal).then(value=>completeStaffRequest(value,
      value=>readCrewOverview(value,{page,pageSize:5,scope:staffScope}),result=>{
        if(controller.signal.aborted)return;setData(result);setSelectedId(id=>result.items.some(row=>row.id===id)?id:result.items[0]?.id || '');
      },current,()=>!controller.signal.aborted)).catch(reason=>{if(!controller.signal.aborted && current())setError((reason as Error).message);})
      .finally(()=>{if(!controller.signal.aborted && current())setLoading(false);});
    return()=>controller.abort();
  },[query,page,refresh,revision,staffScope,request,current]);
  const selected=data?.items.find(row=>row.id===selectedId);
  useEffect(()=>{
    const controller=new AbortController();setMembers(null);setMemberError('');setMemberLoading(!!selected);
    if(selected){
      const query=new URLSearchParams({crewId:selected.id,search:'',language:'all',status:'active',page:String(memberPage),pageSize:'5'});
      request(`/api/people/workers?${query}`,undefined,controller.signal).then(value=>completeStaffRequest(value,
        value=>readCrewMembers(value,{page:memberPage,pageSize:5,crewId:selected.id,scope:staffScope}),value=>{if(!controller.signal.aborted)setMembers(value);},current,()=>!controller.signal.aborted))
        .catch(reason=>{if(!controller.signal.aborted && current())setMemberError((reason as Error).message);})
        .finally(()=>{if(!controller.signal.aborted && current())setMemberLoading(false);});
    }
    return()=>controller.abort();
  },[selected?.id,memberPage,refresh,revision,memberRevision,staffScope,request,current]);
  const pages=Math.max(1,Math.ceil((data?.total || 0)/5)),memberPages=Math.max(1,Math.ceil((members?.total || 0)/5));
  const greetingText=greeting==='Good morning'?t.morning:greeting==='Good afternoon'?t.afternoon:t.evening;
  const metricDefinitions=[['assigned',t.assigned,FileText],['responses',t.responses,Users],['matches',t.matches,CheckCircle2],['clarifications',t.clarifications,TriangleAlert],['pending',t.pending,Clock3]] as const;
  return <div className="site-crews people-localized" lang={locale} dir={locale==='ar'?'rtl':'ltr'}>
    <button className="back-link" onClick={()=>navigate('people')}><Users size={18}/>{t.directory}</button>
    <div className="page-header"><div><h1>{t.crews}</h1><p>{t.intro} <bdi>{data?.site.name || authority.session.site}</bdi></p></div><div className="actions people-header-actions">
      <button className="button primary" onClick={()=>navigate('people/new')}><Plus size={18}/>{p.addWorker}</button><button className="button outline" onClick={()=>navigate('people/new-crew')}><Users size={18}/>{t.create}</button>
    </div></div>
    {error && <div className="notice" role="alert"><span>{peopleErrorText(locale,new Error(error))}</span><button className="button outline" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={18}/>{t.retry}</button></div>}
    {message && <p role="status" className="notice notice-green">{peopleMessageText(locale,message)}</p>}
    {loading?<p role="status">{t.loading}</p>:data && <>
      <div className="site-crews-metrics">{metricDefinitions.map(([key,label,Icon])=><div key={key} className={`metric ${['clarifications','pending'].includes(key)?'metric-warn':''}`}><span className="metric-icon"><Icon size={23}/></span><div><strong>{data.metrics?.[key] ?? '—'}</strong><span>{label}</span></div></div>)}
        {(['primary','deputy'] as const).map(key=><div className="site-crew-contact" key={key}><UserRound size={22}/><div><strong><bdi>{data.contacts[key]?.name || t.notSet}</bdi></strong><small>{key==='primary'?t.primary:t.deputy}</small>{data.contacts[key] && <small>{staffIdentityLabel(data.contacts[key]!.role,locale,true)}</small>}</div>{canManageContacts && <button className="icon-button direction-arrow" title={p.edit} aria-label={`${p.edit}: ${key==='primary'?t.primary:t.deputy}`} onClick={()=>navigate('settings')}><ChevronRight size={18}/></button>}</div>)}
      </div>
      <div className="site-crew-publication">{data.publication?<><span>{t.publication}: </span><button className="text-link" onClick={()=>navigate(`briefings/${data.publication!.briefingId}`)}><bdi>{data.publication.title}</bdi> · v{data.publication.version}</button><p>{t.frozen}</p>{!data.crewSnapshotAvailable && <p className="notice notice-blue">{t.unavailable}</p>}{!!data.metrics?.unassessed && <p>{t.unassessed}: {data.metrics.unassessed}</p>}</>:<p>{t.noPublication}</p>}</div>
    </>}
    <div className="site-crews-grid"><div>
      <section className="panel site-crew-list"><div className="people-panel-heading"><h2>{t.crews}{data?` (${data.total})`:''}</h2><button className="icon-button" aria-label={t.refresh} title={t.refresh} disabled={loading} onClick={()=>setRevision(n=>n+1)}><RefreshCw size={18}/></button></div>
        <div className="filters"><label className="field">{p.searchCrews}<input type="search" dir="auto" value={search} maxLength={80} onChange={event=>{setSearch(event.target.value);setPage(1);setMemberPage(1);}}/></label><label className="field">{p.crewStatus}<select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);setMemberPage(1);}}><option value="all">{p.allCrews}</option><option value="active">{p.active}</option><option value="inactive">{p.archived}</option></select></label></div>
        {!loading && data && (data.items.length?<div className="table-wrap" role="region" tabIndex={0} aria-label={t.crews}><table className="site-crew-table"><thead><tr><th>{t.name}</th><th>{t.members}</th><th>{t.snapshotAssigned}</th><th>{t.matches}</th><th>{t.clarifications}</th><th>{t.pending}</th><th><span className="sr-only">{t.actions}</span></th></tr></thead><tbody>{data.items.map(crew=><tr key={crew.id} className={crew.id===selectedId?'people-selection':''}>
          <td><button className="people-row-button" aria-label={`${t.open}: ${crew.name}`} aria-pressed={crew.id===selectedId} onClick={()=>{setSelectedId(crew.id);setMemberPage(1);}}><Users size={18}/><bdi>{crew.name}</bdi></button>{!crew.active && <small>{p.archived}</small>}</td><td>{crew.member_count}</td><td>{crew.metrics?.assigned ?? '—'}</td><td>{crew.metrics?.matches ?? '—'}</td><td>{crew.metrics?.clarifications ?? '—'}</td><td>{crew.metrics?.pending ?? '—'}</td><td><CrewActions authority={authority} locale={locale} crew={crew} disabled={loading} onChanged={(success)=>{if(!current())return;setMessage(success);setRevision(n=>n+1);}}/></td>
        </tr>)}</tbody></table></div>:<p>{t.empty}</p>)}
        <div className="crew-pagination"><span>{peoplePageText(locale,page,pages)}</span><div className="actions"><button className="icon-button direction-arrow" aria-label={p.previousCrews} title={p.previousCrews} disabled={loading || !!error || page<=1} onClick={()=>{setPage(n=>n-1);setMemberPage(1);}}><ChevronLeft size={18}/></button><button className="icon-button direction-arrow" aria-label={p.nextCrews} title={p.nextCrews} disabled={loading || !!error || page>=pages} onClick={()=>{setPage(n=>n+1);setMemberPage(1);}}><ChevronRight size={18}/></button>{page>pages && !loading && !error && <button className="button subtle" onClick={()=>setPage(1)}>{p.firstPage}</button>}</div></div>
      </section>
    </div><aside className="panel site-crew-members"><div className="people-panel-heading"><h2>{t.selected}</h2>{selected && <button className="icon-button" title={t.refresh} aria-label={`${t.refresh}: ${selected.name}`} disabled={memberLoading} onClick={()=>setMemberRevision(n=>n+1)}><RefreshCw size={18}/></button>}</div>
      {!selected?<p>{t.choose}</p>:<><h3><bdi>{selected.name}</bdi></h3><p>{t.members}: {members?.total ?? selected.member_count}</p><button className="text-link" onClick={()=>navigate(`people/crew/${selected.id}`)}><Users size={18}/>{t.manage}</button>
        {memberLoading?<p role="status">{t.loadingMembers}</p>:memberError?<p role="alert">{peopleErrorText(locale,new Error(memberError))}</p>:members && (members.items.length?<ul>{members.items.map(worker=><li key={worker.id}><button className="people-row-button" aria-label={`${t.openWorker}: ${worker.code}`} onClick={()=>navigate(`people/worker/${worker.id}`)}><UserRound size={22}/><span><strong><bdi>{worker.code}</bdi></strong><small>{languages[worker.language]}</small></span><ChevronRight size={18}/></button></li>)}</ul>:<p>{t.noMembers}</p>)}
        <div className="crew-pagination"><span>{peoplePageText(locale,memberPage,memberPages)}</span><div className="actions"><button className="icon-button direction-arrow" title={t.previousMembers} aria-label={t.previousMembers} disabled={memberLoading || !!memberError || memberPage<=1} onClick={()=>setMemberPage(n=>n-1)}><ChevronLeft size={18}/></button><button className="icon-button direction-arrow" title={t.nextMembers} aria-label={t.nextMembers} disabled={memberLoading || !!memberError || memberPage>=memberPages} onClick={()=>setMemberPage(n=>n+1)}><ChevronRight size={18}/></button>{memberPage>memberPages && !memberLoading && !memberError && <button className="button subtle" onClick={()=>setMemberPage(1)}>{p.firstPage}</button>}</div></div>
      </>}
      <p className="notice notice-blue">{t.moveWarning}</p>
    </aside></div>
    <p className="notice"><TriangleAlert size={20}/>{t.warning}</p>
  </div>;
}
