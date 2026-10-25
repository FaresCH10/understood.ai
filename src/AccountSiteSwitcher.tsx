import {useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,ChevronLeft,ChevronRight,MapPin,RefreshCw,X} from 'lucide-react';
import {staffIdentityLabel} from './session-state';
type Site={staffId:string;organization:string;site:string;role:string;current:boolean};
type Sites={items:Site[];total:number;page:number;pageSize:number};
const copy={
  en:{change:'Change site',title:'Choose site',refresh:'Refresh sites',close:'Close site selection',loading:'Loading sites...',unavailable:'Sites unavailable.',notConfirmed:'Site selection was not confirmed. Your current session was refreshed.',sessionUnavailable:'Site session unavailable. Close this dialog and recheck your session.',current:'Current',empty:'No active sites are available.',page:'Page',of:'of',previous:'Previous sites',next:'Next sites',switchTo:'Switch to',as:'as',confirm:'I am ready to leave this site. Unsaved edits will close.',cancel:'Cancel',switching:'Switching...',switch:'Switch site'},
  ar:{change:'تغيير الموقع',title:'اختيار الموقع',refresh:'تحديث المواقع',close:'إغلاق اختيار الموقع',loading:'جارٍ تحميل المواقع...',unavailable:'المواقع غير متاحة.',notConfirmed:'لم يُؤكد اختيار الموقع. تم تحديث جلستك الحالية.',sessionUnavailable:'جلسة الموقع غير متاحة. أغلق هذه النافذة وأعد التحقق من جلستك.',current:'الحالي',empty:'لا توجد مواقع نشطة متاحة.',page:'الصفحة',of:'من',previous:'المواقع السابقة',next:'المواقع التالية',switchTo:'التبديل إلى',as:'بصفة',confirm:'أنا مستعد لمغادرة هذا الموقع. ستُغلق التعديلات غير المحفوظة.',cancel:'إلغاء',switching:'جارٍ التبديل...',switch:'تبديل الموقع'},
  ur:{change:'مقام بدلیں',title:'مقام منتخب کریں',refresh:'مقامات تازہ کریں',close:'مقام کا انتخاب بند کریں',loading:'مقامات لوڈ ہو رہے ہیں...',unavailable:'مقامات دستیاب نہیں۔',notConfirmed:'مقام کے انتخاب کی تصدیق نہیں ہوئی۔ آپ کا موجودہ سیشن تازہ کیا گیا ہے۔',sessionUnavailable:'مقام کا سیشن دستیاب نہیں۔ یہ ڈائیلاگ بند کر کے سیشن دوبارہ چیک کریں۔',current:'موجودہ',empty:'کوئی فعال مقام دستیاب نہیں۔',page:'صفحہ',of:'از',previous:'پچھلے مقامات',next:'اگلے مقامات',switchTo:'اس مقام پر جائیں',as:'بحیثیت',confirm:'میں اس مقام سے جانے کے لیے تیار ہوں۔ غیر محفوظ تبدیلیاں بند ہو جائیں گی۔',cancel:'منسوخ کریں',switching:'بدلا جا رہا ہے...',switch:'مقام بدلیں'},
};

