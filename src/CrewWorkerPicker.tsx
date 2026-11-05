import {keepDialogFocus} from './dialog-focus';
import {useEffect,useRef,useState} from 'react';
import {Check,ChevronLeft,ChevronRight,Search,UserRound,X} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {readCrewCandidates,readCrewBulkChange,type CrewCandidate,type CrewCandidates,type CrewSummary} from './crew-overview';
import {peopleErrorText,peoplePageText,type PeopleLocale} from './people-locale';

const copy={
 en:{title:'Add workers to crew',search:'Search by name or worker ID',intro:'Choose up to 100 active workers. Selections stay while you search or change pages.',loading:'Loading workers...',empty:'No workers found.',noCrew:'No crew',already:'Already in this crew',move:'Move to crew',add:'Add to crew',saving:'Saving...',cancel:'Cancel',close:'Close worker picker',previous:'Previous workers',next:'Next workers',from:'Current crew:',moveNote:'This worker will move from their current crew. Previous assignments stay unchanged.',retry:'Try again',selected:'selected',clear:'Clear selection',moveTitle:'Workers moving from other crews',confirmMove:'Move these workers to this crew',addMany:'Add selected workers'},
 ar:{title:'إضافة عمال إلى الفريق',search:'البحث بالاسم أو رقم العامل',intro:'اختر حتى 100 عامل نشط. تبقى اختياراتك أثناء البحث والتنقل بين الصفحات.',loading:'جارٍ تحميل العمال...',empty:'لم يتم العثور على عمال.',noCrew:'بدون فريق',already:'عضو في هذا الفريق',move:'نقل إلى الفريق',add:'إضافة إلى الفريق',saving:'جارٍ الحفظ...',cancel:'إلغاء',close:'إغلاق اختيار العامل',previous:'العمال السابقون',next:'العمال التاليون',from:'الفريق الحالي:',moveNote:'سيُنقل هذا العامل من فريقه الحالي. تبقى التكليفات السابقة دون تغيير.',retry:'إعادة المحاولة',selected:'محدد',clear:'إلغاء الاختيار',moveTitle:'عمال سينتقلون من فرق أخرى',confirmMove:'نقل هؤلاء العمال إلى هذا الفريق',addMany:'إضافة العمال المحددين'},
};

