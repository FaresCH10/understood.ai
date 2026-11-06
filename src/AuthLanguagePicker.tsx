import {Globe} from 'lucide-react';

type LanguageOption<T extends string>={code:T;label:string;dir:'ltr'|'rtl'};

export function AuthLanguagePicker<T extends string>({label,note,name,value,options,disabled,onChange}: {
  label:string;note:string;name:string;value:T;options:readonly LanguageOption<T>[];disabled?:boolean;onChange:(value:T)=>void;
}) {
  const selected=options.find(option=>option.code===value);
  return <details className="auth-language-picker">
    <summary>
      <Globe size={15} aria-hidden="true"/>{label}
      {selected&&<strong lang={selected.code} dir={selected.dir}>{selected.label}</strong>}
    </summary>
    <fieldset className="worker-entry-languages" disabled={disabled}>
      <legend>{label}</legend>
      {options.map(option=><label key={option.code} className={value===option.code?'selected':''}>
        <span lang={option.code} dir={option.dir}>{option.label}</span>
        <input type="radio" name={name} value={option.code} checked={value===option.code} onChange={()=>onChange(option.code)}/>
      </label>)}
    </fieldset>
    <p className="auth-languages-note">{note}</p>
  </details>;
}
