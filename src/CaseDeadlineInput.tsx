import {useId} from 'react';
import {civilTimeChoices} from './civil-time';
import {caseText,caseTimeError,type CaseLocale,type CaseTextKey} from './clarification-locale';

export type CaseDeadlineDraft={value:string;occurrence:string};
export function CaseDeadlineInput({label,timezone,draft,readOnly,onChange,required=false,language:locale='en'}:{label:string;timezone:string;draft:CaseDeadlineDraft;readOnly:boolean;required?:boolean;onChange:(value:CaseDeadlineDraft)=>void;language?:CaseLocale}){
  const t=(key:CaseTextKey)=>caseText(locale,key);
  const id=useId();let choices:{instant:string;offset:string}[]=[],error='';
  const edit=(value:string)=>{if(!readOnly&&value!==draft.value)onChange({value,occurrence:''});};
  if(draft.value)try{choices=civilTimeChoices(draft.value,timezone);}catch(reason){error=(reason as Error).message;}
  return <><label className="field"><span>{label} (<bdi>{timezone}</bdi>){required&&<span aria-hidden="true"> *</span>}</span><input type="datetime-local" required={required} aria-required={required} value={draft.value} readOnly={readOnly} aria-invalid={!!error} aria-describedby={error?id:undefined} onInput={event=>edit(event.currentTarget.value)} onChange={event=>edit(event.currentTarget.value)}/></label>
    {error&&<p id={id} role="status" className="record-error">{caseTimeError(locale,error,timezone)}</p>}
    {choices.length===2&&<label className="field">{t('Repeated time')}<select value={draft.occurrence} required disabled={readOnly} onChange={event=>onChange({...draft,occurrence:event.target.value})}><option value="">{t('Choose occurrence')}</option><option value="earlier">{caseText(locale,'First ({offset})',{offset:choices[0].offset})}</option><option value="later">{caseText(locale,'Second ({offset})',{offset:choices[1].offset})}</option></select></label>}
  </>;
}
