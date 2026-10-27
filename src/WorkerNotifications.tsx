import {useEffect,useRef,useState} from 'react';
import {Bell,BellRing,Check,ChevronLeft,ChevronRight,RefreshCw,Trash2} from 'lucide-react';
import {usePushNotifications} from './usePushNotifications';
import {checkedWorkerNotificationItem,checkedWorkerNotificationPage,workerNotificationRoute,workerNotificationText,type WorkerNotificationItem,type WorkerNotificationPage} from './worker-notifications';
import {workerUiDirection,type WorkerUiLanguage} from './worker-ui-language';
import type {PageSession} from './session-state';

type Props={session:PageSession;language:WorkerUiLanguage;navigate:(path:string)=>void;refresh:number;current:()=>boolean;onSessionLost:()=>void;timezone?:string};

export function WorkerNotifications({session,language,navigate,refresh,current,onSessionLost,timezone}:Props) {
  const text=workerNotificationText[language],context=session.clientContext || '';
  const latest=useRef({current,onSessionLost});latest.current={current,onSessionLost};
  const push=usePushNotifications({clientContext:session.clientContext,current,onSessionLost});
  const [status,setStatus]=useState<'all'|'unread'>('all'),[page,setPage]=useState(1),[tick,setTick]=useState(0);
  const [data,setData]=useState<WorkerNotificationPage|null>(null),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false);
  const [busy,setBusy]=useState(false),[actionFailed,setActionFailed]=useState(false);
  const request=async(path:string,init:RequestInit={},signal?:AbortSignal):Promise<any>=>{
    if(!/^[a-f0-9]{64}$/.test(context) || !latest.current.current())throw Error('Session context changed');
    const response=await fetch(path,{...init,credentials:'include',cache:'no-store',redirect:'error',
      headers:{...(init.body!==undefined?{'content-type':'application/json'}:{}),'x-client-session-context':context},
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
    let body:any;
    try {body=await response.json();}catch{throw Error('Notification response could not be read');}
    if(response.status===401 || [403,409].includes(response.status)){latest.current.onSessionLost();throw Error('Session context changed');}
    if(!latest.current.current())throw Error('Session context changed');
    if(!response.ok)throw Error(typeof body?.error==='string' && body.error.length<=300?body.error:'Notification request failed');
    return body;
  };
  useEffect(()=>{
    if(!/^[a-f0-9]{64}$/.test(context) || !latest.current.current())return;
    const controller=new AbortController();
    setLoading(true);setFailed(false);
    void request(`/api/notifications?${new URLSearchParams({status,page:String(page),pageSize:'10'})}`,{},controller.signal)
      .then(value=>{if(!controller.signal.aborted)setData(checkedWorkerNotificationPage(value));})
      .catch(()=>{if(!controller.signal.aborted && latest.current.current())setFailed(true);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[status,page,tick,refresh,context]);
  const pages=Math.max(1,Math.ceil((data?.total || 0)/10));
  useEffect(()=>{if(data && page>pages)setPage(pages);},[data,page,pages]);
  const date=(value:string)=>new Intl.DateTimeFormat(language,{timeZone:timezone || 'UTC',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const markRead=async(item:WorkerNotificationItem)=>{
    if(busy || item.readAt || !latest.current.current())return;
    setBusy(true);setActionFailed(false);
    try {
      const saved=checkedWorkerNotificationItem(await request(`/api/notifications/${encodeURIComponent(item.id)}/read`,{method:'POST',body:'{}'}));
      if(!latest.current.current())return;
      window.dispatchEvent(new Event('understood:notifications-changed'));
      if(status==='unread'){setLoading(true);setTick(value=>value+1);}
      setData(currentData=>{
        if(!currentData)return currentData;
        if(status==='unread')return {...currentData,items:currentData.items.filter(row=>row.id!==saved.id),total:Math.max(0,currentData.total-1),unread:Math.max(0,currentData.unread-1)};
        return {...currentData,items:currentData.items.map(row=>row.id===saved.id?saved:row),unread:Math.max(0,currentData.unread-1)};
      });
    } catch {if(latest.current.current())setActionFailed(true);}
    finally {setBusy(false);}
  };
  const open=(item:WorkerNotificationItem)=>{
    if(!latest.current.current())return;
    if(!item.readAt)void markRead(item);
    navigate(workerNotificationRoute(item));
  };
  const Forward=workerUiDirection(language)==='rtl'?ChevronLeft:ChevronRight,Back=workerUiDirection(language)==='rtl'?ChevronRight:ChevronLeft;
  const pushConfigured=push.status?.adapter==='webpush' && push.status.configured;
  return <section className="worker-notifications" aria-labelledby="worker-notifications-title">
    <div className="worker-notifications-head"><div><h1 id="worker-notifications-title">{text.title}</h1><p className="worker-subtitle">{text.subtitle}</p></div><button type="button" className="icon-button" aria-label={text.refresh} title={text.refresh} disabled={loading || busy} onClick={()=>setTick(value=>value+1)}><RefreshCw size={20}/></button></div>
    <div className="segmented worker-notification-tabs">
      <button type="button" className={status==='all'?'selected':''} aria-pressed={status==='all'} disabled={busy} onClick={()=>{setStatus('all');setPage(1);}}>{text.all}</button>
      <button type="button" className={status==='unread'?'selected':''} aria-pressed={status==='unread'} disabled={busy} onClick={()=>{setStatus('unread');setPage(1);}}>{text.unread}{data?` (${data.unread})`:''}</button>
    </div>
    {actionFailed && <p className="notice notice-amber" role="alert">{text.markFailed}</p>}
    <section className="notification-list" aria-label={text.title} aria-busy={loading}>
      {loading ? <p role="status">{text.loading}</p> : failed ? <p className="notice notice-amber" role="alert">{text.loadFailed}</p> : data?.items.length ? data.items.map(item=>{
        const label=text.kinds[item.kind] || text.kindOther,read=!!item.readAt;
        return <article className="notification-row" key={item.id}>
          <Bell size={20} aria-hidden="true"/>
          <div className="item-main"><strong>{label}</strong><small><time dateTime={item.occurredAt}>{date(item.occurredAt)}</time> · {read?text.read:text.unreadState}</small></div>
          <div className="actions"><button type="button" className="icon-button" title={`${text.open}: ${label}`} aria-label={`${text.open}: ${label}`} disabled={busy} onClick={()=>open(item)}><Forward size={18}/></button>
            <button type="button" className="icon-button" title={`${text.markRead}: ${label}`} aria-label={`${text.markRead}: ${label}`} disabled={loading || busy || read} onClick={()=>void markRead(item)}><Check size={18}/></button></div>
        </article>;
      }) : !failed && <p className="empty-state">{status==='unread'?text.emptyUnread:text.empty}</p>}
    </section>
    {data && !loading && <div className="worker-inbox-pagination"><span role="status">{text.page} {page} / {pages} · {data.total}</span><div className="actions">
      <button type="button" className="icon-button" aria-label={text.previous} title={text.previous} disabled={loading || busy || page<=1} onClick={()=>setPage(value=>value-1)}><Back size={20}/></button>
      <button type="button" className="icon-button" aria-label={text.next} title={text.next} disabled={loading || busy || page>=pages} onClick={()=>setPage(value=>Math.min(value+1,pages))}><Forward size={20}/></button>
    </div></div>}
    <details className="worker-card worker-push-setup">
      <summary><BellRing size={20} aria-hidden="true"/>{text.pushTitle}</summary>
      <p>{text.pushBody}</p>
      {push.loading && <p role="status">{text.pushLoading}</p>}
      {push.status?.adapter==='synthetic' && <p className="notice notice-amber" role="status">{text.pushSynthetic}</p>}
      {push.status && !pushConfigured && push.status.adapter!=='synthetic' && <p className="muted">{text.pushDisabled}</p>}
      {pushConfigured && !push.supported && <p className="muted">{text.pushUnsupported}</p>}
      {push.denied && <p className="notice notice-amber" role="status">{text.pushDenied}</p>}
      {push.notice && <p className="notice notice-green" role="status">{push.notice==='enabled'?text.pushEnabled:text.pushRemoved}</p>}
      {push.error && <p className="notice notice-amber" role="alert">{push.status?text.pushSaveFailed:text.pushFailed}</p>}
      {pushConfigured && push.supported && <div className="actions"><button type="button" className="button primary" disabled={push.busy} onClick={()=>void push.enable()}>{push.busy?text.pushBusy:<><BellRing size={18} aria-hidden="true"/>{text.pushEnable}</>}</button></div>}
      {push.status && push.status.subscriptions.length>0 && <div className="push-registrations"><h3>{text.pushRegistered}</h3><ul>{push.status.subscriptions.map((registration,index)=><li key={registration.id}>
        <span><strong>{registration.id===push.thisDeviceId?text.pushThisDevice:`#${index+1}`}</strong><small><time dateTime={registration.createdAt}>{date(registration.createdAt)}</time></small></span>
        <button type="button" className="icon-button" title={text.pushRemove} aria-label={`${text.pushRemove} ${index+1}`} disabled={push.busy} onClick={()=>void push.remove(registration.id)}><Trash2 size={17}/></button>
      </li>)}</ul></div>}
      <p className="muted">{text.pushNoGuarantee}</p>
    </details>
  </section>;
}
