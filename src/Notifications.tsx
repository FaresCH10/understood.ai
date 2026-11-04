import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useRef,useState} from 'react';
import {gsap,useGSAP} from './gsap';
import './notifications-workspace.css';
import {Bell,BellRing,Check,CheckCheck,ChevronDown,ChevronLeft,ChevronRight,ArrowUpRight,FileText,MessageCircle,Languages,Download,RefreshCw,Trash2} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {usePushNotifications} from './usePushNotifications';
import {useArtifactMutation} from './useArtifactMutation';
import type {ArtifactDefinition} from './useArtifactRequest';
import {checkedArtifactScope} from './artifact-request';
import {notificationRoles} from '../server/notification-input.mjs';
import {checkedNotificationPage,checkedNotificationResult,checkedNotificationReceipt,readPendingNotification,savePendingNotification,clearPendingNotification,type NotificationItem,type NotificationPage,type PendingNotification} from './notification-recovery';

const definition:ArtifactDefinition<PendingNotification,NotificationItem>={endpoint:'/api/notifications',roles:notificationRoles,
  path:value=>`/${encodeURIComponent(value.requestId)}/read`,receiptPath:value=>`/${encodeURIComponent(value.requestId)}/receipt`,payload:()=>({}),
  result:checkedNotificationResult,receipt:checkedNotificationReceipt,clear:clearPendingNotification};
