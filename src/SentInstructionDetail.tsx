import {lazy,Suspense,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {useStaffText} from './staff-language';
import {InstructionViewTabs} from './InstructionViewTabs';
import {InstructionOverview} from './InstructionOverview';
import {StaffInstructionFiles} from './InstructionFiles';
const ClarificationsPage=lazy(()=>import('./SimpleClarifications').then(module=>({default:module.ClarificationsPage}))); 
import type {PublicationSummary} from './publication-history';
import type {StaffRequestAuthority} from './useStaffRequest';
import './sent-instruction.css';

type Props={draft:{id:string;title:string;source:string;state:string;next_version:number;revision:number;contentExpired?:boolean};publication:PublicationSummary;context:string;refresh:number;authority:StaffRequestAuthority;navigate:(path:string)=>void};
export function SentInstructionDetail({draft,publication,context,refresh,authority,navigate}:Props){
  const t=useStaffText(),[tab,setTab]=useState<'overview'|'clarifications'>('overview');
  return <div className="instruction-detail sent-instruction-detail">
    <button className="back-link" onClick={()=>navigate('briefings')}><ArrowLeft size={18}/>{t('Instructions')}</button>
    <header className="page-header"><div><h1 dir="auto">{draft.title}</h1><p>{t(publication.state==='published'?'Sent':publication.state==='withdrawn'?'Withdrawn':publication.state==='archived'?'Archived':'Sent')} · <time dateTime={publication.published_at}>{t.date(publication.published_at)}</time></p></div></header>
    <InstructionViewTabs label={t('Instruction views')}>
      <button aria-pressed={tab==='overview'} onClick={()=>setTab('overview')}>{t('Overview')}</button>
      <button aria-pressed={tab==='clarifications'} onClick={()=>setTab('clarifications')}>{t('Clarifications')}</button>
    </InstructionViewTabs>
    {tab==='overview'?<><InstructionOverview draft={draft} publication={publication} context={context} refresh={refresh}/>{!draft.contentExpired&&<StaffInstructionFiles authority={authority} briefingId={draft.id} refresh={refresh}/>}</>:<Suspense fallback={<p role="status">{t('Loading clarifications...')}</p>}><ClarificationsPage key={draft.id+context} briefingId={draft.id} refresh={refresh} authority={authority} navigate={navigate} language={t.locale==='ar'?'ar':'en'}/></Suspense>}
  </div>;
}
