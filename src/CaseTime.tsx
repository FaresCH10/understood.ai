import {caseTimestamp,type CaseLocale} from './clarification-locale';

export function CaseTime({value,language,timezone='UTC',className}:{value:string;language:CaseLocale;timezone?:string;className?:string}){
  const {text,offset}=caseTimestamp(language,value,timezone);
  const offsetLabel=language==='ar'?'غرينتش':language==='ur'?'گرینچ':'GMT',delta=offset.slice(3);
  return <time dateTime={value} className={className}><bdi>{text}</bdi>{' '}<bdi dir={language==='en'?'ltr':'rtl'} className="case-time-offset">{offsetLabel}{delta&&<>{language==='en'?'':' '}<bdi dir="ltr">{delta}</bdi></>}</bdi></time>;
}
