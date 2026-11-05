import {useState} from 'react';
import {ChevronLeft,ChevronRight,Clock3,MessageCircle,RefreshCw,TriangleAlert,HelpCircle,Wrench,MoreHorizontal,Mic} from 'lucide-react';
import {type WorkerUiLanguage,workerUiDirection} from './worker-ui-language';
import {workerNavigationText} from './worker-navigation';
import {workerHelpCopy,workerHelpReasonText,type WorkerHelpReason} from './worker-help-device-copy';
import {languageDirection} from '../server/languages.mjs';

type HelpAssignment={id:string;title:string;language:string;version:number;dueAt?:string|null;supervisor?:string|null};
const reasons=[{id:'unclear',Icon:HelpCircle},{id:'equipment',Icon:Wrench},{id:'problem',Icon:TriangleAlert},{id:'other',Icon:MoreHorizontal}] as const;
export function WorkerHelpHub({language,items,loading,failed,disabled,onOpen,onFollowup,onRefresh,refreshLabel,dueLabel,timezone}:{language:WorkerUiLanguage;items:HelpAssignment[];loading:boolean;failed:boolean;disabled:boolean;onOpen:(id:string,reason?:string)=>void;onFollowup:()=>void;onRefresh:()=>void;refreshLabel:string;dueLabel:string;timezone?:string}){
  const t=workerNavigationText[language],copy=workerHelpCopy[language],Forward=workerUiDirection(language)==='rtl'?ChevronLeft:ChevronRight;
  const [reason,setReason]=useState<WorkerHelpReason|null>(null);
  return <section className="worker-help-hub" aria-labelledby="worker-help-hub-title">
    <header className="worker-page-heading"><MessageCircle size={26} aria-hidden="true"/><h1 id="worker-help-hub-title">{t.helpTitle}</h1><button type="button" className="icon-button worker-heading-action" title={refreshLabel} aria-label={refreshLabel} disabled={disabled || loading} onClick={onRefresh}><RefreshCw size={20} aria-hidden="true"/></button></header>
    <p className="notice notice-amber worker-help-contact"><TriangleAlert size={20} aria-hidden="true"/>{t.urgent}</p>
    <section className="worker-help-reasons" aria-labelledby="worker-help-reasons-title">
      <h2 id="worker-help-reasons-title">{copy.choose}</h2><p>{copy.intro}</p>
      <div className="worker-help-reason-grid">{reasons.map(({id,Icon})=><button key={id} type="button" className={reason===id?'selected':''} aria-pressed={reason===id} disabled={disabled} onClick={()=>setReason(reason===id?null:id)}><Icon size={20} aria-hidden="true"/><span>{copy[id]}</span></button>)}</div>
    </section>
    <button type="button" className="worker-help-conversations" disabled={disabled} onClick={onFollowup}><MessageCircle size={22} aria-hidden="true"/><span><strong>{t.followup}</strong><small>{copy.followup}</small></span><Forward size={21} aria-hidden="true"/></button>
    <h2 className="worker-help-list-title">{t.currentBriefings}</h2>
    {loading?<p data-page-loading role="status">{t.loading}</p>:failed?<div className="worker-help-feedback" role="alert"><p>{t.listFailed}</p><button type="button" className="button outline" disabled={disabled} onClick={onRefresh}><RefreshCw size={18} aria-hidden="true"/>{refreshLabel}</button></div>:!items.length?<p className="empty-state">{t.empty}</p>:items.map(item=><article className="worker-card" key={item.id}>
      <h2 lang={item.language} dir={languageDirection(item.language)??'ltr'}>{item.title}</h2>
      <p>{t.version} v{item.version} · <bdi>{item.language.toUpperCase()}</bdi>{item.supervisor&&<> · {copy.supervisor}: <bdi>{item.supervisor}</bdi></>}</p>
      {item.dueAt && <p className="worker-deadline"><Clock3 size={18} aria-hidden="true"/><span>{dueLabel}: <time dateTime={item.dueAt}>{new Date(item.dueAt).toLocaleString(language,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'})}</time>{timezone?` · ${timezone}`:''}</span></p>}
      <button type="button" className="button outline full" disabled={disabled} onClick={()=>onOpen(item.id,workerHelpReasonText(language,reason))}><MessageCircle size={20} aria-hidden="true"/>{t.ask}<Forward size={20} aria-hidden="true"/></button>
    </article>)}
    <p className="worker-help-voice-note"><Mic size={18} aria-hidden="true"/>{copy.voice}</p>
  </section>;
}
