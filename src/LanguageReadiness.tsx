import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useState} from 'react';
import {ArrowLeft,CheckCircle2,Globe,RefreshCw,TriangleAlert} from 'lucide-react';
import {ProviderStages,type PipelineStatus} from './ProviderStages';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {completeStaffRequest} from './staff-request';

type Check={state:string;evidence:string};
type Language={code:string;name:string;direction:'ltr'|'rtl';generationDefault:boolean;ui:Check;content:Check;translation:Check;speech:Check};
type Readiness={generatedAt:string;mode:string;dataClass:string;realDataAllowed:boolean;pipeline:PipelineStatus;provider:{adapter:string;connection:Check;evidence:string};publication:{id:string;version:number;state:string}|null;languages:Language[];tests:{connection:Check;translation:Check;speech:Check}};

function stateLabel(value:string){return value.replaceAll('_',' ');}
function State({value}:{value:Check}){const staffT=useStaffStaticText();const good=value.state==='ready',bad=value.state==='failed' || value.state==='unavailable';return <span className={`readiness-state readiness-state-${good?'ready':bad?'failed':'pending'}`}><span aria-hidden="true">{good?<CheckCircle2 size={16}/>:<TriangleAlert size={16}/>}</span>{staffT.state(value.state)}</span>;}

export function LanguageReadiness({refresh=0,authority,navigate}:{refresh?:number;authority:StaffRequestAuthority;navigate?:(path:string)=>void}){
  const staffT=useStaffStaticText();
  const {request,current}=useStaffRequest(authority),canInspect=['owner','administrator','supervisor'].includes(authority.session.staffRole || '');
  const [data,setData]=useState<Readiness|null>(null),[loading,setLoading]=useState(true),[running,setRunning]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [tick,setTick]=useState(0);
  useEffect(()=>{const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;setLoading(true);setError('');
    request<Readiness>('/api/language-readiness',undefined,controller.signal).then(value=>{if(live())setData(value);}).catch(reason=>{if(live()){setData(null);setError((reason as Error).message);}}).finally(()=>{if(live())setLoading(false);});return()=>controller.abort();
  },[refresh,tick,request,current]);
  async function run(){if(running || !canInspect || !current())return;setRunning(true);setError('');setMessage('');try{const value=await request<Readiness>('/api/language-readiness/test',{});await completeStaffRequest(value,row=>row as Readiness,result=>{setData(result);setMessage('Stored content and configuration inspected. No provider request was sent.');},current,()=>current() && authority.canMutate());}catch(reason){if(current())setError((reason as Error).message);}finally{if(current())setRunning(false);}}
  return <>{navigate&&<button className="back-link" onClick={()=>navigate('briefings')}><ArrowLeft size={18}/>{staffT("Instructions")}</button>}<div className="page-header"><div><h1>{staffT("Language readiness")}</h1><p>{staffT("Review UI coverage, stored content and provider evidence before launch. Worker UI copy exists in all 15 locales; native-speaker review is still pending.")}</p></div><div className="actions"><button className="icon-button" aria-label={staffT("Refresh language readiness")} title={staffT("Refresh language readiness")} disabled={loading || running} onClick={()=>setTick(value=>value+1)}><RefreshCw size={20}/></button>{canInspect && <button className="button primary" disabled={running || loading} onClick={()=>void run()}><RefreshCw size={18}/>{running?staffT("Inspecting..."):staffT("Inspect readiness")}</button>}</div></div>
    {loading && !data?<p data-page-loading role="status">{staffT("Loading language readiness...")}</p>:error && !data?<p role="alert" className="record-error">{staffT.error(error)}</p>:(data&&<>
      <div className="readiness-banner"><Globe size={24}/><div><strong>{(data.realDataAllowed?staffT("Provider access is enabled."):staffT("Synthetic-only environment."))}</strong><p>{staffT(data.provider.evidence)}</p></div></div>
      {message && <p role="status">{staffT.message(message)}</p>}{error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
      <section className="panel readiness-evidence">
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">{staffT("Language")}</th><th scope="col">{staffT("Text")}</th><th scope="col">{staffT("Voice")}</th><th scope="col">{staffT("Details")}</th></tr></thead>
          <tbody>{[...data.languages].sort((a,b)=>Number(b.generationDefault)-Number(a.generationDefault)).map(language=><tr key={language.code}>
            <th scope="row">{staffT.language(language.code)}</th>
            <td><State value={language.translation}/></td><td><State value={language.speech}/></td>
            <td><details><summary>{staffT("Details")}</summary>
              <p>{staffT("Generation default")} · {staffT(language.generationDefault?"Selected":"Not selected")}</p>
              <p>{staffT("Worker UI")} · <State value={language.ui}/></p>
              <p>{staffT("Stored content")} · <State value={language.content}/></p>
              <p>{staffT(language.content.evidence)}</p>
            </details></td>
          </tr>)}</tbody>
        </table></div>
      </section>
      <section className="readiness-stages"><h2>{staffT("Provider stages")}</h2><ProviderStages pipeline={data.pipeline}/></section>
      <section className="panel readiness-evidence"><h2>{staffT("Production evaluation")}</h2><dl><div><dt>{staffT("Full provider pipeline")}</dt><dd><State value={data.tests.connection}/><span>{staffT(data.tests.connection.evidence)}</span></dd></div><div><dt>{staffT("Translation accuracy")}</dt><dd><State value={data.tests.translation}/><span>{staffT(data.tests.translation.evidence)}</span></dd></div><div><dt>{staffT("Speech quality")}</dt><dd><State value={data.tests.speech}/><span>{staffT(data.tests.speech.evidence)}</span></dd></div></dl><p className="muted">{staffT("Last inspected")} {staffT.date(data.generatedAt)}{staffT(". Configuration and stored content do not verify provider connection, language accuracy or permission to send real worker data.")}</p></section>
    </>)}
  </>;
}
