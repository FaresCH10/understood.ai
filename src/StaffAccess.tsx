import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {ChevronLeft,ChevronRight,Pencil,Plus,RefreshCw,Search,Send,ShieldCheck,UserRoundCheck,UserRoundX,X} from 'lucide-react';
import {staffRoles,staffSignature} from '../server/staff-input.mjs';
import {checkedInvitationPage,type InvitationPage,type InvitationRow,type PendingInvitation} from './invitation-recovery';
import {InvitationForm} from './StaffInvitations';
import {readPendingStaff,savePendingStaff,clearPendingStaff,pendingStaffSignature,checkedStaffResult,type PendingStaff,type StaffAction} from './staff-recovery';
import {StaffRequestError} from './staff-request';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
type StaffRow={id:string;name:string;role:string;active:boolean;revision:number};
type StaffPage={items:StaffRow[];total:number;page:number;pageSize:number;activeOwners:number;canWrite:boolean};
type InviteFormState={row:InvitationRow|null;action:'issue'|'resend'|'cancel'};
const roleNames:Record<string,string>={owner:'Owner',administrator:'Administrator',supervisor:'Supervisor',auditor:'Read-only auditor'};
const permissions:Record<string,string>={owner:'Full access for their site, including staff, sites, AI processing and all content.',administrator:'Can manage staff and sites for their assigned site. Cannot change owner settings.',supervisor:'Can create and publish instructions, view results and optionally help with unclear answers. Cannot change owner settings.',auditor:'Read instruction results, activity and billing. Cannot change records or play worker recordings.'};
function accessAreas(role:string):{label:string;detail:string}[] {
  return [
    {label:'Instructions',detail:role==='auditor'?'View published instructions.':'Create and publish instructions.'},
    {label:'Results',detail:'View completed items and AI checks.'},
    {label:'Clarifications',detail:['owner','supervisor'].includes(role)?'Optionally help with unclear answers.':'View clarification history.'},
    {label:'Staff & sites',detail:role==='owner'?'Full access for the assigned site.':'Cannot change owner settings.'}
  ];
}
const initials=(name:string)=>name.split(' ').filter(Boolean).map(word=>word[0]).join('').slice(0,2).toUpperCase() || '?';
const longDate=(value:string)=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{dateStyle:'long',timeStyle:'short'}):value;};
function useStaffAccessRequests(authority:StaffRequestAuthority) {
  const scoped=useStaffRequest(authority);
  return useMemo(()=>({...scoped,
    request:<T,>(path:string,body?:unknown)=>scoped.request<T>('/api/settings/staff'+path,body),
    invitation:<T,>(path:string,signal?:AbortSignal)=>scoped.request<T>('/api/settings/invitations'+path,undefined,signal)
  }),[scoped]);
}
export function StaffAccess({actorRole,scope,onSessionChanged,authority}:{actorRole:string;scope?:string|null;onSessionChanged:()=>void;authority:StaffRequestAuthority}) {
  const {request,invitation,current:sessionCurrent}=useStaffAccessRequests(authority);
  const [search,setSearch]=useState(''),[role,setRole]=useState('all'),[status,setStatus]=useState('all'),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[data,setData]=useState<StaffPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState<StaffRow|null>(null),[message,setMessage]=useState('');
  const [invites,setInvites]=useState<InvitationPage|null>(null),[inviteError,setInviteError]=useState(''),[selectedInvite,setSelectedInvite]=useState<InvitationRow|null>(null),[inviteForm,setInviteForm]=useState<InviteFormState|null>(null);
  const [pending,setPending]=useState<PendingStaff|null>(()=>{try {return scope ? readPendingStaff(sessionStorage,scope) : null;}catch {return null;}}),[recoveryError,setRecoveryError]=useState(()=>{try {if(scope) readPendingStaff(sessionStorage,scope);return '';}catch(err) {return (err as Error).message;}});
  const heading=useRef<HTMLHeadingElement>(null),selectedButton=useRef<HTMLButtonElement|null>(null);
  const inviteAccess=authority.session.mode==='synthetic-credential' && !!scope && ['owner','administrator'].includes(actorRole);
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{if(pending || recoveryError) return;let current=true;setLoading(true);setError('');setData(null);request<StaffPage>(`?${new URLSearchParams({search,role,status,page:String(page),pageSize:'5'})}`).then(value=>{if(current && sessionCurrent()) {setData(value);setSelected(old=>old ? value.items.find(row=>row.id===old.id) || null : null);}}).catch(err=>{if(current && sessionCurrent()) {setData(null);setError(err.message);}}).finally(()=>{if(current && sessionCurrent()) setLoading(false);});return()=>{current=false;};},[search,role,status,page,refresh,pending,recoveryError,request,sessionCurrent]);
  useEffect(()=>{if(!inviteAccess || pending || recoveryError) return;const controller=new AbortController();let current=true;setInviteError('');invitation<unknown>('?status=pending&page=1&pageSize=50',controller.signal).then(value=>{if(!current || !sessionCurrent())return;try{setInvites(checkedInvitationPage(value,1,50));}catch(err){setInviteError((err as Error).message);}}).catch(err=>{if(current && sessionCurrent() && !controller.signal.aborted)setInviteError((err as Error).message);});return()=>{current=false;controller.abort();};},[inviteAccess,pending,recoveryError,refresh,invitation,sessionCurrent]);
  const saved=()=>{if(!sessionCurrent())return;setPending(null);setSelected(null);setSelectedInvite(null);setMessage('Staff access updated. Existing sessions were ended.');setRefresh(n=>n+1);heading.current?.focus();onSessionChanged();};
  const inviteSaved=(value:PendingInvitation)=>{if(!sessionCurrent())return;setInviteForm(null);setSelectedInvite(null);setMessage(value.action==='cancel' ? 'Invitation cancelled. Earlier links are no longer active.' : 'Invitation email queued. Inbox delivery is not confirmed.');setRefresh(n=>n+1);heading.current?.focus();};
  if(recoveryError) return <><h1>Staff access recovery</h1><p role="alert">{recoveryError}</p></>;
  if(pending && scope) return <StaffRecovery pending={pending} scope={scope} authority={authority} onSaved={saved}/>;
  const pages=Math.max(1,Math.ceil((data?.total || 0)/5));
  const siteName=authority.session.site || 'Assigned site';
  const pendingInvites=invites?.items || [];
  const rows=[
    ...(data?.items || []).map(row=>({kind:'staff' as const,id:row.id,name:row.name,role:row.role,status:row.active ? 'Active' : 'Revoked',active:row.active,row})),
    ...pendingInvites.map(row=>({kind:'invite' as const,id:row.id,name:row.name,role:row.role,status:'Invitation pending',active:false,row}))
  ].sort((left,right)=>left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const total=(data?.total || 0)+(invites?.total || 0);
  return <><div className="page-header"><div><h1 ref={heading} tabIndex={-1}>Settings</h1><p>Manage staff, roles, sites and access.</p></div><button className="icon-button" aria-label="Refresh staff" title="Refresh staff" disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={20}/></button></div>
    {message && <p role="status">{message}</p>}{inviteError && <p role="alert" className="record-error">{inviteError}</p>}<div className="filters"><label className="search-box"><Search size={19}/><input aria-label="Search staff" placeholder="Search staff..." maxLength={120} value={search} onChange={event=>{setSearch(event.target.value);setPage(1);setSelected(null);setSelectedInvite(null);}}/></label><label className="select-label">Role<select value={role} onChange={event=>{setRole(event.target.value);setPage(1);setSelected(null);setSelectedInvite(null);}}><option value="all">All roles</option>{staffRoles.map(r=><option key={r} value={r}>{roleNames[r]}</option>)}</select></label><label className="select-label">Access<select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);setSelected(null);setSelectedInvite(null);}}><option value="all">All statuses</option><option value="active">Active</option><option value="revoked">Revoked</option></select></label></div>
    {error && <p role="alert" className="record-error">{error}</p>}{loading ? <p role="status">Loading staff...</p> : data && <div className="staff-access-grid"><section className="panel staff-access-panel">
      <div className="staff-access-head"><div><h2>Staff &amp; access ({total})</h2><p>People who can use Understood at {siteName}.</p></div>{inviteAccess && data.canWrite && <button className="button primary" onClick={()=>{setMessage('');setInviteForm({row:null,action:'issue'});}}><Plus size={18}/>Invite staff</button>}</div>
      {rows.length ? <div className="table-wrap"><table className="staff-access-table"><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Site</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead><tbody>{rows.map(entry=><tr key={`${entry.kind}:${entry.id}`} className={entry.kind==='staff' && selected?.id===entry.id || entry.kind==='invite' && selectedInvite?.id===entry.id ? 'selected' : ''}>
        <td><button ref={entry.kind==='staff' && selected?.id===entry.id || entry.kind==='invite' && selectedInvite?.id===entry.id ? selectedButton : undefined} className="staff-row-button" aria-pressed={entry.kind==='staff' ? selected?.id===entry.id : selectedInvite?.id===entry.id} onClick={event=>{selectedButton.current=event.currentTarget;if(entry.kind==='staff'){setSelectedInvite(null);setSelected(entry.row);}else{setSelected(null);setSelectedInvite(entry.row);}}}><span className="staff-avatar">{initials(entry.name)}</span><strong dir="auto">{entry.name}</strong></button></td>
        <td>{roleNames[entry.role]}</td><td>{siteName}</td><td><span className={`status status-${entry.kind==='invite' ? 'amber' : entry.active ? 'green' : 'amber'}`}>{entry.status}</span></td>
        <td><button className="icon-button" aria-label={`Open ${entry.name}`} title={`Open ${entry.name}`} onClick={event=>{selectedButton.current=event.currentTarget;if(entry.kind==='staff'){setSelectedInvite(null);setSelected(entry.row);}else{setSelected(null);setSelectedInvite(entry.row);}}}><ChevronRight size={18}/></button></td>
      </tr>)}</tbody></table></div> : <p>No staff match these filters.</p>}
      {invites && invites.total > pendingInvites.length && <p className="muted">Showing {pendingInvites.length} of {invites.total} pending invitations. Open Invitations to view the rest.</p>}
      <div className="audit-pagination"><span>Page {page} of {pages}</span><button className="icon-button" title="Previous staff" aria-label="Previous staff" disabled={page<=1} onClick={()=>{setPage(n=>n-1);setSelected(null);setSelectedInvite(null);}}><ChevronLeft size={18}/></button><button className="icon-button" title="Next staff" aria-label="Next staff" disabled={page>=pages} onClick={()=>{setPage(n=>n+1);setSelected(null);setSelectedInvite(null);}}><ChevronRight size={18}/></button></div>
    </section>
    {selected && <StaffDetail key={`${selected.id}:${selected.revision}`} row={selected} site={siteName} actorRole={actorRole} canWrite={data.canWrite} scope={scope} authority={authority} onSaved={saved} onPending={value=>{if(sessionCurrent())setPending(value);}} onClose={()=>{setSelected(null);selectedButton.current?.focus();}}/>}
    {!selected && selectedInvite && <InviteDetail key={selectedInvite.id} row={selectedInvite} site={siteName} actorRole={actorRole} scope={scope!} authority={authority} onSaved={inviteSaved} onPending={value=>{if(!sessionCurrent())return;setInviteForm(null);setSelectedInvite(null);setMessage('Invitation request saved. Open Staff invitations to confirm its outcome.');setRefresh(n=>n+1);location.hash='settings/invitations';}} onClose={()=>{setSelectedInvite(null);selectedButton.current?.focus();}}/>}</div>}
    <section className="staff-role-permissions"><div className="staff-role-permissions-head"><h2>Role permissions</h2><p>Access in Understood is based on each person's role and site.</p></div><div>{staffRoles.map(r=><section key={r}><ShieldCheck size={22}/><h3>{roleNames[r]}</h3><p>{permissions[r]}</p></section>)}</div></section>
    {inviteForm && scope && <InvitationForm key={inviteForm.row ? `${inviteForm.row.id}:${inviteForm.action}` : 'issue'} row={inviteForm.row} action={inviteForm.action} actorRole={actorRole} scope={scope} onSaved={inviteSaved} onPending={value=>{if(!sessionCurrent())return;setInviteForm(null);setMessage('Invitation request saved. Open Staff invitations to confirm its outcome.');setRefresh(n=>n+1);location.hash='settings/invitations';}} onClose={()=>setInviteForm(null)} authority={authority}/>}
  </>;
}
function StaffDetail({row,site,actorRole,canWrite,scope,onSaved,onPending,onClose,authority}:{row:StaffRow;site:string;actorRole:string;canWrite:boolean;scope?:string|null;onSaved:()=>void;onPending:(value:PendingStaff)=>void;onClose:()=>void;authority:StaffRequestAuthority}) {
  const {request,current}=useStaffAccessRequests(authority);
  const [action,setAction]=useState<StaffAction|null>(null),[role,setRole]=useState(row.role),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const sending=useRef(false),form=useRef<HTMLFormElement>(null),heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[]);
  const allowed=canWrite && !!scope && (actorRole==='owner' || !['owner','administrator'].includes(row.role));
  useEffect(()=>{if(action) form.current?.querySelector<HTMLElement>('select,input')?.focus();},[action]);
  async function submit(event:FormEvent) {
    event.preventDefault();if(!action || !scope || !confirmed || sending.current || !current()) return;
    const pending:PendingStaff={requestId:crypto.randomUUID(),id:row.id,action,body:{revision:row.revision,...(action==='role' ? {role} : {}),confirmed:true}};
    sending.current=true;setBusy(true);setError('');let stored=false;
    try {savePendingStaff(sessionStorage,scope,pending);stored=true;const result=await request(`/${encodeURIComponent(row.id)}/${action}`,{...pending.body,requestId:pending.requestId});if(!current())return;checkedStaffResult(result,pending);clearPendingStaff(sessionStorage,scope,pending.requestId);onSaved();}
    catch(err) {
      if(!current())return;
      if(stored && (!(err instanceof StaffRequestError) || err.uncertain || err.fenced)) onPending(pending);
      else {try {if(stored) clearPendingStaff(sessionStorage,scope,pending.requestId);setError((err as Error).message);setConfirmed(false);}catch {onPending(pending);}}
    } finally {sending.current=false;if(current())setBusy(false);}
  }
  return <section className="panel staff-access-detail"><div className="page-header"><h2 ref={heading} tabIndex={-1} dir="auto">{row.name}</h2><button className="icon-button" type="button" disabled={busy} aria-label="Close staff details" title="Close staff details" onClick={onClose}><X size={18}/></button></div><dl className="billing-details"><dt>Role</dt><dd>{roleNames[row.role]}</dd><dt>Site</dt><dd>{site}</dd><dt>Access</dt><dd>{row.active ? 'Active' : 'Revoked'}</dd><dt>Revision</dt><dd>{row.revision}</dd></dl><p>{permissions[row.role]}</p>
    {action ? <form ref={form} onSubmit={event=>void submit(event)}><h3>{action==='role' ? 'Change role' : action==='revoke' ? 'Revoke access' : 'Restore access'}</h3>{action==='role' && <label className="field">New role<select value={role} disabled={busy} onChange={event=>{setRole(event.target.value);setConfirmed(false);}}>{staffRoles.filter(r=>actorRole==='owner' || !['owner','administrator'].includes(r)).map(r=><option key={r} value={r}>{roleNames[r]}</option>)}</select></label>}
      <div className="notice notice-blue"><ShieldCheck size={20}/><span>{action==='revoke' ? 'New server access and existing sessions will end. Previously downloaded data cannot be erased remotely.' : 'Existing sessions will end. This person must sign in again. Earlier records remain unchanged.'}</span></div>
      <label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={busy || (action==='role' && role===row.role)} onChange={event=>setConfirmed(event.target.checked)}/><span>I confirm {action==='role' ? `the ${roleNames[role]} role` : action==='revoke' ? 'revoking access' : 'restoring access'} for {row.name}.</span></label>
      {error && <p role="alert" className="record-error">{error}</p>}<div className="actions"><button type="button" className="button outline" disabled={busy} onClick={()=>{setAction(null);setConfirmed(false);setError('');heading.current?.focus();}}>Cancel</button><button className="button primary" disabled={busy || !confirmed || (action==='role' && role===row.role)}><ShieldCheck size={18}/>{busy ? 'Saving...' : 'Confirm change'}</button></div>
    </form> : allowed && <div className="actions">{row.active && <button className="button outline" onClick={()=>{setAction('role');setRole(row.role);setConfirmed(false);setError('');}}><Pencil size={18}/>Change role</button>}<button className="button outline" onClick={()=>{setAction(row.active ? 'revoke' : 'restore');setConfirmed(false);setError('');}}>{row.active ? <UserRoundX size={18}/> : <UserRoundCheck size={18}/>} {row.active ? 'Revoke access' : 'Restore access'}</button></div>}
  </section>;
}
function InviteDetail({row,site,actorRole,scope,onSaved,onPending,onClose,authority}:{row:InvitationRow;site:string;actorRole:string;scope:string;onSaved:(value:PendingInvitation)=>void;onPending:(value:PendingInvitation)=>void;onClose:()=>void;authority:StaffRequestAuthority}) {
  const [form,setForm]=useState<'resend'|'cancel'|null>(null),heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[]);
  const canManage=actorRole==='owner' || (actorRole==='administrator' && !['owner','administrator'].includes(row.role));
  return <section className="panel staff-access-detail"><div className="page-header"><div className="staff-detail-person"><span className="staff-avatar large">{initials(row.name)}</span><div><h2 ref={heading} tabIndex={-1} dir="auto">{row.name}</h2><span className="status status-amber">Invitation pending</span></div></div><button className="icon-button" type="button" aria-label="Close invitation details" title="Close invitation details" onClick={onClose}><X size={18}/></button></div>
    <dl className="billing-details"><dt>Role</dt><dd>{roleNames[row.role]}</dd><dt>Site</dt><dd>{site}</dd><dt>Invitation sent</dt><dd>{longDate(row.createdAt)}</dd><dt>Email</dt><dd dir="ltr">{row.emailHint}</dd></dl>
    <div className="staff-access-areas"><h3>Access</h3><dl>{accessAreas(row.role).map(area=><div key={area.label}><dt>{area.label}</dt><dd>{area.detail}</dd></div>)}</dl></div>
    <p className="muted">The invitation link expires {longDate(row.expiresAt)}.</p>
    {canManage && <div className="actions"><button className="button primary" onClick={()=>setForm('resend')}><Send size={18}/>Resend invitation</button><button className="button outline" onClick={()=>setForm('cancel')}><X size={18}/>Cancel invitation</button></div>}
    <p className="muted">Permissions are limited by role and assigned site.</p>
    {form && <InvitationForm key={`${row.id}:${form}`} row={row} action={form} actorRole={actorRole} scope={scope} onSaved={onSaved} onPending={onPending} onClose={()=>setForm(null)} authority={authority}/>}
  </section>;
}
function StaffRecovery({pending,scope,onSaved,authority}:{pending:PendingStaff;scope:string;onSaved:()=>void;authority:StaffRequestAuthority}) {
  const {request,current:sessionCurrent}=useStaffAccessRequests(authority);
  const [busy,setBusy]=useState(false),[absent,setAbsent]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);const callback=useRef(onSaved),sending=useRef(false);callback.current=onSaved;
  const finish=(value:unknown)=>{if(!sessionCurrent())return;if(!authority.canMutate())throw new StaffRequestError('Session check in progress. Recheck the saved receipt when verification finishes.',false,null,true);checkedStaffResult(value,pending);clearPendingStaff(sessionStorage,scope,pending.requestId);callback.current();};
  useEffect(()=>{let current=true;setBusy(true);setAbsent(false);setError('');request<{accepted:boolean;id?:string;action?:string;request?:{revision:number;role?:string};result?:unknown}>(`/receipts/${pending.requestId}`).then(value=>{
    if(!current || !sessionCurrent()) return;
    if(value.accepted===true && value.id && value.action && value.request) {if(staffSignature(value.id,value.action,value.request)!==pendingStaffSignature(pending)) throw new Error('Staff receipt does not match the saved request.');finish(value.result);}
    else if(value.accepted===false) setAbsent(true);else throw new Error('Staff receipt response cannot be verified.');
  }).catch(err=>{if(current && sessionCurrent()) setError(err.message);}).finally(()=>{if(current && sessionCurrent()) setBusy(false);});return()=>{current=false;};},[pending,scope,refresh,request,sessionCurrent]);
  async function retry() {if(sending.current || !absent || !sessionCurrent()) return;sending.current=true;setBusy(true);setError('');try {finish(await request(`/${encodeURIComponent(pending.id)}/${pending.action}`,{...pending.body,requestId:pending.requestId}));}catch(err) {if(sessionCurrent())setError((err as Error).message);}finally {sending.current=false;if(sessionCurrent())setBusy(false);}}
  return <><h1>Staff access recovery</h1><p className="staff-recovery-request">Request {pending.requestId}</p>{busy && <p role="status">Checking staff access...</p>}{error && <p role="alert" className="record-error">{error}</p>}{absent && <p>No accepted receipt was found for this saved request.</p>}<div className="actions"><button className="button outline" disabled={busy} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={18}/>Check receipt</button>{absent && <button className="button primary" disabled={busy} onClick={()=>void retry()}><ShieldCheck size={18}/>Retry unchanged request</button>}</div></>;
}
