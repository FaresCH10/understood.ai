import {ChevronLeft,ChevronRight,MessageCircle,TriangleAlert} from 'lucide-react';
import {type WorkerUiLanguage,workerUiDirection} from './worker-ui-language';
import {workerNavigationText} from './worker-navigation';

type HelpAssignment={id:string;title:string;language:string;version:number};
export function WorkerHelpHub({language,items,loading,failed,disabled,onOpen,onFollowup}:{language:WorkerUiLanguage;items:HelpAssignment[];loading:boolean;failed:boolean;disabled:boolean;onOpen:(id:string)=>void;onFollowup:()=>void}){
  const t=workerNavigationText[language],Forward=workerUiDirection(language)==='rtl'?ChevronLeft:ChevronRight;
  return <section className="worker-help-hub" aria-labelledby="worker-help-hub-title">
    <header className="worker-page-heading"><MessageCircle size={26} aria-hidden="true"/><h1 id="worker-help-hub-title">{t.helpTitle}</h1></header>
    <p className="notice notice-amber worker-help-contact"><TriangleAlert size={22} aria-hidden="true"/>{t.urgent}</p>
    <button type="button" className="button outline full" disabled={disabled} onClick={onFollowup}><MessageCircle size={20} aria-hidden="true"/>{t.followup}</button>
    <h2>{t.currentBriefings}</h2>
    {loading?<p role="status">{t.loading}</p>:failed?<p role="alert">{t.listFailed}</p>:!items.length?<p>{t.empty}</p>:items.map(item=><article className="worker-card" key={item.id}>
      <h2 lang={item.language} dir={item.language==='en'?'ltr':'rtl'}>{item.title}</h2>
      <p>{t.version} v{item.version} · <bdi>{item.language.toUpperCase()}</bdi></p>
      <button type="button" className="button outline full" disabled={disabled} onClick={()=>onOpen(item.id)}><MessageCircle size={20} aria-hidden="true"/>{t.ask}<Forward size={20} aria-hidden="true"/></button>
    </article>)}
  </section>;
}
