import {useEffect,useRef,useState} from 'react';
import {Check,ChevronLeft,ChevronRight,Search,UserRound,X} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {readCrewCandidates,readCrewMembers,type CrewCandidate,type CrewCandidates,type CrewSummary} from './crew-overview';
import {peopleErrorText,peoplePageText,type PeopleLocale} from './people-locale';

const copy={
 en:{title:'Add worker to crew',search:'Search by name or worker ID',intro:'Choose an active worker from this site.',loading:'Loading workers...',empty:'No workers found.',noCrew:'No crew',already:'Already in this crew',move:'Move to crew',add:'Add to crew',saving:'Saving...',cancel:'Cancel',close:'Close worker picker',previous:'Previous workers',next:'Next workers',from:'Current crew:',moveNote:'This worker will move from their current crew. Previous assignments stay unchanged.',retry:'Try again'},
 ar:{title:'إضافة عامل إلى الفريق',search:'البحث بالاسم أو رقم العامل',intro:'اختر عاملاً نشطاً من هذا الموقع.',loading:'جارٍ تحميل العمال...',empty:'لم يتم العثور على عمال.',noCrew:'بدون فريق',already:'عضو في هذا الفريق',move:'نقل إلى الفريق',add:'إضافة إلى الفريق',saving:'جارٍ الحفظ...',cancel:'إلغاء',close:'إغلاق اختيار العامل',previous:'العمال السابقون',next:'العمال التاليون',from:'الفريق الحالي:',moveNote:'سيُنقل هذا العامل من فريقه الحالي. تبقى التكليفات السابقة دون تغيير.',retry:'إعادة المحاولة'},
};

export function CrewWorkerPicker({crew,authority,locale,onClose,onAdded}:{crew:CrewSummary;authority:StaffRequestAuthority;locale:PeopleLocale;onClose:()=>void;onAdded:(worker:CrewCandidate)=>void}){
 const t=copy[locale],dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false);
 const {request,current}=useStaffRequest(authority),scope=authority.session.staffScope||'';
 const [search,setSearch]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
 const [data,setData]=useState<CrewCandidates|null>(null),[selected,setSelected]=useState<CrewCandidate|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saveError,setSaveError]=useState('');
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setData(null);setError('');
  const query=new URLSearchParams({search,language:'all',status:'active',crewId:'all',page:String(page),pageSize:'10'});
  request(`/api/people/workers?${query}`,undefined,controller.signal).then(value=>{
   const result=readCrewCandidates(value,{page,pageSize:10,scope});
   if(!controller.signal.aborted&&current())setData(result);
  }).catch(reason=>{if(!controller.signal.aborted&&current())setError(peopleErrorText(locale,reason));})
   .finally(()=>{if(!controller.signal.aborted&&current())setLoading(false);});
  return()=>controller.abort();
 },[search,page,revision,scope,locale,request,current]);
 const moving=!!selected?.crew_id&&selected.crew_id!==crew.id,pages=Math.max(1,Math.ceil((data?.total||0)/10));
 async function save(event:React.FormEvent){
  event.preventDefault();if(inFlight.current||!selected||selected.crew_id===crew.id||!current()||!authority.canMutate())return;
  inFlight.current=true;setBusy(true);setSaveError('');
  try{
   const value=await request(`/api/people/workers/${encodeURIComponent(selected.id)}/crew`,{crewId:crew.id});
   const worker=readCrewMembers({items:[value],total:1,page:1,pageSize:1},{page:1,pageSize:1,crewId:crew.id,scope}).items[0];
   if(worker.id!==selected.id)throw Error('Crew view cannot be verified');
   if(current()&&authority.canMutate())onAdded(worker);
  }catch(reason){if(current())setSaveError(peopleErrorText(locale,reason));}
  finally{inFlight.current=false;if(current())setBusy(false);}
 }
 return <dialog ref={dialog} className="crew-worker-dialog" aria-labelledby="crew-worker-title" lang={locale} dir={locale==='ar'?'rtl':'ltr'} onCancel={event=>{event.preventDefault();if(!inFlight.current)onClose();}}>
  <form onSubmit={event=>void save(event)}>
   <div className="crew-worker-heading"><div><h2 id="crew-worker-title">{t.title}</h2><p><bdi>{crew.name}</bdi></p></div><button type="button" className="icon-button" aria-label={t.close} disabled={busy} onClick={onClose}><X size={20}/></button></div>
   <p className="muted">{t.intro}</p>
   <label className="search-box crew-worker-search"><Search size={18}/><input autoFocus type="search" dir="auto" aria-label={t.search} placeholder={t.search} maxLength={80} value={search} disabled={busy} onChange={event=>{setSearch(event.target.value);setPage(1);setSelected(null);setSaveError('');}}/></label>
   <div className="crew-worker-results" aria-busy={loading}>
    {loading?<p role="status">{t.loading}</p>:error?<div role="alert"><p className="record-error">{error}</p><button type="button" className="button outline" onClick={()=>setRevision(value=>value+1)}>{t.retry}</button></div>:!data?.items.length?<p className="empty-state">{t.empty}</p>:<fieldset><legend className="sr-only">{t.title}</legend>{data.items.map(worker=><label key={worker.id} className={`crew-worker-option${worker.crew_id===crew.id?' is-member':''}`}>
     <input type="radio" name="crew-worker" value={worker.id} disabled={busy||worker.crew_id===crew.id} checked={selected?.id===worker.id} onChange={()=>{setSelected(worker);setSaveError('');}}/>
     <UserRound size={19} aria-hidden="true"/><span><strong><bdi>{worker.name||worker.code}</bdi></strong><small><bdi>{worker.code}</bdi> · {worker.crew_id===crew.id?t.already:worker.crew_name?<>{t.from} <bdi>{worker.crew_name}</bdi></>:t.noCrew}</small></span>{worker.crew_id===crew.id&&<Check size={16} aria-hidden="true"/>}
    </label>)}</fieldset>}
   </div>
   {data&&pages>1&&<div className="crew-pagination"><span>{peoplePageText(locale,page,pages)}</span><div className="actions"><button type="button" className="icon-button direction-arrow" aria-label={t.previous} disabled={busy||loading||page<=1} onClick={()=>{setPage(value=>value-1);setSelected(null);}}><ChevronLeft size={19}/></button><button type="button" className="icon-button direction-arrow" aria-label={t.next} disabled={busy||loading||page>=pages} onClick={()=>{setPage(value=>value+1);setSelected(null);}}><ChevronRight size={19}/></button></div></div>}
   {moving&&<p className="crew-worker-move-note">{t.moveNote}</p>}
   {saveError&&<p role="alert" className="record-error">{saveError}</p>}
   <div className="crew-worker-footer"><button type="button" className="button outline" disabled={busy} onClick={onClose}>{t.cancel}</button><button type="submit" className="button primary" disabled={busy||loading||!!error||!selected||selected.crew_id===crew.id}><Check size={18}/>{busy?t.saving:moving?t.move:t.add}</button></div>
  </form>
 </dialog>;
}
