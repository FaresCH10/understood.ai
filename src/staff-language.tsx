import {createContext,useContext} from 'react';
import {createStaffText} from './staff-static-text';
import {staffUiText,staffUiNumber,staffUiPercent,staffUiDate,staffUiLanguage,staffUiState,staffUiError,staffUiReason,type StaffUiKey} from './staff-ui-locale';
export const StaffLanguageContext=createContext<'en'|'ar'|'ur'>('en');
export const StaffTimezoneContext=createContext('UTC');
export function staffText(language:'en'|'ar'|'ur',text:string){return createStaffText(language)(text);}
export function useStaffText(){const language=useContext(StaffLanguageContext),timezone=useContext(StaffTimezoneContext);return createStaffText(language,timezone);}
export function useStaffUi(timezone='UTC'){
  const language=useContext(StaffLanguageContext),locale=language==='ar'?'ar':'en';
  return {locale,dir:locale==='ar'?'rtl':'ltr',t:(key:StaffUiKey,values:Record<string,string|number>={})=>staffUiText(locale,key,values),
    number:(value:number)=>staffUiNumber(locale,value),percent:(value:number)=>staffUiPercent(locale,value),date:(value:string|null)=>staffUiDate(locale,value,timezone),
    language:(code:string)=>staffUiLanguage(locale,code),state:(value:string)=>staffUiState(locale,value),reason:(value:string)=>staffUiReason(locale,value),error:(error:unknown,fallback:StaffUiKey)=>staffUiError(locale,error,fallback)} as const;
}