export function CrewWorkerPicker({crew,authority,locale,onClose,onAdded}:{crew:CrewSummary;authority:StaffRequestAuthority;locale:PeopleLocale;onClose:()=>void;onAdded:(workers:CrewCandidate[])=>void}){
 const t=copy[locale],dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false);
 const {request,current}=useStaffRequest(authority),scope=authority.session.staffScope||'';
 const [search,setSearch]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
 const [data,setData]=useState<CrewCandidates|null>(null),[selected,setSelected]=useState<Record<string,CrewCandidate>>({}),[confirmedMoves,setConfirmedMoves]=useState(false);
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
 const chosen=Object.values(selected),moving=chosen.filter(worker=>worker.crew_id&&worker.crew_id!==crew.id),pages=Math.max(1,Math.ceil((data?.total||0)/10));
 function toggleWorker(worker:CrewCandidate){
  setSelected(old=>{const next={...old};if(next[worker.id])delete next[worker.id];else if(Object.keys(next).length<100)next[worker.id]=worker;return next;});
  setConfirmedMoves(false);setSaveError('');
 }
 async function save(event:React.FormEvent){
  event.preventDefault();if(inFlight.current||!chosen.length||moving.length&&!confirmedMoves||!current()||!authority.canMutate())return;
  inFlight.current=true;setBusy(true);setSaveError('');
  try{
   const value=await request(`/api/people/crews/${encodeURIComponent(crew.id)}/members`,{members:chosen.map(worker=>({workerId:worker.id,expectedCrewId:worker.crew_id})),confirmedMoves});
   const workers=readCrewBulkChange(value,{crewId:crew.id,workerIds:chosen.map(worker=>worker.id),scope});
   if(current()&&authority.canMutate())onAdded(workers);
  }catch(reason){if(current())setSaveError(peopleErrorText(locale,reason));}
  finally{inFlight.current=false;if(current())setBusy(false);}
 }
 return <dialog ref={dialog} className="crew-worker-dialog" aria-labelledby="crew-worker-title" onKeyDown={keepDialogFocus} lang={locale} dir={locale==='ar'?'rtl':'ltr'} onCancel={event=>{event.preventDefault();if(!inFlight.current)onClose();}}>
  <form onSubmit={event=>void save(event)}>
   <div className="crew-worker-heading"><div><h2 id="crew-worker-title">{t.title}</h2><p><bdi>{crew.name}</bdi></p></div><button type="button" className="icon-button" aria-label={t.close} disabled={busy} onClick={onClose}><X size={20}/></button></div>
   <p className="muted">{t.intro}</p>
   <label className="search-box crew-worker-search"><Search size={18}/><input autoFocus type="search" dir="auto" aria-label={t.search} placeholder={t.search} maxLength={80} value={search} disabled={busy} onChange={event=>{setSearch(event.target.value);setPage(1);setSaveError('');}}/></label>
   <div className="crew-worker-selection"><span role="status">{chosen.length} {t.selected}</span><button type="button" className="text-link" disabled={busy||!chosen.length} onClick={()=>{setSelected({});setConfirmedMoves(false);setSaveError('');}}>{t.clear}</button></div>
   <div className="crew-worker-results" aria-busy={loading}>
    {loading?<p role="status">{t.loading}</p>:error?<div role="alert"><p className="record-error">{error}</p><button type="button" className="button outline" onClick={()=>setRevision(value=>value+1)}>{t.retry}</button></div>:!data?.items.length?<p className="empty-state">{t.empty}</p>:<fieldset><legend className="sr-only">{t.title}</legend>{data.items.map(worker=><label key={worker.id} className={`crew-worker-option${worker.crew_id===crew.id?' is-member':''}`}>
     <input type="checkbox" name="crew-worker" value={worker.id} disabled={busy||worker.crew_id===crew.id||chosen.length>=100&&!selected[worker.id]} checked={!!selected[worker.id]} onChange={()=>toggleWorker(worker)}/>
     <UserRound size={19} aria-hidden="true"/><span><strong><bdi>{worker.name||worker.code}</bdi></strong><small><bdi>{worker.code}</bdi> · {worker.crew_id===crew.id?t.already:worker.crew_name?<>{t.from} <bdi>{worker.crew_name}</bdi></>:t.noCrew}</small></span>{worker.crew_id===crew.id&&<Check size={16} aria-hidden="true"/>}
    </label>)}</fieldset>}
   </div>
   {data&&pages>1&&<div className="crew-pagination"><span>{peoplePageText(locale,page,pages)}</span><div className="actions"><button type="button" className="icon-button direction-arrow" aria-label={t.previous} disabled={busy||loading||page<=1} onClick={()=>{setPage(value=>value-1);}}><ChevronLeft size={19}/></button><button type="button" className="icon-button direction-arrow" aria-label={t.next} disabled={busy||loading||page>=pages} onClick={()=>{setPage(value=>value+1);}}><ChevronRight size={19}/></button></div></div>}
   {!!moving.length&&<div className="crew-worker-move-note"><strong>{t.moveTitle} ({moving.length})</strong><ul>{moving.map(worker=><li key={worker.id}><bdi>{worker.name||worker.code}</bdi> · <bdi>{worker.crew_name}</bdi></li>)}</ul><label><input type="checkbox" checked={confirmedMoves} disabled={busy} onChange={event=>setConfirmedMoves(event.target.checked)}/><span>{t.confirmMove}</span></label></div>}
   {saveError&&<p role="alert" className="record-error">{saveError}</p>}
   <div className="crew-worker-footer"><button type="button" className="button outline" disabled={busy} onClick={onClose}>{t.cancel}</button><button type="submit" className="button primary" disabled={busy||loading||!!error||!chosen.length||!!moving.length&&!confirmedMoves}><Check size={18}/>{busy?t.saving:chosen.length===1?t.add:t.addMany}</button></div>
  </form>
 </dialog>;
}
