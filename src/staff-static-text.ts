import {staffStaticArabic} from './staff-static-ar.ts';
import {staffUiDate,staffUiNumber,staffUiPercent,staffUiLanguage,type StaffUiLocale} from './staff-ui-locale.ts';

type Values=Record<string,string|number|boolean|null|undefined>;
const arabic:Readonly<Record<string,string>>=staffStaticArabic;
const placeholder=/\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
function interpolate(locale:StaffUiLocale,text:string,values:Values){
  return text.replace(placeholder,(token,name:string)=>values[name]==null?token:typeof values[name]==='number'?staffUiNumber(locale,values[name] as number):String(values[name]));
}
// These patterns apply only at explicit UI-message boundaries, never to stored content.
const patterns=Object.keys(arabic).filter(key=>/\{[a-zA-Z][a-zA-Z0-9]*\}/.test(key)).map(key=>{
  const names:string[]=[];
  const source=key.split(/(\{[a-zA-Z][a-zA-Z0-9]*\})/).map(part=>{
    if(/^\{/.test(part)){names.push(part.slice(1,-1));return '(.+?)';}
    return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }).join('');
  return {key,names,expression:new RegExp('^'+source+'$','s')};
});
export function staffStaticText(locale:StaffUiLocale,text:string,values:Values={}){
  if(locale==='en')return interpolate(locale,text,values);
  if(Object.hasOwn(arabic,text))return interpolate(locale,arabic[text],values);
  return interpolate(locale,text,values);
}
export function staffStaticMessage(locale:StaffUiLocale,text:string,timezone='UTC'){
  if(Object.hasOwn(arabic,text))return staffStaticText(locale,text);
  if(text.length<=3000)for(const pattern of patterns){
    const match=pattern.expression.exec(text);
    if(match){
      const values=Object.fromEntries(pattern.names.map((name,index)=>[name,match[index+1]]));
      if(pattern.key==='Access link issued. Expires {p0}.'&&/^\d{4}-\d{2}-\d{2}T/.test(values.p0))values.p0=staffUiDate(locale,values.p0,timezone);
      return staffStaticText(locale,pattern.key,values);
    }
  }
  return locale==='en'?text:'';
}
export function createStaffText(language:'en'|'ar'|'ur',timezone='UTC'){
  const locale:StaffUiLocale=language==='ar'?'ar':'en';
  return Object.assign((text:string,values:Values={})=>staffStaticText(locale,text,values),{
    locale,
    language:(code:string)=>staffUiLanguage(locale,code),
    state:(value:string)=>{
      const label=value.replaceAll('_',' ');
      if(locale==='en')return label;
      const title=label[0]?.toUpperCase()+label.slice(1);
      return Object.hasOwn(arabic,label)?arabic[label]:Object.hasOwn(arabic,title)?arabic[title]:arabic['Status unavailable'];
    },
    technical:(value:string)=>{
      const label=value.replaceAll('_',' '),title=label[0]?.toUpperCase()+label.slice(1);
      if(locale==='en')return label;
      return Object.hasOwn(arabic,value)?arabic[value]:Object.hasOwn(arabic,title)?arabic[title]:value;
    },
    money:(cents:number)=>new Intl.NumberFormat(locale==='ar'?'ar-LB':'en-US',{style:'currency',currency:'USD'}).format(cents/100),
    date:(value:string|null,zone=timezone)=>staffUiDate(locale,value,zone),
    number:(value:number)=>staffUiNumber(locale,value),
    percent:(value:number)=>staffUiPercent(locale,value),
    days:(value:number)=>new Intl.NumberFormat(locale==='ar'?'ar-LB':'en-GB',{style:'unit',unit:'day',unitDisplay:'long'}).format(value),
    message:(value:string)=>staffStaticMessage(locale,value,timezone)||staffStaticText(locale,'Check the current status and details.'),
    error:(value:unknown)=>staffStaticMessage(locale,value instanceof Error?value.message:typeof value==='string'?value:'',timezone)||staffStaticText(locale,'The action could not be completed. Check the current status before trying again.')
  });
}
