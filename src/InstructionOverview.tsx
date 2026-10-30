import {useState} from 'react';
import {ArrowRight,MessageCircle,RefreshCw} from 'lucide-react';
import {usePublicationDetail} from './PublicationHistory';
import type {PublicationSummary} from './publication-history';
import {workerLocale} from '../server/languages.mjs';

type Props={draft:{id:string;source:string;state:string;next_version:number;contentExpired?:boolean};publication:PublicationSummary|null;context:string;refresh:number;onResponses:()=>void;onLanguages:()=>void};
export function InstructionOverview({draft,publication,context,refresh,onResponses,onLanguages}:Props){
  const [tick,setTick]=useState(0);
  const read=usePublicationDetail(draft.id,!draft.contentExpired?publication?.id||null:null,context,refresh+tick);
  const snapshot=read.data?.snapshot,metrics=read.data?.metrics;
  const source=publication?(typeof snapshot?.source==='string'?snapshot.source:''):draft.source;
  const question=typeof snapshot?.question==='string'?snapshot.question:'';
  const facts=Array.isArray(snapshot?.facts)?snapshot.facts.filter((value):value is string=>typeof value==='string'):[];
  const languages=Object.entries(snapshot?.languages||{}).filter(([,value])=>typeof value?.text==='string'&&value.text.trim()).map(([code])=>code);
  return <div className="instruction-overview-grid"><section className="panel instruction-content-panel">
    <div className="instruction-section-heading"><h2>{publication?'Published instruction':'Instruction draft'}</h2><span className="instruction-version-label">v{publication?.version??draft.next_version}</span></div>
    {publication&&<p className="instruction-section-note">Sent {new Date(publication.published_at).toLocaleString()}. This is the saved text for this version.</p>}
    {draft.contentExpired?<p>Instruction content is no longer retained. Version and response records remain in History.</p>:publication&&read.loading?<p role="status">Loading the published instruction...</p>:publication&&read.error?<div><p role="alert">The published instruction could not be loaded.</p><button className="button outline" onClick={()=>setTick(n=>n+1)}><RefreshCw size={17}/>Try again</button></div>:<>
      {source?<p className="instruction-body-text">{source}</p>:<p>No instruction text is stored for this version.</p>}
      {!publication&&<p className="instruction-section-note">This draft has not been sent to workers. Prepare it before publishing.</p>}
      {snapshot?.responseMode==='acknowledge'?<div className="instruction-question"><h3>Worker confirmation</h3><p>Workers confirm they have read or listened to this instruction. No question is asked.</p></div>:question&&<div className="instruction-question"><h3>Question for workers</h3><p>{question}</p>{facts.length>0&&<details className="instruction-secondary-details"><summary>Expected key facts</summary><ul>{facts.map((fact,index)=><li key={index}>{fact}</li>)}</ul></details>}</div>}
      {languages.length>0&&<div className="instruction-language-summary"><h3>Instruction languages</h3><div className="instruction-language-list">{languages.map(code=><span key={code}>{workerLocale(code)?.englishName||code.toUpperCase()}</span>)}</div><button className="text-link" onClick={onLanguages}>Review translations and audio<ArrowRight size={16}/></button></div>}
    </>}
  </section><aside className="instruction-overview-aside">
    <section className="panel instruction-response-summary"><h2>Responses</h2>{!publication?<p>No responses yet. Workers can respond after the instruction is sent.</p>:read.loading?<p role="status">Loading response summary...</p>:metrics?<><div className="instruction-response-total"><strong>{metrics.responses}<span> / {metrics.assigned}</span></strong><span>workers responded</span></div><div className="progress" role="progressbar" aria-label="Workers responded" aria-valuemin={0} aria-valuemax={100} aria-valuenow={metrics.completion}><span style={{width:`${metrics.completion}%`}}/></div><dl><div><dt>Match key facts</dt><dd>{metrics.matches}</dd></div>{!!metrics.acknowledged&&<div><dt>Confirmed receipt</dt><dd>{metrics.acknowledged}</dd></div>}<div><dt>Need clarification</dt><dd className={metrics.clarifications?'instruction-attention':''}>{metrics.clarifications}</dd></div>{metrics.unassessed>0&&<div><dt>Awaiting AI check</dt><dd>{metrics.unassessed}</dd></div>}<div><dt>Waiting to respond</dt><dd>{metrics.pending}</dd></div></dl><button className="button outline full" onClick={onResponses}><MessageCircle size={17}/>View responses</button><p className="instruction-section-note">Matching answers reflect the key facts checked, not proof of safe work.</p></>:<p>Response counts are unavailable. Open Responses to try again.</p>}</section>
    <section className="instruction-next-version"><h2>{publication?'Preparing an update?':'Next step'}</h2><p>{publication?`Changes go into draft v${draft.next_version}. The sent instruction and its responses stay unchanged.`:'Use Prepare draft to review the text, prepare translations and choose recipients.'}</p></section>
  </aside></div>;
}
