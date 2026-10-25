import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowLeft,Archive,Copy,Database,FileText,HelpCircle,Pencil,Plus,RefreshCw,Save,Search,X,ChevronLeft,ChevronRight} from 'lucide-react';
import {keepDialogFocus} from './dialog-focus';
import {readPendingTemplate,savePendingTemplate,clearPendingTemplate,checkedTemplateResult,checkedTemplateReceipt,type PendingTemplate} from './template-recovery';
import {checkedArtifactScope} from './artifact-request';
import {useArtifactMutation} from './useArtifactMutation';
import {useArtifactRead} from './useArtifactRead';
import type {ArtifactDefinition} from './useArtifactRequest';
import type {StaffRequestAuthority} from './useStaffRequest';
type Content={title:string;description:string;source:string;question:string;facts:string[];askedFacts:string[]};
type Row={id:string;revision:number;status:string;title:string;description:string};
type Page={items:Row[];total:number;page:number;pageSize:number};
type Detail={id:string;revision:number;status:string;selected:{revision:number;status:string;content:Content;created_at:string};history:{items:{revision:number;status:string;created_at:string}[];total:number;page:number;pageSize:number}};
type Kind='create'|'edit'|'archive'|'restore'|'duplicate'|'use';
const empty:Content={title:'',description:'',source:'',question:'',facts:[],askedFacts:[]};
const lines=(value:string)=>value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
const labels:Record<Kind,string>={create:'Create template',edit:'Save new template version',archive:'Archive template',restore:'Restore template',duplicate:'Duplicate template',use:'Use as new draft'};
const definition:ArtifactDefinition<PendingTemplate,ReturnType<typeof checkedTemplateResult>>={endpoint:'/api/templates',path:value=>value.kind==='create'?'':`/${encodeURIComponent(value.templateId!)}/${value.kind}`,result:checkedTemplateResult,receipt:checkedTemplateReceipt,clear:clearPendingTemplate};
export function Templates({id,newTemplate=false,canWrite,scope,navigate,authority,initialUse=false}:{id?:string;newTemplate?:boolean;canWrite:boolean;scope?:string|null;navigate:(path:string)=>void;authority:StaffRequestAuthority;initialUse?:boolean}) {
  const [recovery,setRecovery]=useState(()=>{try {return {pending:scope ? readPendingTemplate(sessionStorage,checkedArtifactScope(scope,authority.session)) : null,error:''};}catch(reason) {return {pending:null,error:(reason as Error).message};}});
  const [search,setSearch]=useState(''),[tab,setTab]=useState<'templates'|'workspace'|'archived'>('templates'),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[selectedId,setSelectedId]=useState<string|null>(null),[previewOpen,setPreviewOpen]=useState(false);
  const status=tab==='archived'?'archived':tab==='workspace'?'all':'active';
  const {data,loading,error}=useArtifactRead<Page>(authority,`/api/templates?${new URLSearchParams({search,status,page:String(page),pageSize:'20'})}`,refresh,!!id || newTemplate || !!recovery.pending || !!recovery.error);
  const selected=useArtifactRead<Detail>(authority,selectedId?`/api/templates/${encodeURIComponent(selectedId)}?page=1`:'/api/templates',0,!selectedId);
  const previewDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(data?.items.length && !data.items.some(row=>row.id===selectedId))setSelectedId(data.items[0].id);},[data,selectedId]);
  useEffect(()=>{const dialog=previewDialog.current;if(previewOpen && dialog && !dialog.open)dialog.showModal();else if(!previewOpen && dialog?.open)dialog.close();},[previewOpen]);
  if(recovery.error) return <div className="templates-view"><h1>Template recovery</h1><p role="alert" className="record-error">{recovery.error}</p></div>;
  if(recovery.pending && scope) return <TemplateRecovery authority={authority} canWrite={canWrite} pending={recovery.pending} scope={scope} navigate={path=>{setRecovery({pending:null,error:''});setRefresh(value=>value+1);navigate(path);}}/>;
  if(id || newTemplate) return <TemplateDetail authority={authority} key={id || 'new'} id={id} canWrite={canWrite} scope={scope} navigate={navigate} initialUse={initialUse}/>;
  const pages=Math.max(1,Math.ceil((data?.total || 0)/20));
  const tabs=[{key:'templates' as const,label:'Templates'},{key:'workspace' as const,label:'My workspace'},{key:'archived' as const,label:'Archived'}];
  const selectedDetail=selected.data;
  const useTemplate=(templateId:string)=>navigate(`templates/${templateId}/use`);
  return <div className="templates-view"><div className="page-header"><div><h1>Briefing templates</h1><p>Every new briefing is processed automatically by AI.</p></div>{canWrite && <button className="button primary" onClick={()=>navigate('templates/new')}><Plus size={20}/>New template</button>}</div>
    <nav className="briefing-status-tabs" aria-label="Template views">{tabs.map(item=><button key={item.key} type="button" aria-pressed={tab===item.key} onClick={()=>{setTab(item.key);setPage(1);setSearch('');}}>{item.label}</button>)}</nav>
    <div className="filters"><label className="search-box"><Search size={19}/><input aria-label="Search templates" maxLength={80} placeholder="Search templates..." value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label><button className="icon-button" title="Refresh templates" aria-label="Refresh templates" onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={18}/></button></div>
    {error && <p role="alert" className="record-error">{error}</p>}{loading ? <p>Loading templates...</p> : data && <div className="templates-workspace">
      <section className="panel templates-list"><h2>{tabs.find(item=>item.key===tab)?.label} ({data.total})</h2>
        <div className="template-card-list">{data.items.map(row=><article className={`template-card ${selectedId===row.id?'selected':''}`} key={row.id}>
          <span className="template-card-icon"><FileText size={24}/></span>
          <button type="button" className="template-card-main" onClick={()=>setSelectedId(row.id)}><strong>{row.title}</strong>{row.description && <small>{row.description}</small>}<span className="template-chips"><i>v{row.revision}</i><i>{row.status}</i></span></button>
          <div className="template-card-actions"><button type="button" className="button outline" onClick={()=>{setSelectedId(row.id);setPreviewOpen(true);}}>Preview</button>{canWrite && row.status==='active' && <button type="button" className="button primary" onClick={()=>useTemplate(row.id)}>Use as new draft</button>}</div>
        </article>)}</div>
        {!data.total && <p>No templates match these filters.</p>}<div className="audit-pagination"><span>Page {page} of {pages} · {data.total} templates</span><button className="icon-button" aria-label="Previous templates" title="Previous templates" aria-disabled={loading || page<=1} onClick={()=>{if(!loading && page>1) setPage(value=>value-1);}}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="Next templates" title="Next templates" aria-disabled={loading || page>=pages} onClick={()=>{if(!loading && page<pages) setPage(value=>value+1);}}><ChevronRight size={18}/></button></div>
      </section>
      <aside className="panel templates-preview">{!selectedId?<p>Select a template to preview it.</p>:selected.loading?<p role="status">Loading template preview...</p>:selected.error?<p role="alert" className="record-error">{selected.error}</p>:selectedDetail?<TemplateIncludes detail={selectedDetail} canWrite={canWrite} onOpen={()=>navigate(`templates/${selectedDetail.id}`)} onPreview={()=>setPreviewOpen(true)} onUse={()=>useTemplate(selectedDetail.id)}/>:<p>Template preview unavailable.</p>}</aside>
    </div>}
    <dialog ref={previewDialog} className="withdraw-dialog template-preview-dialog" aria-labelledby="template-preview-title" onKeyDown={keepDialogFocus} onClose={()=>setPreviewOpen(false)}><div className="withdraw-heading"><h2 id="template-preview-title">{selectedDetail?.selected.content.title || 'Template preview'}</h2><button type="button" autoFocus className="icon-button" aria-label="Close template preview" title="Close template preview" onClick={()=>setPreviewOpen(false)}><X size={20}/></button></div>
      {selected.loading?<p role="status">Loading template preview...</p>:selectedDetail?<TemplatePreviewContent detail={selectedDetail}/>:<p>Template preview unavailable.</p>}
      <div className="actions"><button type="button" className="button outline" onClick={()=>{setPreviewOpen(false);if(selectedDetail)navigate(`templates/${selectedDetail.id}`);}} disabled={!selectedDetail}>Open template</button>{selectedDetail?.status==='active' && canWrite && <button type="button" className="button primary" onClick={()=>{if(selectedDetail){setPreviewOpen(false);useTemplate(selectedDetail.id);}}}>Use as new draft</button>}</div>
    </dialog>
  </div>;
}
function excerpt(value:string,limit=320){return value.length>limit?`${value.slice(0,limit)}…`:value;}
function TemplateIncludes({detail,canWrite,onOpen,onPreview,onUse}:{detail:Detail;canWrite:boolean;onOpen:()=>void;onPreview:()=>void;onUse:()=>void}) {
  const content=detail.selected.content;
  return <><div className="templates-preview-head"><div><h2>{content.title}</h2>{content.description && <p>{content.description}</p>}<span className="template-chips"><i>v{detail.selected.revision}</i><i>{detail.selected.status}</i></span></div><button type="button" className="text-link" onClick={onOpen}>Open template <ChevronRight size={16}/></button></div>
    <h3>This template includes</h3>
    <div className="template-includes">
      <div><span className="template-include-icon"><FileText size={20}/></span><div><strong>Briefing content</strong><p>What to provide as input for this briefing.</p><blockquote>{excerpt(content.source)}</blockquote></div></div>
      <div><span className="template-include-icon"><Database size={20}/></span><div><strong>Key facts to include</strong><p>The main information the briefing should cover.</p><blockquote>{content.facts.length?excerpt(content.facts.join(' · ')):'Automatic key facts are generated from the briefing content.'}</blockquote></div></div>
      <div><span className="template-include-icon"><HelpCircle size={20}/></span><div><strong>Question pattern (v{detail.selected.revision})</strong><p>How the briefing guides understanding and follow-up.</p><blockquote>{content.question || 'Automatic question generated from the key facts.'}</blockquote></div></div>
    </div>
    <div className="actions"><button type="button" className="button outline" onClick={onPreview}>Preview</button>{canWrite && detail.status==='active' && <button type="button" className="button primary" onClick={onUse}>Use as new draft</button>}</div></>;
}
function TemplatePreviewContent({detail}:{detail:Detail}) {
  const content=detail.selected.content;
  return <div className="template-preview-content"><p>{content.description || 'No description.'}</p><strong className="small-heading">Briefing source</strong><p className="source-text">{content.source}</p><strong className="small-heading">Question default</strong><p>{content.question || 'Automatic question'}</p><strong className="small-heading">Key facts default</strong>{content.facts.length?<ul>{content.facts.map((fact,index)=><li key={index}>{fact}</li>)}</ul>:<p>Automatic key facts</p>}</div>;
}
function TemplateRecovery({pending,scope,navigate,authority,canWrite}:{pending:PendingTemplate;scope:string;navigate:(path:string)=>void;authority:StaffRequestAuthority;canWrite:boolean}) {
  const operation=useArtifactMutation(authority,scope,definition,savePendingTemplate,canWrite,(result,value)=>navigate(`${value.kind==='use'?'briefings':'templates'}/${result.id}`),pending);
  const {busy,checked,error}=operation,heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{
    const controller=new AbortController();queueMicrotask(()=>{if(!controller.signal.aborted)void operation.check(controller.signal);});
    return()=>controller.abort();
  },[operation.api]);
  return <div className="templates-view"><h1 ref={heading} tabIndex={-1}>Recover template request</h1><section className="panel"><h2>{labels[pending.kind]}</h2><p>{String(pending.body.title || pending.templateId || '')}</p><p>{busy ? 'Checking saved request...' : checked ? 'No saved receipt was found. You can retry the original confirmed request.' : 'The pending request has not been resolved.'}</p>{error && <p role="alert" className="record-error">{error}</p>}<div className="actions"><button className="button outline" disabled={busy} onClick={()=>void operation.check()}><RefreshCw size={18}/>Check saved request</button>{checked && <button className="button primary" disabled={busy || !canWrite} onClick={()=>void operation.write(pending)}><Save size={18}/>Retry original request</button>}</div></section></div>;
}
function TemplateDetail({id,canWrite,scope,navigate,authority,initialUse=false}:{id?:string;canWrite:boolean;scope?:string|null;navigate:(path:string)=>void;authority:StaffRequestAuthority;initialUse?:boolean}) {
  const [refresh,setRefresh]=useState(0),[version,setVersion]=useState(''),[historyPage,setHistoryPage]=useState(1),[kind,setKind]=useState<Kind|null>(id ? null : 'create');
  const [content,setContent]=useState<Content>(empty),[facts,setFacts]=useState(''),[asked,setAsked]=useState(''),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState('');
  const {data,loading,error:readError}=useArtifactRead<Detail>(authority,`/api/templates/${encodeURIComponent(id || '')}?${new URLSearchParams({page:String(historyPage),...(version ? {version} : {})})}`,refresh,!id || !!kind);
  const heading=useRef<HTMLHeadingElement>(null),formHeading=useRef<HTMLHeadingElement>(null),backFocus=useRef(false),arrivalFocus=useRef(true);
  const operation=useArtifactMutation(authority,scope,definition,savePendingTemplate,canWrite,(result,value)=>{
    if(value.kind==='use')navigate(`briefings/${result.id}`);
    else if(value.kind==='create' || value.kind==='duplicate')navigate(`templates/${result.id}`);
    else {backFocus.current=true;setKind(null);setVersion('');setHistoryPage(1);setRefresh(old=>old+1);setMessage(`Saved template v${result.revision}.`);}
  });
  const {busy,uncertain,error,pending}=operation;
  useEffect(()=>{if(kind) formHeading.current?.focus();else if(backFocus.current) {heading.current?.focus();backFocus.current=false;}},[kind]);
  useEffect(()=>{if(data && !loading && !kind && arrivalFocus.current) {heading.current?.focus();arrivalFocus.current=false;}},[data,loading,kind]);
  const locked=busy || uncertain,editing=!!kind && canWrite,current=data && data.selected.revision===data.revision;
  const full=kind==='create' || kind==='edit',needsTitle=full || kind==='use' || kind==='duplicate';
  const factValues=lines(facts),askedValues=lines(asked),validFacts=factValues.length<=12 && askedValues.length<=6 && [...factValues,...askedValues].every(value=>value.length<=500) && new Set(factValues).size===factValues.length && new Set(askedValues).size===askedValues.length;
  const valid=(!needsTitle || content.title.trim().length>=3) && (!full || (content.source.trim().length>=10 && validFacts));
  function open(next:Kind) {
    if(!canWrite || !operation.api.current())return;
    const value=data?.selected.content || empty;setContent({...value,title:next==='duplicate' ? `${value.title.slice(0,113)} copy` : value.title});setFacts(value.facts.join('\n'));setAsked(value.askedFacts.join('\n'));setConfirmed(false);operation.clearError();setMessage('');setKind(next);
  }
  const autoUse=useRef(initialUse);
  useEffect(()=>{if(autoUse.current && canWrite && data && !loading && !kind){autoUse.current=false;open('use');}},[data,loading,kind,canWrite]);
  async function submit(event:FormEvent) {
    event.preventDefault();if(!kind || !confirmed || !valid || !canWrite) return;
    const body={confirmed:true,...(kind==='create' ? {} : {revision:data!.revision}),...(full ? {...content,facts:factValues,askedFacts:askedValues} : needsTitle ? {title:content.title} : {})};
    await operation.write(pending.current || {requestId:crypto.randomUUID(),kind,templateId:id || null,body});
  }
  function field(key:'title'|'description'|'source'|'question',value:string) {setContent(old=>({...old,[key]:value}));setConfirmed(false);}
  return <div className="templates-view"><button className="back-link" disabled={editing} onClick={()=>navigate('templates')}><ArrowLeft size={18}/>Templates</button><div className="page-header"><div><h1 ref={heading} tabIndex={-1}>{id ? data?.selected.content.title || 'Template' : 'New template'}</h1>{data && <p>v{data.selected.revision} · {data.selected.status}{!current ? ' · Historical version' : ''}</p>}</div>{id && <button className="icon-button" title="Refresh template" aria-label="Refresh template" disabled={editing} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={18}/></button>}</div>
    {readError && <p role="alert" className="record-error">{readError}</p>}{message && <p role="status">{message}</p>}{id && loading && !editing && <p>Loading template...</p>}
    {data && !editing && !loading && <div className="template-detail-grid"><section className="panel"><h2>Template content</h2><p>{data.selected.content.description}</p><strong className="small-heading">Briefing source</strong><p className="source-text">{data.selected.content.source}</p><strong className="small-heading">Question default</strong><p>{data.selected.content.question || 'Automatic question'}</p><strong className="small-heading">Key facts default</strong>{data.selected.content.facts.length ? <ul>{data.selected.content.facts.map((fact,index)=><li key={index}>{fact}</li>)}</ul> : <p>Automatic key facts</p>}{canWrite && <details><summary>Private asked facts default</summary>{data.selected.content.askedFacts.length ? <ul>{data.selected.content.askedFacts.map((fact,index)=><li key={index}>{fact}</li>)}</ul> : <p>Automatic asked facts</p>}</details>}
      {canWrite && current && <div className="actions">{data.status==='active' && <><button className="button primary" onClick={()=>open('use')}><Plus size={18}/>Use as new draft</button><button className="button outline" onClick={()=>open('edit')}><Pencil size={18}/>Edit template</button></>}<button className="button outline" onClick={()=>open('duplicate')}><Copy size={18}/>Duplicate</button><button className="button outline" onClick={()=>open(data.status==='archived' ? 'restore' : 'archive')}>{data.status==='archived' ? <RefreshCw size={18}/> : <Archive size={18}/>} {data.status==='archived' ? 'Restore' : 'Archive'}</button></div>}
    </section><section className="panel"><h2>Version history</h2><div className="row-list">{data.history.items.map(row=><button className="item-row" key={row.revision} aria-pressed={row.revision===data.selected.revision} onClick={()=>setVersion(String(row.revision))}><span className="item-main"><strong>v{row.revision} · {row.status}</strong><small>{new Date(row.created_at).toLocaleString()}</small></span><ChevronRight size={18}/></button>)}</div>{!current && <button className="button outline" onClick={()=>setVersion('')}>Current version</button>}<div className="audit-pagination"><span>Page {historyPage} of {Math.max(1,Math.ceil(data.history.total/20))}</span><button className="icon-button" title="Previous versions" aria-label="Previous versions" disabled={historyPage<=1} onClick={()=>setHistoryPage(value=>value-1)}><ChevronLeft size={18}/></button><button className="icon-button" title="Next versions" aria-label="Next versions" disabled={historyPage*20>=data.history.total} onClick={()=>setHistoryPage(value=>value+1)}><ChevronRight size={18}/></button></div></section></div>}
    {kind && canWrite && <section className="panel"><h2 ref={formHeading} tabIndex={-1}>{labels[kind]}</h2><form className="template-form" onSubmit={event=>void submit(event)}>
      {needsTitle && <label className="field">Title<input required minLength={3} maxLength={120} disabled={locked} value={content.title} onChange={event=>field('title',event.target.value)}/></label>}
      {full && <><label className="field">Description (optional)<textarea rows={2} maxLength={500} disabled={locked} value={content.description} onChange={event=>field('description',event.target.value)}/></label><label className="field">Briefing source<textarea required rows={5} minLength={10} maxLength={4000} disabled={locked} value={content.source} onChange={event=>field('source',event.target.value)}/></label><label className="field">Question default (optional)<textarea rows={2} maxLength={500} disabled={locked} value={content.question} onChange={event=>field('question',event.target.value)}/></label><label className="field">Key facts default (optional)<textarea rows={3} maxLength={6011} disabled={locked} value={facts} onChange={event=>{setFacts(event.target.value);setConfirmed(false);}}/></label><label className="field">Private asked facts default (optional)<textarea rows={3} maxLength={3005} disabled={locked} value={asked} onChange={event=>{setAsked(event.target.value);setConfirmed(false);}}/></label>{!validFacts && <p role="alert" className="record-error">Use distinct facts: at most 12 key facts and 6 asked facts, 500 characters each.</p>}</>}
      {kind==='use' && <div className="notice notice-blue">A new unpublished briefing will be prepared from this template version. No artifacts, assignments or responses are inherited. Unsupported local preparation fails without publication.</div>}
      {kind==='archive' && <div className="notice">Archived templates cannot start new briefings. Existing briefings stay unchanged.</div>}
      {kind==='edit' && <div className="notice notice-blue">This saves a new template version. Earlier versions and existing briefings stay unchanged.</div>}
      <label className="recipient-row publish-confirm"><input type="checkbox" checked={confirmed} disabled={locked} onChange={event=>setConfirmed(event.target.checked)}/><span>Confirm: {labels[kind].toLowerCase()}</span></label>
      {error && <p role="alert" className="record-error">{error}</p>}<div className="actions">{uncertain && <button type="button" className="button outline" disabled={busy} onClick={()=>void operation.check()}><RefreshCw size={18}/>Check saved request</button>}<button className="button primary" disabled={busy || uncertain && !operation.checked || !confirmed || !valid}><Save size={18}/>{busy ? 'Saving...' : uncertain ? 'Retry unchanged request' : labels[kind]}</button><button type="button" className="button outline" disabled={locked} onClick={()=>{if(!id) navigate('templates');else {backFocus.current=true;setKind(null);}}}><X size={18}/>Cancel</button></div>
    </form></section>}{!id && !canWrite && <p>Your role cannot create templates.</p>}
  </div>;
}
