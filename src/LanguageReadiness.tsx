import {useEffect,useState} from 'react';
import {CheckCircle2,Globe,RefreshCw,TriangleAlert} from 'lucide-react';
import {ProviderStages,type PipelineStatus} from './ProviderStages';
import {ProviderStageTests,type StageTest} from './ProviderStageTests';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {completeStaffRequest} from './staff-request';

type Check={state:string;evidence:string};
type Language={code:string;name:string;direction:'ltr'|'rtl';generationDefault:boolean;ui:Check;content:Check;translation:Check;speech:Check};
type Readiness={generatedAt:string;mode:string;dataClass:string;realDataAllowed:boolean;pipeline:PipelineStatus;stageTests:StageTest[];provider:{adapter:string;connection:Check;evidence:string};publication:{id:string;version:number;state:string}|null;languages:Language[];tests:{connection:Check;translation:Check;speech:Check}};

function stateLabel(value:string){return value.replaceAll('_',' ');}
function State({value}:{value:Check}){const good=value.state==='ready',bad=value.state==='failed' || value.state==='unavailable';return <span className={`readiness-state readiness-state-${good?'ready':bad?'failed':'pending'}`}><span aria-hidden="true">{good?<CheckCircle2 size={16}/>:<TriangleAlert size={16}/>}</span>{stateLabel(value.state)}</span>;}

export function LanguageReadiness({refresh=0,authority}:{refresh?:number;authority:StaffRequestAuthority}){
  const {request,current}=useStaffRequest(authority),canInspect=['owner','administrator','supervisor'].includes(authority.session.staffRole || '');
  const [data,setData]=useState<Readiness|null>(null),[loading,setLoading]=useState(true),[running,setRunning]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [tick,setTick]=useState(0);
  useEffect(()=>{const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;setLoading(true);setError('');
    request<Readiness>('/api/language-readiness',undefined,controller.signal).then(value=>{if(live())setData(value);}).catch(reason=>{if(live()){setData(null);setError((reason as Error).message);}}).finally(()=>{if(live())setLoading(false);});return()=>controller.abort();
  },[refresh,tick,request,current]);
  async function run(){if(running || !canInspect || !current())return;setRunning(true);setError('');setMessage('');try{const value=await request<Readiness>('/api/language-readiness/test',{});await completeStaffRequest(value,row=>row as Readiness,result=>{setData(result);setMessage('Stored content and configuration inspected. No provider request was sent.');},current,()=>current() && authority.canMutate());}catch(reason){if(current())setError((reason as Error).message);}finally{if(current())setRunning(false);}}
  return <><div className="page-header"><div><h1>Language readiness</h1><p>Review UI coverage, stored content and provider evidence before launch. Worker UI copy exists in all 15 locales; native-speaker review is still pending.</p></div><div className="actions"><button className="icon-button" aria-label="Refresh language readiness" title="Refresh language readiness" disabled={loading || running} onClick={()=>setTick(value=>value+1)}><RefreshCw size={20}/></button>{canInspect && <button className="button primary" disabled={running || loading} onClick={()=>void run()}><RefreshCw size={18}/>{running?'Inspecting...':'Inspect readiness'}</button>}</div></div>
    {loading && !data ? <p role="status">Loading language readiness...</p> : error && !data ? <p role="alert" className="record-error">{error}</p> : data && <>
      <div className="readiness-banner"><Globe size={24}/><div><strong>{data.realDataAllowed?'Provider access is enabled.':'Synthetic-only environment.'}</strong><p>{data.provider.evidence}</p></div></div>
      {message && <p role="status">{message}</p>}{error && <p role="alert" className="record-error">{error}</p>}
      <div className="readiness-grid">{data.languages.map(language=><section className="panel readiness-card" key={language.code}><div className="readiness-card-heading"><div><h2>{language.name}</h2><span>{language.code.toUpperCase()} · {language.direction==='rtl'?'RTL':'LTR'}</span></div></div><dl><div><dt>Generation default</dt><dd>{language.generationDefault?'Selected':'Not selected'}</dd></div><div><dt>Worker UI</dt><dd><State value={language.ui}/></dd></div><div><dt>Stored content</dt><dd><State value={language.content}/></dd></div><div><dt>Translation</dt><dd><State value={language.translation}/></dd></div><div><dt>Speech</dt><dd><State value={language.speech}/></dd></div></dl><p className="muted">{language.content.evidence}</p></section>)}</div>
      <section className="readiness-stages"><h2>Provider stages</h2><ProviderStages pipeline={data.pipeline}/></section>
      <section className="readiness-stages"><h2>Fixed synthetic stage tests</h2><ProviderStageTests tests={data.stageTests}/><p className="muted">Technical results apply only to the current server test configuration and fixed fixtures. They do not certify language accuracy, speech quality or production readiness.</p></section>
      <section className="panel readiness-evidence"><h2>Production evaluation</h2><dl><div><dt>Full provider pipeline</dt><dd><State value={data.tests.connection}/><span>{data.tests.connection.evidence}</span></dd></div><div><dt>Translation accuracy</dt><dd><State value={data.tests.translation}/><span>{data.tests.translation.evidence}</span></dd></div><div><dt>Speech quality</dt><dd><State value={data.tests.speech}/><span>{data.tests.speech.evidence}</span></dd></div></dl><p className="muted">Last inspected {new Date(data.generatedAt).toLocaleString()}. Configuration and stored content do not verify provider connection, language accuracy or permission to send real worker data.</p></section>
    </>}
  </>;
}
