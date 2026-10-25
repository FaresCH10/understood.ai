import {useEffect,useRef,useState} from 'react';
import {Check,Copy,Eye,EyeOff,KeyRound,ShieldCheck,X} from 'lucide-react';
import {keepDialogFocus} from './dialog-focus';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {checkedWorkerCredentialStatus,checkedWorkerCredentialSetup,workerSetupHandout,type IssuedWorkerCredentialSetup,type WorkerCredentialStatus} from './worker-credentials-state';

const stateText:Record<string,string>={none:'Not set up',setup:'Setup code pending',active:'Password active'};

export function WorkerCredentials({workerId,workerCode,active,enabled,authority}:{workerId:string;workerCode:string;active:boolean;enabled:boolean;authority:StaffRequestAuthority}) {
  const {request,current}=useStaffRequest(authority);
  const dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false);
  const [status,setStatus]=useState<WorkerCredentialStatus|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
  const [minutes,setMinutes]=useState(60),[confirmed,setConfirmed]=useState(false),[action,setAction]=useState<'create'|'reset'>('create');
  const [issued,setIssued]=useState<IssuedWorkerCredentialSetup|null>(null),[visible,setVisible]=useState(false),[copied,setCopied]=useState(''),[manual,setManual]=useState('');
  const expectedLogin=workerCode.trim().normalize('NFKC').toUpperCase();
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();setLoading(true);
    request<unknown>(`/api/people/workers/${encodeURIComponent(workerId)}/credentials`,undefined,controller.signal)
      .then(value=>checkedWorkerCredentialStatus(value,workerId))
      .then(result=>{if(!controller.signal.aborted && current()){setStatus(result);setError('');}})
      .catch((reason:Error)=>{if(!controller.signal.aborted && current())setError(reason.message);})
      .finally(()=>{if(!controller.signal.aborted && current())setLoading(false);});
    return()=>controller.abort();
  },[workerId,enabled,revision,request,current]);
  function close(){if(inFlight.current)return;setIssued(null);setConfirmed(false);setVisible(false);setCopied('');setManual('');setError('');}
  async function issue(event:React.FormEvent){
    event.preventDefault();
    if(inFlight.current || !confirmed || !status || !current())return;
    inFlight.current=true;setBusy(true);setError('');setIssued(null);setCopied('');setManual('');
    try{
      const value=await request<unknown>(`/api/people/workers/${encodeURIComponent(workerId)}/credentials/setup`,
        {expectedCode:workerCode,confirmed:true,expiresInMinutes:minutes},undefined,'POST');
      const result=checkedWorkerCredentialSetup(value,{workerId,companyId:status.companyId,loginId:expectedLogin});
      if(!current())return;
      setIssued(result);setConfirmed(false);setRevision(n=>n+1);
    }catch(reason){if(current())setError((reason as Error).message);}
    finally{inFlight.current=false;if(current())setBusy(false);}
  }
  async function copy(){
    if(!issued || !current())return;
    try{await navigator.clipboard.writeText(workerSetupHandout(issued,location.origin));if(current())setCopied('Sign-in instructions copied.');}
    catch{if(current()){setCopied('Could not copy. Select the sign-in sheet below and share it privately.');setManual(workerSetupHandout(issued,location.origin));}}
  }
  return <section className="panel worker-access-panel worker-credentials-panel"><h2>Worker sign-in</h2>
    {!enabled ? <p>Worker passwords are unavailable in profile-demo mode.</p> : loading && !status ? <p role="status">Loading sign-in status...</p> : error && !status ? <p role="alert" className="record-error">{error}</p> : status && <>
      <dl className="billing-details">
        <dt>Status</dt><dd><span className={`status ${status.state==='active' ? 'status-green' : status.state==='setup' ? 'status-amber' : ''}`}><span className="status-dot"/>{stateText[status.state]}</span></dd>
        <dt>Company ID</dt><dd><bdi>{status.companyId}</bdi></dd>
        <dt>Worker ID</dt><dd><bdi>{status.loginId || status.workerCode}</bdi></dd>
        {status.passwordChangedAt && <><dt>Password changed</dt><dd>{new Date(status.passwordChangedAt).toLocaleString()}</dd></>}
        {status.state==='setup' && status.setupExpiresAt && <><dt>Setup code expires</dt><dd>{status.setupAvailable ? new Date(status.setupExpiresAt).toLocaleString() : 'Expired'}</dd></>}
      </dl>
      {error && <p role="alert" className="record-error">{error}</p>}
      {(status.state!=='setup' || !status.setupAvailable) && <button className="button outline full" disabled={busy || !active || !status.workerActive} onClick={()=>{setAction(status.state==='active'?'reset':'create');setConfirmed(false);setIssued(null);setCopied('');setManual('');setError('');dialog.current?.showModal();}}><KeyRound size={18}/>{status.state==='active' ? 'Reset worker password' : 'Create setup code'}</button>}
      {!active && <p className="muted">Re-enable this worker before issuing sign-in credentials.</p>}
      <p className="muted">Issuing a code ends the worker's existing sessions and access links. The worker uses the code once to create a password.</p>
    </>}
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby={`credential-title-${workerId}`} onKeyDown={keepDialogFocus} onCancel={(event)=>{if(inFlight.current)event.preventDefault();}} onClose={close}>
      <div className="withdraw-heading"><h2 id={`credential-title-${workerId}`}>{action==='reset' ? 'Reset worker password' : 'Create worker setup code'}</h2><button autoFocus type="button" className="icon-button" title="Close worker sign-in" aria-label="Close worker sign-in" disabled={busy} onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
      {issued ? <div className="access-link-result">
        <p role="status" className="notice notice-green"><ShieldCheck size={18}/>Setup code issued. It is shown only in this session.</p>
        <label className="field">Company ID<input readOnly value={issued.companyId} autoComplete="off" spellCheck={false}/></label>
        <label className="field">Worker ID<input readOnly value={issued.loginId} autoComplete="off" spellCheck={false}/></label>
        <label className="field">One-time setup code<input type={visible ? 'text' : 'password'} readOnly value={issued.setupCode} autoComplete="off" spellCheck={false}/></label>
        <div className="actions"><button type="button" className="icon-button" title={visible ? 'Hide code' : 'Show code'} aria-label={visible ? 'Hide code' : 'Show code'} onClick={()=>setVisible(value=>!value)}>{visible ? <EyeOff size={19}/> : <Eye size={19}/>}</button><button type="button" className="button outline" disabled={busy} onClick={()=>void copy()}><Copy size={18}/>Copy sign-in sheet</button></div>
        <p>Expires {new Date(issued.setupExpiresAt).toLocaleString()}. Share only with {issued.loginId}. The code cannot be viewed again after this panel closes.</p>
        {copied && <p role="status">{copied}</p>}
        {manual && <label className="field">Sign-in sheet<textarea readOnly rows={7} value={manual} onFocus={(event)=>event.currentTarget.select()}/></label>}
        <div className="actions"><button type="button" className="button primary" disabled={busy} onClick={()=>dialog.current?.close()}>Done</button></div>
      </div> : <form onSubmit={(event)=>void issue(event)}>
        <p className="crew-impact">Issue a one-time setup code for <bdi>{expectedLogin}</bdi>? Existing worker sessions, setup codes and access links will be revoked. Past assignments and answers are unchanged.</p>
        <label className="field">Code validity<select value={minutes} disabled={busy} onChange={(event)=>{setMinutes(Number(event.target.value));setConfirmed(false);}}><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={240}>4 hours</option><option value={1440}>24 hours</option></select></label>
        <label className="recipient-row publish-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event)=>setConfirmed(event.target.checked)}/><span>Issue a new one-time code for <bdi>{expectedLogin}</bdi></span></label>
        {error && <p role="alert" className="record-error">{error}</p>}
        <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={()=>dialog.current?.close()}>Cancel</button><button type="submit" className="button primary" disabled={busy || !confirmed}><Check size={18}/>{busy ? 'Issuing...' : 'Issue setup code'}</button></div>
      </form>}
    </dialog>
  </section>;
}
