import {clarificationMessageCopy,type ClarificationExchange} from './clarification-flow';
export function ClarificationMessages({items,language,worker=false,timezone,onRetry,disabled=false}:{items:ClarificationExchange[];language:string;worker?:boolean;timezone?:string;onRetry?:(item:ClarificationExchange)=>void;disabled?:boolean}){
  const t=clarificationMessageCopy(language);
  return <div className="clarification-messages">{items.map(item=>{
    const own=worker?item.kind==='request':item.kind==='explanation',text=own?item.originalText:item.text;
    return <article className="clarification-message" key={item.id}>
      <div className="clarification-message-meta"><strong>{item.kind==='request'?t.worker:worker?t.supervisor:t.you}</strong><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(language,{timeZone:timezone,dateStyle:'short',timeStyle:'short'})}</time></div>
      {text&&<p dir="auto" lang={own?item.originalLanguage??undefined:item.language}>{text}</p>}
      {item.state!=='delivered'&&<p className={`clarification-message-status ${item.state==='failed'?'is-failed':''}`} role={item.state==='failed'?'alert':'status'}>{item.state==='failed'?t.failed:t.preparing}{own&&item.state==='failed'&&onRetry&&<button type="button" className="text-link" disabled={disabled} onClick={()=>onRetry(item)}>{t.retry}</button>}</p>}
    </article>;
  })}</div>;
}
