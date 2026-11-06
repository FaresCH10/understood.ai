import {useState} from 'react';
import {Check,ChevronLeft,ChevronRight,Clock3,MessageCircle,RefreshCw,TriangleAlert,HelpCircle,Wrench,MoreHorizontal,Mic} from 'lucide-react';
import {type WorkerUiLanguage,workerUiDirection} from './worker-ui-language';
import {workerNavigationText} from './worker-navigation';
import {workerHelpCopy,workerHelpReasonText,type WorkerHelpReason} from './worker-help-device-copy';
import {languageDirection} from '../server/languages.mjs';
import {workerJourneyText} from './worker-journey-text';

type HelpAssignment={id:string;title:string;language:string;version:number;dueAt?:string|null;supervisorName?:string|null;status?:string;hasSupervisorReply?:boolean};
const reasons=[{id:'unclear',Icon:HelpCircle},{id:'equipment',Icon:Wrench},{id:'problem',Icon:TriangleAlert},{id:'other',Icon:MoreHorizontal}] as const;
export function WorkerHelpHub({language,items,loading,failed,disabled,onOpen,onFollowup,onRefresh,refreshLabel,dueLabel,timezone}:{language:WorkerUiLanguage;items:HelpAssignment[];loading:boolean;failed:boolean;disabled:boolean;onOpen:(id:string,reason?:string)=>void;onFollowup:()=>void;onRefresh:()=>void;refreshLabel:string;dueLabel:string;timezone?:string}){
  const t=workerNavigationText[language],copy=workerHelpCopy[language],journey=workerJourneyText(language),Forward=workerUiDirection(language)==='rtl'?ChevronLeft:ChevronRight;
  const [reason,setReason]=useState<WorkerHelpReason|null>(null);
  return <section className="worker-help-hub" aria-labelledby="worker-help-hub-title">
    <header className="worker-page-heading"><MessageCircle size={26} aria-hidden="true"/><h1 id="worker-help-hub-title">{t.helpTitle}</h1><button type="button" className="icon-button worker-heading-action" title={refreshLabel} aria-label={refreshLabel} disabled={disabled || loading} onClick={onRefresh}><RefreshCw size={20} aria-hidden="true"/></button></header>
    <p className="notice notice-amber worker-help-contact"><TriangleAlert size={18} aria-hidden="true"/>{t.urgent}</p>
    <button type="button" className="worker-inbox-help worker-help-conversations" disabled={disabled} onClick={onFollowup}>
      <MessageCircle size={22} aria-hidden="true"/><span><strong>{t.followup}</strong><small>{copy.followup}</small></span><Forward size={18} aria-hidden="true"/>
    </button>
    <section className="worker-help-reasons" aria-labelledby="worker-help-reasons-title">
      <h2 id="worker-help-reasons-title">{copy.choose}</h2><p>{copy.intro}</p>
      <div className="worker-help-reason-grid" role="group" aria-labelledby="worker-help-reasons-title">
        {reasons.map(({id,Icon})=>{
          const selected=reason===id,ReasonIcon=selected?Check:Icon;
          return <button key={id} type="button" aria-pressed={selected} disabled={disabled} onClick={()=>setReason(selected?null:id)}><ReasonIcon size={18} aria-hidden="true"/><span>{copy[id]}</span></button>;
        })}
      </div>
    </section>
    <section className="worker-inbox-results worker-help-assignments" aria-labelledby="worker-help-list-title" aria-busy={loading}>
      <h2 id="worker-help-list-title">{t.currentBriefings}</h2>
      {loading?<p data-page-loading role="status">{t.loading}</p>:failed?<div className="empty-state" role="alert"><p>{t.listFailed}</p><button type="button" className="button outline" disabled={disabled} onClick={onRefresh}><RefreshCw size={18} aria-hidden="true"/>{refreshLabel}</button></div>:!items.length?<p className="empty-state">{t.empty}</p>:<div className="worker-task-list">{items.map(item=><article className="worker-help-assignment" key={item.id}>
        <div className="worker-task-card-body">
          {item.status==='follow-up'&&<div className="worker-task-card-top"><span className="worker-task-state is-follow-up"><MessageCircle size={16} aria-hidden="true"/>{item.hasSupervisorReply?journey.reply:journey.follow}</span></div>}
          <h3><bdi lang={item.language} dir={languageDirection(item.language)??'ltr'}>{item.title}</bdi></h3>
          <div className="worker-task-card-meta">
            <p className="worker-task-sender">{t.version} v{item.version} · <bdi>{item.language.toUpperCase()}</bdi>{item.supervisorName&&<> · {copy.supervisor}: <bdi>{item.supervisorName}</bdi></>}</p>
            {item.dueAt&&<p className="worker-task-deadline"><Clock3 size={15} aria-hidden="true"/><span>{dueLabel}: <time dateTime={item.dueAt}>{new Date(item.dueAt).toLocaleString(language,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'})}</time>{timezone?` · ${timezone}`:''}</span></p>}
          </div>
        </div>
        <button type="button" className="worker-task-card-action" disabled={disabled} onClick={()=>onOpen(item.id,workerHelpReasonText(language,reason))}><span>{t.ask}</span><Forward size={18} aria-hidden="true"/></button>
      </article>)}</div>}
    </section>
    <p className="worker-help-voice-note"><Mic size={18} aria-hidden="true"/>{copy.voice}</p>
  </section>;
}
