import {useEffect,useRef} from 'react';
import {Earth,Check} from 'lucide-react';
import {gsap,useGSAP} from './gsap';

type Language='en'|'ar'|'ur';
const languages=[{code:'en',name:'English',description:'English'},{code:'ar',name:'العربية',description:'Arabic'},{code:'ur',name:'اردو',description:'Urdu'}] as const;
export function InterfaceLanguagePicker({value,onChange,disabled=false}:{value:Language;onChange:(language:Language)=>void;disabled?:boolean}){
 const root=useRef<HTMLDetailsElement>(null),panel=useRef<HTMLDivElement>(null);
 const {contextSafe}=useGSAP(()=>{}, {scope:root});
 const title=value==='ar'?'لغة الواجهة':value==='ur'?'انٹرفیس کی زبان':'Interface language';
 function close(focus=false){if(root.current){root.current.open=false;if(focus)root.current.querySelector('summary')?.focus();}}
 const animate=contextSafe(()=>{if(root.current?.open&&panel.current&&!matchMedia('(prefers-reduced-motion: reduce)').matches)gsap.fromTo(panel.current,{opacity:0,y:-5},{opacity:1,y:0,duration:.15,ease:'power2.out',overwrite:true,clearProps:'opacity,transform'});});
 useEffect(()=>{const outside=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))close();};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 return <details ref={root} className="interface-language-picker" onToggle={animate} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close(true);}}}>
  <summary className="icon-button interface-language-trigger" aria-label={title} aria-disabled={disabled} title={`${title}: ${languages.find(language=>language.code===value)?.name}`} onClick={event=>{if(disabled)event.preventDefault();}}><Earth size={21} aria-hidden="true"/></summary>
  <div ref={panel} className="interface-language-panel"><p>{title}</p><div role="group" aria-label={title}>{languages.map(language=><button type="button" key={language.code} disabled={disabled} aria-label={language.name} aria-pressed={value===language.code} className={`interface-language-option ${value===language.code?'selected':''}`} onClick={()=>{onChange(language.code);close(true);}}><span><strong lang={language.code} dir="auto">{language.name}</strong>{language.description!==language.name&&<small lang="en" dir="ltr">{language.description}</small>}</span>{value===language.code?<Check size={17} aria-hidden="true"/>:<span className="interface-language-code" aria-hidden="true">{language.code.toUpperCase()}</span>}</button>)}</div></div>
 </details>;
}
