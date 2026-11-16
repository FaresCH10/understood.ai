import {useStaffText as useStaffStaticText} from './staff-language';
import {useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {usePublicationDetail} from './PublicationHistory';
import type {PublicationSummary} from './publication-history';

type Draft={id:string;source:string;state:string;next_version:number;revision:number;contentExpired?:boolean;archive?:unknown};
type Props={draft:Draft;publication:PublicationSummary|null;context:string;refresh:number};
export function InstructionOverview({draft,publication,context,refresh}:Props){
  const t=useStaffStaticText(),[tick,setTick]=useState(0);
  const read=usePublicationDetail(draft.id,!draft.contentExpired?publication?.id||null:null,context,refresh+tick);
  const source=publication?read.data?.snapshot.source:draft.source;
  return <section className="panel instruction-content-panel minimal-instruction-overview">
    <h2>{t('Instruction')}</h2>
    {draft.contentExpired?<p>{t('Instruction content is no longer available.')}</p>:publication&&read.loading?<p role="status">{t('Loading instruction...')}</p>:publication&&read.error?<><p role="alert">{t('The instruction could not be loaded.')}</p><button className="button outline" onClick={()=>setTick(n=>n+1)}><RefreshCw size={17}/>{t('Try again')}</button></>:<>
      <p className="instruction-body-text" dir="auto">{typeof source==='string'?source:t('No instruction text is available.')}</p>
      {publication&&<div className="instruction-sent-languages"><h3>{t('Languages sent')}</h3>{read.data?.sentLanguages?.length?<ul>{read.data.sentLanguages.map(code=><li key={code}>{t.language(code)}</li>)}</ul>:<p>{t('No recipients yet.')}</p>}</div>}
    </>}
  </section>;
}