export function AccountSiteSwitcher({organization,site,disabled,onSelect,language='en'}:{organization?:string;site?:string;disabled:boolean;onSelect:(staffId:string)=>Promise<boolean>;language?:'en'|'ar'|'ur'}) {
  const t=copy[language],role=(value:string)=>value==='auditor' && language==='en'?'Read-only auditor':staffIdentityLabel(value,language,true);
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),sending=useRef(false),restoreFocus=useRef(false);
  const [open,setOpen]=useState(false),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[data,setData]=useState<Sites|null>(null),[selected,setSelected]=useState<Site|null>(null),[confirmed,setConfirmed]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(!open && !disabled && restoreFocus.current) {restoreFocus.current=false;trigger.current?.focus();}},[open,disabled]);
  useEffect(()=>{if(!open) return;dialog.current?.showModal();return()=>dialog.current?.close();},[open]);
  useEffect(()=>{
    if(!open) return;let current=true;setLoading(true);setData(null);setError('');
    fetch(`/api/account/sites?page=${page}&pageSize=10`,{credentials:'include'}).then(async response=>{
      const value=await response.json();if(!response.ok) throw new Error(value.error || 'Sites unavailable.');
      if(current) setData(value);
    }).catch(err=>{if(current) setError(err.message);}).finally(()=>{if(current) setLoading(false);});
    return()=>{current=false;};
  },[open,page,refresh]);
  function close() {if(sending.current) return;restoreFocus.current=true;dialog.current?.close();setOpen(false);}
  async function submit() {
    if(sending.current || !selected || !confirmed || disabled) return;
    sending.current=true;setBusy(true);setError('');
    try {if(await onSelect(selected.staffId)) {restoreFocus.current=true;dialog.current?.close();setOpen(false);}else {setSelected(null);setConfirmed(false);setPage(1);setRefresh(n=>n+1);setError('Site selection was not confirmed. Your current session was refreshed.');}}
    catch {setError('Site session unavailable. Close this dialog and recheck your session.');}
    finally {sending.current=false;setBusy(false);}
  }
  return <><button ref={trigger} className="site-label account-site-trigger" aria-label={`${t.change}: ${organization}, ${site}`} disabled={disabled} onClick={()=>{setPage(1);setSelected(null);setConfirmed(false);setError('');setOpen(true);}}><MapPin size={18}/><span><bdi className="account-site-org">{organization}</bdi><span className="account-site-separator"> · </span><bdi className="account-site-name">{site}</bdi></span><ChevronDown size={17}/></button>
    {open && <dialog ref={dialog} className="withdraw-dialog account-site-dialog" aria-labelledby="account-sites-title" onCancel={event=>{event.preventDefault();close();}}>
      <div className="page-header"><h2 id="account-sites-title">{t.title}</h2><div className="actions"><button className="icon-button" title={t.refresh} aria-label={t.refresh} disabled={busy || disabled || loading} onClick={()=>{setSelected(null);setConfirmed(false);setPage(1);setRefresh(n=>n+1);}}><RefreshCw size={18}/></button><button autoFocus className="icon-button" title={t.close} aria-label={t.close} disabled={busy} onClick={close}><X size={20}/></button></div></div>
      {loading && <p role="status">{t.loading}</p>}{error && <p role="alert" className="record-error">{language==='en'?error:error==='Site selection was not confirmed. Your current session was refreshed.'?t.notConfirmed:error==='Site session unavailable. Close this dialog and recheck your session.'?t.sessionUnavailable:t.unavailable}</p>}
      {data && <><div className="account-site-list">{data.items.map(item=><label key={item.staffId} className="account-site-option"><input type="radio" name="account-site" value={item.staffId} checked={selected?.staffId===item.staffId} disabled={busy || disabled || item.current} onChange={()=>{setSelected(item);setConfirmed(false);}}/><span><strong><bdi>{item.organization}</bdi> · <bdi>{item.site}</bdi></strong><small>{role(item.role)}</small></span>{item.current && <span className="account-current"><Check size={17}/>{t.current}</span>}</label>)}</div>
        {!data.total && <p>{t.empty}</p>}<div className="audit-pagination"><span>{t.page} {page} {t.of} {Math.max(1,Math.ceil(data.total/10))}</span><div className="actions"><button className="icon-button direction-arrow" aria-label={t.previous} title={t.previous} disabled={busy || disabled || page<=1} onClick={()=>{setPage(n=>n-1);setSelected(null);setConfirmed(false);}}><ChevronLeft size={18}/></button><button className="icon-button direction-arrow" aria-label={t.next} title={t.next} disabled={busy || disabled || page*10>=data.total} onClick={()=>{setPage(n=>n+1);setSelected(null);setConfirmed(false);}}><ChevronRight size={18}/></button></div></div>
      </>}
      {selected && <><p>{t.switchTo} <strong><bdi>{selected.organization}</bdi> · <bdi>{selected.site}</bdi></strong> {t.as} {role(selected.role)}?</p><label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={busy || disabled} onChange={event=>setConfirmed(event.target.checked)}/><span>{t.confirm}</span></label></>}
      <div className="actions"><button className="button outline" disabled={busy} onClick={close}>{t.cancel}</button><button className="button primary" disabled={busy || disabled || loading || !selected || !confirmed} onClick={()=>void submit()}><MapPin size={18}/>{busy ? t.switching : t.switch}</button></div>
    </dialog>}
  </>;
}
