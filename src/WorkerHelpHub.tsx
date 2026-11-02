import {ChevronLeft,ChevronRight,Clock3,MessageCircle,RefreshCw,TriangleAlert} from 'lucide-react';
import {type WorkerUiLanguage,workerUiDirection} from './worker-ui-language';
import {workerNavigationText} from './worker-navigation';

type HelpAssignment={id:string;title:string;language:string;version:number;dueAt?:string|null};
export function WorkerHelpHub({language,items,loading,failed,disabled,onOpen,onFollowup,onRefresh,refreshLabel,dueLabel,timezone}:{language:WorkerUiLanguage;items:HelpAssignment[];loading:boolean;failed:boolean;disabled:boolean;onOpen:(id:string)=>void;onFollowup:()=>void;onRefresh:()=>void;refreshLabel:string;dueLabel:string;timezone?:string}){
  const t=workerNavigationText[language],Forward=workerUiDirection(language)==='rtl'?ChevronLeft:ChevronRight;
  return <section className="worker-help-hub" aria-labelledby="worker-help-hub-title">
    <header className="worker-page-heading"><MessageCircle size={26} aria-hidden="true"/><h1 id="worker-help-hub-title">{t.helpTitle}</h1><button type="button" className="icon-button worker-heading-action" title={refreshLabel} aria-label={refreshLabel} disabled={disabled || loading} onClick={onRefresh}><RefreshCw size={20} aria-hidden="true"/></button></header>
    <p className="notice notice-amber worker-help-contact"><TriangleAlert size={22} aria-hidden="true"/>{t.urgent}</p>
    <button type="button" className="button outline full" disabled={disabled} onClick={onFollowup}><MessageCircle size={20} aria-hidden="true"/>{t.followup}</button>
    <h2>{t.currentBriefings}</h2>
    {loading?<p role="status">{t.loading}</p>:failed?<p role="alert">{t.listFailed}</p>:!items.length?<p>{t.empty}</p>:items.map(item=><article className="worker-card" key={item.id}>
      <h2 lang={item.language} dir={item.language==='en'?'ltr':'rtl'}>{item.title}</h2>
      <p>{t.version} v{item.version} · <bdi>{item.language.toUpperCase()}</bdi></p>
      {item.dueAt && <p className="worker-deadline"><Clock3 size={18} aria-hidden="true"/><span>{dueLabel}: <time dateTime={item.dueAt}>{new Date(item.dueAt).toLocaleString(language,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'})}</time>{timezone?` · ${timezone}`:''}</span></p>}
      <button type="button" className="button outline full" disabled={disabled} onClick={()=>onOpen(item.id)}><MessageCircle size={20} aria-hidden="true"/>{t.ask}<Forward size={20} aria-hidden="true"/></button>
    </article>)}
  </section>;
}
