import {useEffect,useId,useRef,type ReactNode} from 'react';
import {MessageCircle,X} from 'lucide-react';
import {keepDialogFocus} from './dialog-focus';
import './instruction-chat.css';

export type InstructionChatCopy={close:string;closeTitle:string;closeBody:string;keepWriting:string;closeConfirm:string};
type Props={title:string;launcher:string;count?:number;countLabel?:string;open:boolean;onOpen:()=>void;onClose:()=>void;dirty?:boolean;dir:'ltr'|'rtl';lang:string;variant:'worker'|'staff';copy:InstructionChatCopy;children:ReactNode};
export function InstructionChat({title,launcher,count=0,countLabel,open,onOpen,onClose,dirty=false,dir,lang,variant,copy,children}:Props){
  const base=useId(),panelId=`${base}-panel`,titleId=`${base}-title`,closeTitleId=`${base}-close-title`,closeBodyId=`${base}-close-body`;
  const launcherRef=useRef<HTMLButtonElement>(null),headingRef=useRef<HTMLHeadingElement>(null),confirmRef=useRef<HTMLDialogElement>(null),wasOpen=useRef(open);
  useEffect(()=>{
    if(open&&!wasOpen.current)headingRef.current?.focus();
    else if(!open&&wasOpen.current)launcherRef.current?.focus();
    wasOpen.current=open;
  },[open]);
  const requestClose=()=>{if(dirty){confirmRef.current?.showModal();return;}onClose();};
  const badge=Math.max(0,count);
  const label=badge&&countLabel?`${launcher} · ${countLabel.replace('{count}',new Intl.NumberFormat(lang).format(badge))}`:launcher;
  return <>
    <button ref={launcherRef} type="button" className={`instruction-chat-launcher is-${variant}`} aria-expanded={open} aria-controls={panelId} aria-label={open?copy.close:label} title={open?copy.close:label} onClick={()=>{if(open)requestClose();else onOpen();}}>
      {open?<X size={20} aria-hidden="true"/>:<MessageCircle size={20} aria-hidden="true"/>}
      <span className="instruction-chat-launcher-label" aria-hidden="true">{open?copy.close:launcher}</span>
      {!open&&badge>0&&<span className="instruction-chat-badge" aria-hidden="true">{new Intl.NumberFormat(lang).format(badge)}</span>}
    </button>
    <section id={panelId} role="dialog" aria-modal="false" aria-labelledby={titleId} className={`instruction-chat is-${variant}`} dir={dir} lang={lang} hidden={!open} onKeyDown={event=>{
      if(event.key!=='Escape'||event.defaultPrevented)return;
      if(event.target instanceof Element&&event.target.closest('dialog[open]'))return;
      event.preventDefault();event.stopPropagation();requestClose();
    }}>
      <header className="instruction-chat-head">
        <h2 id={titleId} ref={headingRef} tabIndex={-1}>{title}</h2>
        <button type="button" className="icon-button" aria-label={copy.close} title={copy.close} onClick={requestClose}><X size={18} aria-hidden="true"/></button>
      </header>
      <div className="instruction-chat-body">{children}</div>
    </section>
    <dialog ref={confirmRef} className="withdraw-dialog" aria-labelledby={closeTitleId} aria-describedby={closeBodyId} onKeyDown={keepDialogFocus}>
      <h2 id={closeTitleId}>{copy.closeTitle}</h2>
      <p id={closeBodyId}>{copy.closeBody}</p>
      <div className="actions"><button type="button" className="button outline" autoFocus onClick={()=>confirmRef.current?.close()}>{copy.keepWriting}</button><button type="button" className="button danger" onClick={()=>{confirmRef.current?.close();onClose();}}>{copy.closeConfirm}</button></div>
    </dialog>
  </>;
}
