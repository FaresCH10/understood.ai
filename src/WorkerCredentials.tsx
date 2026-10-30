import {generateWorkerPassword} from './worker-password';
import {useEffect,useRef,useState} from 'react';
import {KeyRound,X} from 'lucide-react';
import {keepDialogFocus} from './dialog-focus';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {checkedWorkerCredentialStatus,type WorkerCredentialStatus} from './worker-credentials-state';

export function WorkerCredentials({workerId,workerCode,active,enabled,authority}:{workerId:string;workerCode:string;active:boolean;enabled:boolean;authority:StaffRequestAuthority}) {
  const {request,current}=useStaffRequest(authority);
  const dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false);
  const [status,setStatus]=useState<WorkerCredentialStatus|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
  const [showPassword,setShowPassword]=useState(false);
  const [login,setLogin]=useState(workerCode),[password,setPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState(''),[confirmed,setConfirmed]=useState(false);
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
  function clear(){setShowPassword(false);setPassword('');setConfirmPassword('');setConfirmed(false);setError('');}
  async function assign(event:React.FormEvent){
    event.preventDefault();
    if(inFlight.current || !confirmed || password.length<8 || password!==confirmPassword || !current())return;
    inFlight.current=true;setBusy(true);setError('');
    try{
      const result=await request<{workerId:string;companyId:string;loginId:string;state:string}>(`/api/people/workers/${encodeURIComponent(workerId)}/credentials/password`,
        {expectedCode:workerCode,workerId:login,password,confirmed:true},undefined,'POST');
      if(!current())return;
      if(result.workerId!==workerId || result.companyId!==status?.companyId || result.state!=='active' || result.loginId!==login.trim().normalize('NFKC').toUpperCase())throw Error('Password assignment could not be verified. Check sign-in status before retrying.');
      clear();setSaved(true);setRevision(value=>value+1);dialog.current?.close();
    }catch(reason){if(current())setError((reason as Error).message);}
    finally{inFlight.current=false;if(current())setBusy(false);}
  }
  return <section className="panel worker-access-panel worker-credentials-panel"><h2>Worker sign-in</h2>
    {!enabled ? <p>Worker passwords are unavailable in profile-demo mode.</p> : loading && !status ? <p role="status">Loading sign-in status...</p> : status ? <>
      <dl className="billing-details"><dt>Status</dt><dd>{status.state==='active'?'Password assigned':'Password required'}</dd><dt>Company ID</dt><dd><bdi>{status.companyId}</bdi></dd><dt>Worker ID</dt><dd><bdi>{status.loginId || status.workerCode}</bdi></dd></dl>
      {saved && <p role="status" className="notice notice-green">Worker ID and password assigned. Share them privately with this worker.</p>}
      <button className="button outline full" disabled={busy || !active || !status.workerActive} onClick={()=>{clear();setLogin(status.loginId || workerCode);setSaved(false);dialog.current?.showModal();}}><KeyRound size={18}/>{status.state==='active'?'Reset worker password':'Assign ID and password'}</button>
      <p className="muted">The company assigns these credentials. Workers can sign in with them, or open their page using a private access link. Resetting ends existing sessions and access links.</p>
    </> : error && <p role="alert">{error}</p>}
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby={`credential-title-${workerId}`} onKeyDown={keepDialogFocus} onCancel={event=>{if(inFlight.current)event.preventDefault();}} onClose={clear}>
      <div className="withdraw-heading"><h2 id={`credential-title-${workerId}`}>Assign worker credentials</h2><button type="button" className="icon-button" aria-label="Close worker sign-in" disabled={busy} onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
      <form onSubmit={event=>void assign(event)}>
        <label className="field">Worker ID<input autoFocus autoComplete="off" value={login} onChange={event=>setLogin(event.target.value)} disabled={busy} required minLength={2} maxLength={80}/></label>
        <label className="field">Assigned password<input type={showPassword?'text':'password'} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} disabled={busy} required minLength={8} maxLength={128}/></label>
        <button type="button" className="button outline" disabled={busy} onClick={()=>{const value=generateWorkerPassword();setPassword(value);setConfirmPassword(value);setShowPassword(true);}}>Generate password</button><button type="button" className="button subtle" disabled={busy} onClick={()=>setShowPassword(value=>!value)}>{showPassword?'Hide':'Show'} password</button><p className="muted">Use at least 8 characters.</p>
        <label className="field">Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} disabled={busy} required minLength={8} maxLength={128}/></label>
        <label className="recipient-row"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>Assign these credentials and end this worker's existing sessions and access links.</span></label>
        {error && <p role="alert">{error}</p>}
        <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={()=>dialog.current?.close()}>Cancel</button><button className="button primary" disabled={busy || !confirmed || login.trim().length<2 || password.length<8 || password!==confirmPassword}>{busy?'Saving...':'Assign credentials'}</button></div>
      </form>
    </dialog>
  </section>;
}
