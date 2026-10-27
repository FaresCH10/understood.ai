import {GENERATION_LANGUAGE_CODES,WORKER_LOCALES} from '../server/languages.mjs';
import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Building2,Globe,RefreshCw,Save,TriangleAlert,Pencil,ChevronLeft,ChevronRight,Search} from 'lucide-react';
import {OrganizationSites} from './OrganizationSites';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {completeStaffRequest} from './staff-request';
import {usePolicySettings,type PolicyDefinition} from './usePolicySettings';
import {verifyPolicyAcknowledgement} from './policy-state';
import {checkedWorkspaceContext,readSettingsChange,storeSettingsChange,clearSettingsChange,checkedSettingsReceipt,type SettingsChange} from './workspace-settings-state';
type SiteContact={id:string;name:string;role:string;available:boolean};
export type WorkspaceContext={organization:{id:string;name:string;supportEmail:string;revision:number};site:{id:string;name:string;timezone:string;revision:number;generationLanguages:string[];primaryContact:SiteContact|null;deputyContact:SiteContact|null};canWrite:boolean;canWriteSite:boolean;recoveryScope:string|null};
const initials=(name:string)=>name.split(' ').filter(Boolean).map(word=>word[0]).join('').slice(0,2).toUpperCase() || '?';
const roleLabel=(role:string|null|undefined)=>({owner:'Owner',administrator:'Administrator',supervisor:'Supervisor',auditor:'Auditor'} as Record<string,string>)[role || ''] || 'Staff';
function SettingsForm({authority,kind,context,onSaved,onLocked,disabled}:{authority:StaffRequestAuthority;kind:'organization'|'site';context:WorkspaceContext;onSaved:()=>void;onLocked:(value:boolean)=>void;disabled:boolean}) {
  const [loadedContext,setLoadedContext]=useState(context);
  const current=loadedContext[kind],second=kind==='organization' ? loadedContext.organization.supportEmail : loadedContext.site.timezone;
  const [editing,setEditing]=useState(false),[name,setName]=useState(current.name),[value,setValue]=useState(second),[confirmed,setConfirmed]=useState(false);
  const [languages,setLanguages]=useState(context.site.generationLanguages);
  const [primary,setPrimary]=useState(context.site.primaryContact),[deputy,setDeputy]=useState(context.site.deputyContact),[contactsReady,setContactsReady]=useState(false);
  const {current:isCurrent}=useStaffRequest(authority);
  const policy=useMemo<PolicyDefinition<{canWrite:boolean;recoveryScope:string|null;context:WorkspaceContext},SettingsChange>>(()=>({
    endpoint:`/api/settings/${kind}`,loadEndpoint:'/api/settings',receiptEndpoint:`/api/settings/${kind}/receipts`,
    validate(raw,scope){const value=checkedWorkspaceContext(raw,scope);return {context:value,recoveryScope:value.recoveryScope,canWrite:kind==='organization'?value.canWrite:value.canWriteSite};},
    read:(storage,scope)=>readSettingsChange(storage,scope,kind),
    store:(storage,scope,change)=>storeSettingsChange(storage,scope,kind,change),
    clear:(storage,scope,id,change)=>clearSettingsChange(storage,scope,kind,id,change),
    acknowledgement:verifyPolicyAcknowledgement,receipt:(value,change)=>checkedSettingsReceipt(value,kind,change)
  }),[kind]);
  const {pending,saving:busy,loading,error,saved,refresh:checkReceipt,save}=usePolicySettings(authority,policy,(data,restored)=>{
    setLoadedContext(data.context);const baseline=data.context[kind];setName(restored?.name ?? baseline.name);
    setValue(kind==='organization'?restored?.supportEmail ?? data.context.organization.supportEmail:restored?.timezone ?? data.context.site.timezone);
    setLanguages(restored?.generationLanguages ?? data.context.site.generationLanguages);
    setPrimary(data.context.site.primaryContact);setDeputy(data.context.site.deputyContact);
    setConfirmed(false);if(restored)setEditing(true);
  });
  const callbacks=useRef({onSaved,onLocked});callbacks.current={onSaved,onLocked};
  const locked=busy || !!pending || loading,changed=!!pending || name.trim()!==current.name || value.trim()!==second || (kind==='site' && (JSON.stringify(languages)!==JSON.stringify(loadedContext.site.generationLanguages) || (primary?.id ?? null)!==(loadedContext.site.primaryContact?.id ?? null) || (deputy?.id ?? null)!==(loadedContext.site.deputyContact?.id ?? null)));
  useEffect(()=>{if(isCurrent())callbacks.current.onLocked(editing || !!pending || busy);},[editing,pending,busy,isCurrent]);
  useEffect(()=>{if(saved && isCurrent() && authority.canMutate()){setEditing(false);setConfirmed(false);callbacks.current.onLocked(false);callbacks.current.onSaved();}},[saved,isCurrent]);
  const contactInvalid=kind==='site' && (!!primary && !primary.available || !!deputy && (!deputy.available || !primary || deputy.id===primary.id));
  const zones=[...new Set(['UTC',loadedContext.site.timezone,...Intl.supportedValuesOf('timeZone')])];
  async function submit(event:FormEvent) {
    event.preventDefault();if(disabled || busy || loading || !confirmed || !changed || !pending && (contactInvalid || kind==='site' && !contactsReady))return;
    const body:SettingsChange=pending || {requestId:crypto.randomUUID(),revision:current.revision,name:name.trim(),...(kind==='organization'?{supportEmail:value.trim()}:{timezone:value,generationLanguages:languages,primaryContactId:primary?.id ?? null,deputyContactId:deputy?.id ?? null}),confirmed:true};
    setConfirmed(false);await save(body);
  }
  return <section className="panel workspace-settings-section"><div className="workspace-settings-heading">{kind==='organization' ? <Building2 size={24}/> : <Globe size={24}/>}<h2>{kind==='organization' ? 'Organization' : 'Current site'}</h2></div>
    {editing ? <form onSubmit={event=>void submit(event)}>
      <label className="field">{kind==='organization' ? 'Organization name' : 'Site name'}<input value={name} minLength={2} maxLength={120} disabled={locked} required onChange={event=>{setName(event.target.value);setConfirmed(false);}}/></label>
      {kind==='organization' ? <label className="field">Support contact email (optional)<input type="email" value={value} maxLength={254} disabled={locked} onChange={event=>{setValue(event.target.value);setConfirmed(false);}}/></label> : <label className="field">Site timezone<select value={value} disabled={locked} onChange={event=>{setValue(event.target.value);setConfirmed(false);}}>{zones.map(zone=><option value={zone} key={zone}>{zone}</option>)}</select></label>}
      {kind==='site' && <fieldset className="generation-language-options"><legend>Generation defaults</legend>{WORKER_LOCALES.map(({code,englishName:label})=><label className="billing-confirm" key={code}><input type="checkbox" checked={languages.includes(code)} disabled={locked || code==='en'} onChange={event=>{setLanguages(['en',...GENERATION_LANGUAGE_CODES.filter(target=>target!=='en').filter(target=>target===code?event.target.checked:languages.includes(target))]);setConfirmed(false);}}/><span>{label}{code==='en'?' (source)':''}</span></label>)}</fieldset>}
      {kind==='site' && (pending?<dl className="billing-details"><dt>Saved primary contact reference</dt><dd>{pending.primaryContactId ?? 'Not configured'}</dd><dt>Saved deputy contact reference</dt><dd>{pending.deputyContactId ?? 'Not configured'}</dd></dl>:<SiteContacts authority={authority} primary={primary} deputy={deputy} disabled={locked} onReady={setContactsReady} onChange={(p,d)=>{setPrimary(p);setDeputy(d);setConfirmed(false);}}/>)}
      <div className="notice notice-blue"><TriangleAlert size={20}/><span>{kind==='organization' ? 'The organization name and support contact are shared across its sites. Issued invoice labels stay unchanged. Saving a contact does not send an email.' : 'New preparation runs use these generation defaults. Prepared and published versions, active runs and exact-target regeneration keep their languages. Selection does not verify a provider. Existing UTC deadlines and received timestamps stay unchanged.'}</span></div>
      {pending && <p role="status">The original settings save is unconfirmed. Check its receipt before explicitly retrying.</p>}
      <label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={busy || loading || !changed || !pending && (contactInvalid || kind==='site' && !contactsReady)} onChange={event=>setConfirmed(event.target.checked)}/><span>{kind==='organization' ? 'I confirm these organization details.' : 'I confirm these site settings.'}</span></label>
      {error && <p role="alert" className="record-error">{error}</p>}<div className="actions">{pending && <button type="button" className="button outline" disabled={busy} onClick={checkReceipt}><RefreshCw size={18}/>Check settings receipt</button>}<button type="button" className="button outline" disabled={locked} onClick={()=>{setEditing(false);onLocked(false);}}>Cancel</button><button className="button primary" disabled={disabled || busy || loading || !confirmed || !changed || !pending && (contactInvalid || kind==='site' && !contactsReady)}><Save size={18}/>{busy ? 'Saving...' : pending ? 'Retry unchanged request' : 'Save settings'}</button></div>
    </form> : <div className="workspace-settings-columns"><div>{kind==='organization' ? <dl className="billing-details"><dt>Name</dt><dd>{current.name}</dd><dt>{authority.session.staffRole==='owner' ? 'Owner' : 'Signed in as'}</dt><dd className="workspace-owner"><span className="staff-avatar">{initials(authority.session.name || '')}</span><span><strong dir="auto">{authority.session.name || 'Signed-in account'}</strong><small>{roleLabel(authority.session.staffRole)}{authority.session.email ? ` · ${authority.session.email}` : ''}</small></span></dd><dt>Workspace status</dt><dd><span className={`status status-${authority.session.siteState==='active' ? 'green' : 'amber'}`}>{authority.session.siteState==='active' ? 'Active' : 'Archived'}</span></dd><dt>Support contact</dt><dd>{second || 'Not configured'}</dd><dt>Revision</dt><dd>{current.revision}</dd></dl> : <dl className="billing-details"><dt>Name</dt><dd>{current.name}</dd><dt>Timezone</dt><dd>{second || 'Not configured'}</dd><dt>Languages</dt><dd>{loadedContext.site.generationLanguages.map(code=><span className="language-tag" key={code}>{code.toUpperCase()}</span>)}</dd>{[['Primary contact',loadedContext.site.primaryContact],['Deputy contact',loadedContext.site.deputyContact]].map(([label,contact])=><ContactDetail key={label as string} label={label as string} contact={contact as SiteContact|null}/>)}<dt>Revision</dt><dd>{current.revision}</dd></dl>}{error && <p role="alert">{error}</p>}{(kind==='organization' ? loadedContext.canWrite : loadedContext.canWriteSite) && <button className="button outline" disabled={disabled || loading} onClick={()=>{setName(current.name);setValue(second);setLanguages(loadedContext.site.generationLanguages);setPrimary(loadedContext.site.primaryContact);setDeputy(loadedContext.site.deputyContact);setContactsReady(false);setConfirmed(false);setEditing(true);onLocked(true);}}><Pencil size={18}/>Edit {kind==='organization' ? 'organization' : 'site'}</button>}</div>{kind==='organization' && <aside className="workspace-settings-note"><h3>Organization details</h3><p>These details are used across all sites for communications, reporting and support.</p></aside>}</div>}
  </section>;
}
function ContactDetail({label,contact}:{label:string;contact:SiteContact|null}) {
  return <><dt>{label}</dt><dd dir="auto">{contact?`${contact.name}${contact.available?'':' (unavailable)'}`:'Not configured'}</dd></>;
}
function SiteContacts({authority,primary,deputy,disabled,onReady,onChange}:{authority:StaffRequestAuthority;primary:SiteContact|null;deputy:SiteContact|null;disabled:boolean;onReady:(value:boolean)=>void;onChange:(primary:SiteContact|null,deputy:SiteContact|null)=>void}) {
  const {request,current}=useStaffRequest(authority);
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[data,setData]=useState<{items:SiteContact[];total:number;page:number;pageSize:number}|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;setLoading(true);setError('');onReady(false);
    request<{items:SiteContact[];total:number;page:number;pageSize:number}>(`/api/settings/contacts?${new URLSearchParams({search,page:String(page),pageSize:'10'})}`,undefined,controller.signal)
      .then(value=>completeStaffRequest(value,row=>{
        const result=row as typeof value;
        if(!result || !Array.isArray(result.items) || result.items.length>10 || !Number.isSafeInteger(result.total) || result.total<0 || result.page!==page || result.pageSize!==10
          || result.items.some(contact=>!contact || typeof contact.id!=='string' || !contact.id || typeof contact.name!=='string' || !['owner','supervisor'].includes(contact.role) || contact.available!==true
            || Object.keys(contact).sort().join(',')!=='available,id,name,role') || new Set(result.items.map(contact=>contact.id)).size!==result.items.length)throw Error('Site contacts cannot be verified.');
        return result;
      },result=>{setData(result);onReady(true);},live))
      .catch(err=>{if(live()){setData(null);setError(err.message);}}).finally(()=>{if(live())setLoading(false);});return()=>controller.abort();
  },[search,page,refresh,onReady,request,current]);
  const options=[...new Map([primary,deputy,...(data?.items || [])].filter((row):row is SiteContact=>!!row).map(row=>[row.id,row])).values()],pages=Math.max(1,Math.ceil((data?.total || 0)/10));
  return <fieldset className="site-contact-options"><legend>Site contacts</legend><label className="field">Search site contacts<span className="search-box"><Search size={18}/><input value={search} maxLength={120} disabled={disabled} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></span></label>
    {loading && <p role="status">Loading site contacts...</p>}{error && <p role="alert">{error}</p>}
    <div className="actions"><span>Page {page} of {pages}</span><button className="icon-button" type="button" title="Previous contacts" aria-label="Previous contacts" disabled={disabled || loading || page<=1} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={18}/></button><button className="icon-button" type="button" title="Next contacts" aria-label="Next contacts" disabled={disabled || loading || page>=pages} onClick={()=>setPage(n=>n+1)}><ChevronRight size={18}/></button><button className="icon-button" type="button" title="Refresh site contacts" aria-label="Refresh site contacts" disabled={disabled || loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={18}/></button></div>
    {(['primary','deputy'] as const).map(kind=><label className="field" key={kind}>{kind==='primary'?'Primary contact':'Deputy contact'}<select aria-label={kind==='primary'?'Primary contact':'Deputy contact'} value={(kind==='primary'?primary:deputy)?.id || ''} disabled={disabled || loading || !!error} onChange={event=>{const chosen=options.find(row=>row.id===event.target.value) || null;onChange(kind==='primary'?chosen:primary,kind==='deputy'?chosen:deputy);}}><option value="">Not configured</option>{options.map(row=><option key={row.id} value={row.id} disabled={!row.available || row.id===(kind==='primary'?deputy:primary)?.id}>{row.name} ({row.role}){row.available?'':' - unavailable'}</option>)}</select>{(kind==='primary'?primary:deputy) && <span className="site-contact-selected" dir="auto">{(kind==='primary'?primary:deputy)?.name}</span>}</label>)}
    {(!primary && deputy || primary && deputy && primary.id===deputy.id || primary && !primary.available || deputy && !deputy.available) && <p role="alert">Choose an available primary contact and a different deputy, or clear unavailable contacts.</p>}
  </fieldset>;
}
export function WorkspaceSettings({authority,onContextChanged,onLifecycleChanged,session}:{authority:StaffRequestAuthority;onContextChanged:(value:WorkspaceContext)=>void;onLifecycleChanged:()=>void;session:{clientContext:string;expiresAt:string;siteState?:'active'|'archived'}}) {
  const {request,current}=useStaffRequest(authority);
  const [data,setData]=useState<WorkspaceContext|null>(null),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [locks,setLocks]=useState({organization:false,site:false,creation:false}),heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[]);
  const contextCallback=useRef(onContextChanged);contextCallback.current=onContextChanged;
  useEffect(()=>{const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;setLoading(true);setError('');
    request<WorkspaceContext>('/api/settings',undefined,controller.signal)
      .then(value=>completeStaffRequest(value,row=>checkedWorkspaceContext(row,authority.session.staffScope),result=>{setData(result);contextCallback.current(result);},live))
      .catch(err=>{if(live())setError((err as Error).message);}).finally(()=>{if(live())setLoading(false);});return()=>controller.abort();
  },[refresh,request,current,authority.session.staffScope]);
  const saved=()=>{setMessage('Workspace settings saved.');setRefresh(value=>value+1);heading.current?.focus();};
  const lock=(kind:keyof typeof locks,value:boolean)=>{if(!current())return;if(value)setMessage('');setLocks(old=>old[kind]===value?old:{...old,[kind]:value});};
  return <><div className="page-header"><div><h1 ref={heading} tabIndex={-1}>Organization & site</h1><p>{data?.site.name || 'Workspace settings'}</p></div><button className="icon-button" title="Refresh workspace settings" aria-label="Refresh workspace settings" disabled={locks.organization || locks.site || locks.creation} onClick={()=>{setMessage('');setRefresh(value=>value+1);}}><RefreshCw size={20}/></button></div>
    {message && <p role="status">{message}</p>}{loading ? <p role="status">Loading workspace settings...</p> : error ? <p role="alert" className="record-error">{error}</p> : data && <><div className="workspace-settings-grid"><SettingsForm authority={authority} key="organization" kind="organization" context={data} disabled={locks.site || locks.creation || session.siteState==='archived'} onSaved={saved} onLocked={value=>lock('organization',value)}/><SettingsForm authority={authority} key="site" kind="site" context={data} disabled={locks.organization || locks.creation || session.siteState==='archived'} onSaved={saved} onLocked={value=>lock('site',value)}/></div>{data.canWrite && <OrganizationSites authority={authority} key={session.clientContext} session={session} timezone={data.site.timezone} disabled={locks.organization || locks.site} onLifecycleChanged={onLifecycleChanged} onLocked={value=>lock('creation',value)}/>}</>}
  </>;
}
