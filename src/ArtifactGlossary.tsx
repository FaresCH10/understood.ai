import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useState} from 'react';
import {BookOpen,ChevronLeft,ChevronRight,RefreshCw,Search} from 'lucide-react';
import {checkedArtifactGlossary,type ArtifactGlossaryPage} from './artifact-glossary';
import {artifactGlossaryDependency} from './artifact-review';
import {ArtifactCopy} from './ArtifactCopy';

export function ArtifactGlossary({target,context,prepared,disabled=false}:{target:string;context:string;prepared:unknown;disabled?:boolean}) {
  const staffT=useStaffStaticText();
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[data,setData]=useState<ArtifactGlossaryPage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const dependency=artifactGlossaryDependency(prepared);
  useEffect(()=>{const controller=new AbortController();let current=true;setData(null);setError('');setLoading(true);
    const timer=setTimeout(()=>{fetch(`/api/glossary?${new URLSearchParams({sourceLanguage:'en',targetLanguage:target,status:'active',search,page:String(page),pageSize:'20'})}`,
      {credentials:'include',cache:'no-store',headers:{'x-client-session-context':context},signal:controller.signal})
      .then(async response=>{if(!response.ok)throw Error();return checkedArtifactGlossary(await response.json(),target,page);})
      .then(value=>{if(current)setData(value);}).catch(()=>{if(current)setError('Current site terminology is unavailable.');}).finally(()=>{if(current)setLoading(false);});},200);
    const timeout=setTimeout(()=>controller.abort(),15000);
    return()=>{current=false;clearTimeout(timer);clearTimeout(timeout);controller.abort();};
  },[target,context,search,page,refresh]);
  return <section className="artifact-glossary" aria-label={staffT("Artifact terminology")}><h2>{staffT("Recorded glossary dependency")}</h2>{dependency?<p>{staffT("Revision")} {staffT.number(dependency.revision)} · <bdi>{dependency.hash}</bdi></p>:<p>{staffT("No glossary dependency recorded for this version.")}</p>}
    <h2>{staffT("Current site terminology")}</h2><p className="muted">{staffT("Current terms are separate from the selected version's recorded dependency.")}</p>
    <div className="filters"><label className="search-box"><Search size={18}/><input aria-label={staffT("Search artifact terminology")} maxLength={80} disabled={disabled} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><button className="icon-button" title={staffT("Refresh artifact terminology")} aria-label={staffT("Refresh artifact terminology")} disabled={loading || disabled} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={20}/></button><a className="button outline" href={disabled?undefined:'#glossary'} aria-disabled={disabled} tabIndex={disabled?-1:undefined}><BookOpen size={18}/>{staffT("Company glossary")}</a></div>
    {loading && <p role="status">{staffT("Loading current terminology...")}</p>}{error && <p role="alert">{staffT.error(error)}</p>}{data && <><div className="table-wrap" role="region" aria-label={staffT("Current site terminology")} tabIndex={0}><table><thead><tr><th scope="col">{staffT("English term")}</th><th scope="col">{staffT("Translation")}</th><th scope="col">{staffT("Version")}</th><th scope="col">{staffT("Copy")}</th></tr></thead><tbody>{data.items.map(row=><tr key={row.id}><td><a href={disabled?undefined:`#glossary/${encodeURIComponent(row.id)}`} aria-disabled={disabled} tabIndex={disabled?-1:undefined} dir="auto">{row.term}</a></td><td lang={target} dir={target==='en'?'ltr':'rtl'}>{(row.content.override || row.content.suggestion||staffT("Not generated"))}<small>{row.content.override?staffT("Company override"):row.content.provenance?.live?staffT("AI suggestion"):row.content.suggestion?staffT("Synthetic suggestion"):staffT("No suggestion")}</small></td><td>v{staffT.number(row.revision)}</td><td><ArtifactCopy key={`${row.id}:${row.revision}`} value={row.content.override || row.content.suggestion || ''} label={staffT("Copy translation of {p0}",{p0:row.term})} context={context} disabled={disabled}/></td></tr>)}</tbody></table></div>{!data.items.length && <p>{staffT("No current terms match this language pair.")}</p>}<div className="audit-pagination"><span>{staffT.number(data.total)} {staffT("terms · Page")} {staffT.number(page)}</span><button className="icon-button" title={staffT("Previous artifact terms")} aria-label={staffT("Previous artifact terms")} disabled={disabled || page<=1} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={20}/></button><button className="icon-button" title={staffT("Next artifact terms")} aria-label={staffT("Next artifact terms")} disabled={disabled || page*20>=data.total} onClick={()=>setPage(n=>n+1)}><ChevronRight size={20}/></button></div></>}
  </section>;
}
