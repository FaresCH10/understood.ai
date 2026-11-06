import {useEffect,useRef,type ReactNode} from 'react';
import {MoreHorizontal} from 'lucide-react';

export function WorkerAccountMenu({label,view,children}:{label:string;view:string;children:ReactNode}){
 const root=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{if(root.current){root.current.querySelector<HTMLDialogElement>('dialog[open]')?.close();root.current.open=window.matchMedia('(min-width:701px)').matches;}},[view]);
 useEffect(()=>{const media=window.matchMedia('(min-width:701px)');const sync=()=>{if(root.current)root.current.open=media.matches||!!root.current.querySelector('dialog[open]');};sync();media.addEventListener('change',sync);return()=>media.removeEventListener('change',sync);},[]);
 useEffect(()=>{
  const close=(event:PointerEvent)=>{if(!window.matchMedia('(min-width:701px)').matches&&!document.querySelector('dialog[open]')&&event.target instanceof Node&&!root.current?.contains(event.target)&&root.current)root.current.open=false;};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!window.matchMedia('(min-width:701px)').matches&&!document.querySelector('dialog[open]')&&root.current?.open){root.current.open=false;root.current.querySelector('summary')?.focus();}};
  document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
 },[]);
 return <details className="worker-account-menu" ref={root}><summary aria-label={label} title={label}><MoreHorizontal size={22} aria-hidden="true"/></summary><div className="worker-account-options">{children}</div></details>;
}
