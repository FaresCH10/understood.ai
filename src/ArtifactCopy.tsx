import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useRef,useState} from 'react';
import {Copy} from 'lucide-react';
import {copyArtifactText} from './artifact-review';

export function ArtifactCopy({value,label,context,disabled=false}:{value:string;label:string;context:string;disabled?:boolean}) {
  const staffT=useStaffStaticText();
  const [busy,setBusy]=useState(false),[result,setResult]=useState<'copied'|'failed'|null>(null);
  const button=useRef<HTMLButtonElement>(null),alive=useRef(true),sending=useRef(false),identity=useRef({value,context,disabled});identity.current={value,context,disabled};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{setResult(null);},[value,context,disabled]);
  async function copy(){
    if(sending.current || disabled || !value)return;sending.current=true;setBusy(true);setResult(null);
    const current=()=>alive.current && button.current?.isConnected===true && identity.current.value===value && identity.current.context===context && !identity.current.disabled;
    try{await copyArtifactText(value,context,async()=>{
      const response=await fetch('/api/session',{credentials:'include',cache:'no-store',headers:{'x-client-session-context':context},signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('Session unavailable');return response.json();
    },text=>navigator.clipboard.writeText(text),current);if(current())setResult('copied');}
    catch{if(current())setResult('failed');}finally{sending.current=false;if(alive.current)setBusy(false);}
  }
  return <span className="artifact-copy"><button ref={button} type="button" className="icon-button" title={label} aria-label={label} disabled={disabled || busy || !value} onClick={()=>void copy()}><Copy size={18}/></button>{result && <span role={result==='failed'?'alert':'status'}>{result==='copied'?staffT("Copied"):staffT("Could not copy")}</span>}</span>;
}
