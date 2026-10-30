import {useState} from 'react';
import {Search} from 'lucide-react';
import {searchRoute} from './staff-search';

export function StaffSearchBox({navigate,disabled,canPeople,language='en'}:{navigate:(path:string)=>void;disabled:boolean;canPeople:boolean;language?:'en'|'ar'|'ur'}){
  const [query,setQuery]=useState('');
  const t=language==='ar'?{people:'البحث في التعليمات والأشخاص',briefings:'البحث في التعليمات',peopleHint:'البحث في التعليمات، الأشخاص...',briefingHint:'البحث في التعليمات...',search:'البحث في هذا الموقع'}:language==='ur'?{people:'ہدایات اور افراد تلاش کریں',briefings:'ہدایات تلاش کریں',peopleHint:'ہدایات، افراد تلاش کریں...',briefingHint:'ہدایات تلاش کریں...',search:'اس مقام میں تلاش کریں'}:{people:'Search instructions and people',briefings:'Search instructions',peopleHint:'Search instructions, people...',briefingHint:'Search instructions...',search:'Search this site'};
  const label=canPeople?t.people:t.briefings;
  return <><form className="search-shell staff-search-box" role="search" onSubmit={event=>{event.preventDefault();if(query.trim())navigate(searchRoute(query));}}>
    <input dir="auto" aria-label={label} type="search" placeholder={canPeople?t.peopleHint:t.briefingHint} value={query} onChange={event=>setQuery(event.target.value)} maxLength={80} required disabled={disabled}/>
    <button className="icon-button" type="submit" aria-label={t.search} title={t.search} disabled={disabled}><Search size={19}/></button>
  </form><button className="icon-button staff-search-mobile" aria-label={t.search} title={t.search} disabled={disabled} onClick={()=>navigate(query.trim()?searchRoute(query):'search')}><Search size={21}/></button></>;
}