export function Notifications({refresh,navigate,timezone,authority}:{refresh:number;navigate:(path:string)=>void;timezone?:string;authority:StaffRequestAuthority}) {
  const staffT=useStaffStaticText();
  const root=useRef<HTMLDivElement>(null),bulkLock=useRef(false);
  const [bulkBusy,setBulkBusy]=useState(false),[bulkError,setBulkError]=useState('');
  const {request,current}=useStaffRequest(authority),scope=authority.session.staffScope;
  const [recovery]=useState(()=>{try{return {pending:readPendingNotification(sessionStorage,checkedArtifactScope(scope,authority.session,notificationRoles)),error:''};}catch(reason){return {pending:null,error:(reason as Error).message};}});
  const [status,setStatus]=useState('all'),[page,setPage]=useState(1),[tick,setTick]=useState(0);
  const [data,setData]=useState<NotificationPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
  const operation=useArtifactMutation(authority,scope,definition,savePendingNotification,notificationRoles.includes(authority.session.staffRole || ''),result=>{
    window.dispatchEvent(new Event('understood:notifications-changed'));setMessage(`Read status verified: ${result.label}.`);setTick(value=>value+1);
  },recovery.pending);
  const {busy}=operation,blocked=busy || bulkBusy || !!operation.pending.current || !!recovery.error;
  useEffect(()=>{
    if(!recovery.pending)return;
    const controller=new AbortController();queueMicrotask(()=>{if(!controller.signal.aborted)void operation.check(controller.signal);});
    return()=>controller.abort();
  },[operation.api,recovery.pending]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setData(null);setError('');
    const live=()=>current() && !controller.signal.aborted;
    void request(`/api/notifications?${new URLSearchParams({status,page:String(page),pageSize:'20'})}`,undefined,controller.signal)
      .then(value=>{const verified=checkedNotificationPage(value,page,status);if(live())setData(verified);})
      .catch(reason=>{if(live())setError(reason.message);}).finally(()=>{if(live())setLoading(false);});
    return()=>controller.abort();
  },[status,page,tick,refresh,request,current]);
  const markRead=async(item:NotificationItem)=>{
    if(blocked || item.readAt || !current())return;
    setMessage('');await operation.write({requestId:item.id,body:{},item:structuredClone(item)});
  };
  const markAllRead=async()=>{
    if(blocked || bulkLock.current || !current() || !data?.unread)return;
    bulkLock.current=true;setBulkBusy(true);setBulkError('');setMessage('');
    const before=data.asOf;
    try {
      const result=await request<{before:string;readAt:string;marked:number}>('/api/notifications/read-all',{before});
      if(result.before!==before || !Number.isSafeInteger(result.marked) || result.marked<0 || !Number.isFinite(Date.parse(result.readAt)))throw Error('Notification read status could not be confirmed. Refresh and try again.');
      if(current()){
        setMessage('All notifications marked as read.');setPage(1);setTick(value=>value+1);
        window.dispatchEvent(new Event('understood:notifications-changed'));
      }
    }catch(reason){if(current()){setBulkError((reason as Error).message);setTick(value=>value+1);window.dispatchEvent(new Event('understood:notifications-changed'));}}
    finally {bulkLock.current=false;if(current())setBulkBusy(false);}
  };
  useGSAP(()=>{
    const active=root.current?.querySelector<HTMLButtonElement>('.notifications-tab[aria-pressed="true"]');
    const indicator=root.current?.querySelector('.notifications-tab-indicator');
    if(!active || !indicator)return;
    gsap.to(indicator,{x:active.offsetLeft,width:active.offsetWidth,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:0.24,ease:'power2.out',overwrite:true});
  },{scope:root,dependencies:[status,staffT.locale]});
  const groups=new Map<string,NotificationItem[]>();
  const formatDate=(value:string,options:Intl.DateTimeFormatOptions)=>{try{return new Intl.DateTimeFormat(staffT.locale,{...options,timeZone:timezone || 'UTC'}).format(new Date(value));}catch{return new Intl.DateTimeFormat(staffT.locale,{...options,timeZone:'UTC'}).format(new Date(value));}};
  const groupDate=(value:string)=>formatDate(value,{year:'numeric',month:'long',day:'numeric'});
  for(const item of data?.items || []){const key=groupDate(item.occurredAt);groups.set(key,[...(groups.get(key) || []),item]);}
  const openNotification=(item:NotificationItem)=>{if(current() && ['briefings','clarifications','reports','people'].includes(item.destination))navigate(item.destination);};
  const pages=Math.max(1,Math.ceil((data?.total || 0)/20));
  const date=staffT.date;
  return <div className="notifications-workspace" ref={root}>
    <header className="notifications-header">
      <div><div className="notifications-title"><h1>{staffT("Notifications")}</h1>{data && <span className={`notifications-unread-count${data.unread?' has-unread':''}`} aria-label={staffT("{p0} unread",{p0:data.unread})}>{staffT.number(data.unread)}</span>}</div><p>{staffT("Updates from your team, all in one place.")}</p></div>
      <div className="notifications-header-actions"><button className="button primary notifications-mark-all" disabled={loading || blocked || !data?.unread} onClick={()=>void markAllRead()}>{bulkBusy?<RefreshCw className="notifications-spinning" size={17}/>:<CheckCheck size={18}/>}<span>{staffT(bulkBusy?"Marking as read...":"Mark all as read")}</span></button><button className="icon-button" aria-label={staffT("Refresh notifications")} title={staffT("Refresh notifications")} disabled={loading || blocked} onClick={()=>setTick(value=>value+1)}><RefreshCw size={19} className={loading?'notifications-spinning':''}/></button></div>
    </header>
    <div className="notifications-toolbar"><div className="notifications-tabs" role="group" aria-label={staffT("Filter notifications")}>
      {['all','unread'].map(value=><button className="notifications-tab" key={value} type="button" aria-pressed={status===value} disabled={!!busy || bulkBusy} onClick={()=>{setStatus(value);setPage(1);setMessage('');}}>{staffT(value==='all'?'All activity':'Unread')}</button>)}<span className="notifications-tab-indicator" aria-hidden="true"/>
    </div><span className="notifications-history-label">{staffT("Last 90 days")}</span></div>
    {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
    {bulkError && <p role="alert" className="record-error">{staffT.error(bulkError)}</p>}
    {recovery.error && <p role="alert" className="record-error">{staffT.error(recovery.error)}</p>}
    {operation.error && <p role="alert" className="record-error">{staffT.error(operation.error)}</p>}
    {message && <p className="notifications-feedback" role="status"><CheckCheck size={17}/>{staffT.message(message)}</p>}
    {operation.pending.current && <section className="notification-recovery" aria-label={staffT("Saved notification read")}><h2>{staffT("Recover read status")}</h2><p>{staffT(operation.pending.current.item.label)}</p><p><time dateTime={operation.pending.current.item.occurredAt}>{date(operation.pending.current.item.occurredAt)}</time></p><div className="actions"><button className="button outline" disabled={busy} onClick={()=>void operation.check()}><RefreshCw size={18}/>{staffT("Check read status")}</button>{operation.checked && <button className="button primary" disabled={busy} onClick={()=>void operation.write(operation.pending.current!)}><Check size={18}/>{staffT("Retry original mark read")}</button>}</div></section>}
    <section className="notifications-inbox" aria-label={staffT("Site notifications")} aria-busy={loading}>
      {loading ? <p data-page-loading role="status">{staffT("Loading notifications...")}</p> : data?.items.length ? [...groups].map(([day,items])=><section className="notifications-day" key={day} aria-label={day}>
        <h2>{day}</h2><div className="notifications-day-list">{items.map(item=>{
          const Icon=item.destination==='clarifications'?MessageCircle:item.destination==='reports'?Download:item.destination==='people'?Languages:FileText;
          const category=item.destination==='clarifications'?'Follow-up':item.destination==='reports'?'Reports':item.destination==='people'?'Team':'Instructions';
          // Keep stored notification metadata intact; use instruction terminology only in presentation.
          const label=item.label==='Briefing preparation completed'?'Instruction preparation completed':item.label==='Briefing published'?'Instruction published':item.label==='Published briefing withdrawn'?'Published instruction withdrawn':item.label;
          return <article className={`notifications-item${!item.readAt?' is-unread':''}`} key={item.id}>
            <Icon className="notifications-item-icon" size={19} aria-hidden="true"/>
            <div className="notifications-item-content"><div className="notifications-item-meta"><span>{staffT(category)}</span>{!item.readAt && <span className="notifications-new"><i aria-hidden="true"/>{staffT("Unread")}</span>}</div>
              <button type="button" className="notifications-open" disabled={!!busy || bulkBusy} onClick={()=>openNotification(item)}><span>{staffT(label)}</span>{item.subject && <strong>{item.subject}</strong>}</button>
              <time className="notifications-item-time" dateTime={item.occurredAt} title={item.readAt?`${staffT('Marked read')} ${date(item.readAt)}`:date(item.occurredAt)}>{formatDate(item.occurredAt,{hour:'numeric',minute:'2-digit'})}</time>
            </div>
            <div className="notifications-item-actions">{!item.readAt && <button className="notifications-read-button" title={staffT("Mark read: {p0}",{p0:staffT(label)})} aria-label={staffT("Mark read: {p0}",{p0:staffT(label)})} disabled={loading || blocked} onClick={()=>void markRead(item)}><Check size={17}/><span>{staffT("Mark as read")}</span></button>}
              <button className="icon-button" title={staffT("Open {p0}",{p0:staffT(label)})} aria-label={staffT("Open {p0}",{p0:staffT(label)})} disabled={!!busy || bulkBusy} onClick={()=>openNotification(item)}><ArrowUpRight size={19}/></button>
            </div>
          </article>;
        })}</div>
      </section>) : !error && <div className="notifications-empty"><Bell size={30} strokeWidth={1.4} aria-hidden="true"/><h2>{staffT(page>pages?"This page is no longer available.":status==='unread'?"You're all caught up":"A quiet moment")}</h2><p>{staffT(status==='unread'?"You've read every notification. New updates will appear here.":"Team updates and instruction activity will appear here.")}</p>{status==='unread' && <button className="button outline" onClick={()=>{setStatus('all');setPage(1);}}>{staffT("View all activity")}</button>}</div>}
    </section>
    {data && !loading && <div className="audit-pagination notifications-pagination"><span>{staffT.number(data.total)} {staffT("notifications")}{pages>1 && <> · {staffT("Page")} {staffT.number(page)} {staffT("of")} {staffT.number(pages)}</>}</span>{(pages>1 || page>1) && <div className="actions"><button className="icon-button" aria-label={staffT("Previous notification page")} title={staffT("Previous notification page")} disabled={!!busy || bulkBusy || page<=1} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label={staffT("Next notification page")} title={staffT("Next notification page")} disabled={!!busy || bulkBusy || page>=pages} onClick={()=>setPage(value=>value+1)}><ChevronRight size={18}/></button>{page>pages && <button className="button outline" onClick={()=>setPage(1)}>{staffT("First page")}</button>}</div>}</div>}

    <details className="notifications-delivery"><summary><BellRing size={19}/><span>{staffT("Device notifications")}<small>{staffT("Manage push alerts for this browser")}</small></span><ChevronDown className="notifications-disclosure-arrow" size={18}/></summary><div className="notifications-delivery-content">
      {['owner','supervisor'].includes(authority.session.staffRole || '') ? <StaffPushSetup authority={authority}/> : <p>{staffT("Push alerts are sent to owners and supervisors. Your in-app notifications remain available.")}</p>}
    </div></details>
    <p className="notifications-footnote">{staffT("Marking a notification as read does not confirm that an instruction was understood or completed.")}</p>
  </div>;
}

