import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useRef,useState} from 'react';
import {civilTimeChoices,type CivilTimeChoice} from './civil-time';

export default function CivilTimeField({name,label,timezone,required=false,onChanged}:{name:string;label:string;timezone:string;required?:boolean;onChanged:()=>void}) {
  const staffT=useStaffStaticText();
  const inputRef=useRef<HTMLInputElement>(null);
  const [choices,setChoices]=useState<CivilTimeChoice[]>([]),[error,setError]=useState(''),[occurrence,setOccurrence]=useState('');
  function changed(input:HTMLInputElement) {
    const value=input.value;
    onChanged();setOccurrence('');setError('');setChoices([]);
    input.setCustomValidity('');
    if(value)try {setChoices(civilTimeChoices(value,timezone));}catch(reason){const message=(reason as Error).message;setError(message);input.setCustomValidity(staffT.error(message));}
  }
  useEffect(()=>{inputRef.current?.setCustomValidity(error?staffT.error(error):'');},[error,staffT.locale]);
  const choice=choices.length===1 ? choices[0] : occurrence ? choices[occurrence==='later'?1:0] : null;
  return <div className="civil-time-field">
    <label className="field">{label} ({timezone}{required?'':staffT(", optional")})<input ref={inputRef} name={name} type="datetime-local" min="2000-01-01T00:00" max="9999-12-31T23:59" required={required} onInput={event=>changed(event.currentTarget)} onChange={event=>changed(event.currentTarget)} aria-describedby={`${name}-civil-result`} aria-invalid={!!error}/></label>
    {choices.length===2 && <label className="field">{label} {staffT("occurrence")}<select name={`${name}Occurrence`} value={occurrence} required onChange={event=>{setOccurrence(event.target.value);onChanged();}}>
      <option value="">{staffT("Choose occurrence")}</option>{choices.map((choice,index)=><option key={choice.instant} value={index===0?'earlier':'later'}>{index===0?staffT("First"):staffT("Second")} {staffT("(UTC")}{choice.offset})</option>)}
    </select></label>}
    <p id={`${name}-civil-result`} className={error?'record-error':'civil-time-result'} role={error?'alert':'status'}>{(error?staffT.error(error):choice?staffT("{p0} · UTC{p1}",{p0:choice.instant.replace('T',' ').replace('.000Z',' UTC'),p1:choice.offset}):choices.length===2?staffT("This time occurs twice. Choose an occurrence."):'')}</p>
  </div>;
}