function StaffPushSetup({authority}:{authority:StaffRequestAuthority}) {
  const staffT=useStaffStaticText();
  const push=usePushNotifications({clientContext:authority.session.clientContext || undefined,current:authority.isCurrent,onSessionLost:authority.onSessionLost});
  const status=push.status,configured=status?.adapter==='webpush' && status.configured;
  const date=staffT.date;
  return <section className="panel push-setup" aria-labelledby="staff-push-title">
    <h2 id="staff-push-title"><BellRing size={20} aria-hidden="true"/> {staffT("Push alerts")}</h2>
    <p>{staffT("Get updates while Understood is closed. Delivery depends on your browser and device; your in-app notifications are always available here.")}</p>
    {push.loading && <p data-page-loading role="status">{staffT("Checking push availability...")}</p>}
    {status?.adapter==='synthetic' && <p className="notice notice-amber" role="status">{staffT("Synthetic push adapter: no external push messages are delivered in this environment. In-app notifications remain available.")}</p>}
    {status?.adapter==='disabled' && <p className="muted">{staffT("Push is not configured in this environment. In-app notifications remain available.")}</p>}
    {configured && !push.supported && <p className="muted">{staffT("This browser or connection does not support web push. In-app notifications remain available.")}</p>}
    {push.denied && <p className="notice notice-amber" role="status">{staffT("Push permission is blocked in this browser. Allow notifications in browser settings, then reload. In-app notifications remain available.")}</p>}
    {push.error && <p role="alert" className="record-error">{staffT.error(push.error)}</p>}
    {push.message && <p role="status">{push.message}</p>}
    {configured && push.supported && <div className="actions"><button className="button primary" disabled={push.busy || authority.session.siteState==='archived'} onClick={()=>void push.enable()}>{push.busy?<><RefreshCw size={18}/>{staffT("Saving...")}</>:<><BellRing size={18}/>{staffT("Enable push on this device")}</>}</button></div>}
    {status && status.subscriptions.length>0 && <div className="push-registrations"><h3>{staffT("Registered devices")}</h3><ul>{status.subscriptions.map((registration,index)=><li key={registration.id}><span><strong>{staffT("Device registration")} {index+1}{registration.id===push.thisDeviceId?staffT(" · This device"):''}</strong><small>{staffT("Registered")} <time dateTime={registration.createdAt}>{date(registration.createdAt)}</time> {staffT("· Last checked")} <time dateTime={registration.lastSeenAt}>{date(registration.lastSeenAt)}</time></small></span><button className="icon-button" title={staffT("Remove push registration")} aria-label={staffT("Remove push registration {p0}",{p0:index+1})} disabled={push.busy || authority.session.siteState==='archived'} onClick={()=>void push.remove(registration.id)}><Trash2 size={17}/></button></li>)}</ul><p className="muted">{staffT("Removing a registration stops new push attempts to that browser. Signing out also revokes this session’s registrations.")}</p></div>}
  </section>;
}
