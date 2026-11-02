import {useStaffText as useStaffStaticText} from './staff-language';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, FileText, RefreshCw, TriangleAlert, Upload, Users } from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {completeStaffRequest,StaffRequestError} from './staff-request';
import {preparePendingImport,readPendingImport,savePendingImport,clearPendingImport,checkedImportPreview,checkedImportAcknowledgement,importRecoveryDecision,type PendingImport,type ImportPreview as Preview} from './worker-import-recovery';

type Props = { id?: string; navigate: (path: string) => void;authority:StaffRequestAuthority };

const canImport=(preview:Preview)=>preview.status==='validated' && preview.totalRows>0 && !preview.errors.length && !preview.invalidRows;
const knownRejection=(error:unknown)=>error instanceof StaffRequestError && !error.uncertain && !error.fenced && error.status!==null && error.status>=400 && error.status<500;
function useImportRequests(authority:StaffRequestAuthority) {
  const scoped=useStaffRequest(authority);
  const complete=<T,>(value:unknown,validate:(value:unknown)=>T|Promise<T>,done:(value:T)=>void)=>completeStaffRequest(value,validate,done,scoped.current,authority.canMutate);
  return {...scoped,complete};
}

export function WorkerImportPage({ id, navigate,authority }: Props) {
  const staffT=useStaffStaticText();
  const {request,current,complete}=useImportRequests(authority),scope=authority.session.staffScope!;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pending,setPending]=useState<PendingImport|null>(()=>{try{return readPendingImport(sessionStorage,scope);}catch{return null;}});
  const [storageError]=useState(()=>{try{readPendingImport(sessionStorage,scope);return '';}catch(error){return (error as Error).message;}});
  const uploadKey = useRef<string | null>(null);
  const sending = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!id || pending || storageError) return;
    const controller=new AbortController();setPreview(null);setLoading(true);setError('');
    request(`/api/people/imports/${encodeURIComponent(id)}`,undefined,controller.signal)
      .then(value=>checkedImportPreview(value,id)).then(data=>{if(!controller.signal.aborted && current()){setPreview(data);setPage(1);}})
      .catch((err:Error)=>{if(!controller.signal.aborted && current())setError(err.message);})
      .finally(()=>{if(!controller.signal.aborted && current())setLoading(false);});
    return ()=>controller.abort();
  }, [id,pending,storageError,request,current]);
  const resolved=(snapshot:Preview)=>{if(!current())return;setPending(null);setPreview(snapshot);setPage(1);setFile(null);uploadKey.current=null;if(id!==snapshot.id)navigate(`people/import/${snapshot.id}`);};
  const validate = async () => {
    if (!file || sending.current || !current()) return;
    sending.current = true; setBusy(true); setError('');
    uploadKey.current ??= crypto.randomUUID();
    let submitted:PendingImport|null=null,stored=false;
    try {
      submitted=await preparePendingImport(file,uploadKey.current);
      await complete(submitted,()=>submitted!,value=>{savePendingImport(sessionStorage,scope,value);stored=true;});
      const query=new URLSearchParams({requestId:submitted.requestId,filename:file.name});
      const data=await request(`/api/people/imports/preview?${query}`,file,undefined,'POST','csv');
      await complete(data,value=>checkedImportPreview(value,submitted!.requestId,submitted!),snapshot=>{clearPendingImport(sessionStorage,scope,submitted!);resolved(snapshot);});
    } catch (err) {
      if(!current())return;
      if(stored && submitted){if(knownRejection(err)){try{await complete(submitted,()=>submitted!,value=>clearPendingImport(sessionStorage,scope,value));}catch{setPending(submitted);}}else setPending(submitted);}
      if(current())setError((err as Error).message);
    }
    finally { sending.current = false;if(current())setBusy(false); }
  };
  const confirm = async () => {
    if (!preview || !canImport(preview) || sending.current || !current()) return;
    sending.current = true; setBusy(true); setError('');
    const submitted:PendingImport={requestId:preview.id,sha256:preview.sha256,filenameHash:preview.filenameHash,phase:'confirm',bytes:null};let stored=false;
    try {
      await complete(submitted,()=>submitted,value=>{savePendingImport(sessionStorage,scope,value);stored=true;});
      const result=await request(`/api/people/imports/${preview.id}/confirm`,{});checkedImportAcknowledgement(result,preview);
      const receipt=await request(`/api/people/imports/${preview.id}`);
      await complete(receipt,value=>{const snapshot=checkedImportPreview(value,preview.id,submitted);if(snapshot.status==='validated' || snapshot.imported!==preview.totalRows)throw Error('Import outcome is not confirmed. Check the saved import.');return snapshot;},snapshot=>{clearPendingImport(sessionStorage,scope,submitted);resolved(snapshot);});
    } catch (err) {
      if(!current())return;
      if(stored){
        if(knownRejection(err)){try{const fresh=await request(`/api/people/imports/${preview.id}`);await complete(fresh,value=>checkedImportPreview(value,preview.id,submitted),snapshot=>{clearPendingImport(sessionStorage,scope,submitted);resolved(snapshot);});}catch{if(current())setPending(submitted);}}
        else setPending(submitted);
      }
      if(current())setError((err as Error).message);
    }
    finally { sending.current = false;if(current())setBusy(false); }
  };
  const imported = preview?.status === 'imported';
  const expired = preview?.status === 'expired';
  const blocked = !preview || !!preview.errors.length || !!preview.invalidRows || !preview.totalRows || expired;
  const rows = preview?.rows.slice((page - 1) * 10, page * 10) || [];
  const pages = Math.max(1, Math.ceil((preview?.totalRows || 0) / 10));
  if(storageError)return <section role="alert"><h1>{staffT("Import recovery")}</h1><p>{storageError}</p></section>;
  if(pending)return <ImportRecovery key={`${pending.requestId}:${pending.phase}`} authority={authority} scope={scope} pending={pending} onResolved={resolved}/>;
  return <>
    <button className="back-link" disabled={busy} onClick={() => navigate('people')}><ArrowLeft size={18} />{staffT("Workers")}</button>
    <div className="page-header"><div><h1>{staffT("Import workers")}</h1></div><a className="button outline" href="/worker-import-template.csv" download><Download size={18} />{staffT("CSV template")}</a></div>
    <ol className="import-steps" aria-label={staffT("Import progress")}>{['Upload', 'Validate', 'Confirm'].map((step, index) => <li key={step} aria-current={index === (imported ? 2 : preview ? 1 : 0) ? 'step' : undefined}>
      <span className={imported || preview && index === 0 ? 'done' : ''}>{imported || preview && index === 0 ? <Check size={18} /> : index + 1}</span><strong>{step}</strong></li>)}</ol>
    <section className="import-file-band"><FileText size={34} /><div><h2>{(file?.name || preview?.filename||staffT("CSV file"))}</h2>{preview && <p>{preview.totalRows} {staffT("rows ·")} {preview.validRows} {staffT("valid ·")} {preview.invalidRows} {staffT("need attention")}</p>}</div>
      <button className="button outline" disabled={busy || loading} onClick={() => fileInput.current?.click()}><Upload size={18} />{preview?staffT("Replace file"):staffT("Choose file")}</button>
      <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" aria-label={staffT("CSV file")} disabled={busy || loading}
        onChange={(event) => { const selected = event.target.files?.[0]; if (selected) { setFile(selected); setPreview(null); setError(''); uploadKey.current = null; setPage(1); } event.target.value = ''; }} />
    </section>
    {file && <button className="button primary" disabled={busy} onClick={() => void validate()}><Check size={18} />{busy?staffT("Validating..."):staffT("Validate file")}</button>}
    {loading && <p>{staffT("Loading import...")}</p>}
    {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
    {preview && <section className="panel import-preview"><div className="people-panel-heading"><h2>{staffT("Preview rows (")}{preview.totalRows})</h2>{!expired && (preview.errors.length > 0 || preview.invalidRows > 0) && <a className="button outline" href={`/api/people/imports/${preview.id}/errors.csv`} download><Download size={18} />{staffT("Download errors")}</a>}</div>
      {!!preview.rows.length && <div className="table-wrap"><table><thead><tr><th>{staffT("Row")}</th><th>{staffT("Worker ID")}</th><th>{staffT("Language")}</th><th>{staffT("Crew")}</th><th>{staffT("Status")}</th><th>{staffT("Notes")}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.workerId}</td><td>{row.language}</td><td>{row.crew || '-'}</td><td><span className={`status status-${row.valid ? 'green' : 'amber'}`}>{row.valid?staffT("Valid"):staffT("Needs attention")}</span></td><td>{row.errors.join('; ') || '-'}</td></tr>)}</tbody></table></div>}
      {pages > 1 && <div className="people-pagination"><span>{staffT("Page")} {staffT.number(page)} {staffT("of")} {staffT.number(pages)}</span><div><button className="icon-button" title={staffT("Previous page")} aria-label={staffT("Previous page")} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={19} /></button><button className="icon-button" title={staffT("Next page")} aria-label={staffT("Next page")} disabled={page >= pages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={19} /></button></div></div>}
      {expired ? <div className="notice" role="status"><TriangleAlert size={22} /><span>{staffT("This import has expired.")}{(preview.imported > 0&&staffT(" {p0} workers were previously imported.",{p0:preview.imported}))}</span></div>
        : imported ? <div className="notice notice-green" role="status"><Check size={22} /><span>{preview.imported} {staffT("workers imported.")}</span></div>
        : blocked && <div className="notice" role="status"><TriangleAlert size={22} /><span>{preview.errors.length?preview.errors.join('. '):staffT("Fix {p0} rows before importing.",{p0:preview.invalidRows})}</span></div>}
      {!imported && !expired && <div className="actions"><button className="button primary" disabled={blocked || busy} onClick={() => void confirm()}><Users size={18} />{busy?staffT("Importing..."):staffT("Import {p0} workers",{p0:preview.totalRows})}</button><p>{staffT("Nothing has been imported yet.")}</p></div>}
      {imported && <button className="button primary" onClick={() => navigate('people')}><Users size={18} />{staffT("View workers")}</button>}
    </section>}
  </>;
}

function ImportRecovery({authority,scope,pending,onResolved}:{authority:StaffRequestAuthority;scope:string;pending:PendingImport;onResolved:(preview:Preview)=>void}) {
  const staffT=useStaffStaticText();
  const {request,current,complete}=useImportRequests(authority),resolved=useRef(onResolved);resolved.current=onResolved;
  const [snapshot,setSnapshot]=useState<Preview|null>(null),[absent,setAbsent]=useState(false),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[file,setFile]=useState<File|null>(null);
  const sending=useRef(false),input=useRef<HTMLInputElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const finish=(preview:Preview)=>{clearPendingImport(sessionStorage,scope,pending);resolved.current(preview);};
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{
    const controller=new AbortController();setChecking(true);setSnapshot(null);setAbsent(false);setError('');
    request(`/api/people/imports/${pending.requestId}`,undefined,controller.signal).then(value=>complete(value,value=>checkedImportPreview(value,pending.requestId,pending),preview=>{
      if(controller.signal.aborted)return;if(importRecoveryDecision(preview,pending)==='waiting')setSnapshot(preview);else finish(preview);
    })).catch(reason=>{if(controller.signal.aborted || !current())return;if(pending.phase==='preview' && reason instanceof StaffRequestError && reason.status===404)setAbsent(true);else setError((reason as Error).message);})
      .finally(()=>{if(!controller.signal.aborted && current())setChecking(false);});
    return ()=>controller.abort();
  },[pending,scope,refresh,request,current]);
  const retry=async()=>{
    if(sending.current || checking || !current() || !(pending.phase==='preview' ? absent && file : snapshot && canImport(snapshot)))return;
    sending.current=true;setBusy(true);setError('');
    try {
      if(pending.phase==='preview') {
        const matching=await preparePendingImport(file!,pending.requestId);
        if(matching.sha256!==pending.sha256 || matching.filenameHash!==pending.filenameHash || matching.bytes!==pending.bytes)throw Error('Select the original unchanged CSV file.');
        const query=new URLSearchParams({requestId:pending.requestId,filename:file!.name});
        const value=await request(`/api/people/imports/preview?${query}`,file,undefined,'POST','csv');checkedImportPreview(value,pending.requestId,pending);
      }else {
        const value=await request(`/api/people/imports/${pending.requestId}/confirm`,{});checkedImportAcknowledgement(value,snapshot!);
      }
      const receipt=await request(`/api/people/imports/${pending.requestId}`);
      await complete(receipt,value=>{const preview=checkedImportPreview(value,pending.requestId,pending);if(importRecoveryDecision(preview,pending)==='waiting')throw Error('Import outcome is not confirmed. Check the saved import.');return preview;},finish);
    }catch(reason){if(current())setError((reason as Error).message);}finally{sending.current=false;if(current())setBusy(false);}
  };
  return <section className="panel import-preview"><h1 ref={heading} tabIndex={-1}>{staffT("Import recovery")}</h1><p>{pending.phase==='confirm'?staffT("The import confirmation outcome is not yet confirmed."):staffT("The CSV preview outcome is not yet confirmed.")}</p><p className="staff-recovery-request">{staffT("Import")} {pending.requestId}</p>
    {checking && <p role="status">{staffT("Checking the saved import...")}</p>}{error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
    {absent && <><p>{staffT("No saved preview was found.")}</p><button className="button outline" disabled={busy || checking} onClick={()=>input.current?.click()}><Upload size={18}/>{staffT("Choose original CSV")}</button><input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label={staffT("Original CSV file")} disabled={busy || checking} onChange={event=>{setFile(event.target.files?.[0] || null);event.target.value='';}}/>{file && <p dir="auto">{file.name}</p>}</>}
    {snapshot && <><h2 dir="auto">{snapshot.filename}</h2><p>{snapshot.totalRows} {staffT("rows ·")} {snapshot.validRows} {staffT("valid ·")} {snapshot.invalidRows} {staffT("need attention")}</p>{!canImport(snapshot) && <p role="status">{(snapshot.errors.join('. ')||staffT("The saved preview has rows that cannot currently be imported."))}</p>}</>}
    <div className="actions"><button className="button outline" disabled={busy || checking} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={18}/>{staffT("Check saved import")}</button>{(absent || snapshot && canImport(snapshot)) && <button className="button primary" disabled={busy || checking || pending.phase==='preview' && !file} onClick={()=>void retry()}><Check size={18}/>{busy?staffT("Saving..."):pending.phase==='preview'?staffT("Retry unchanged preview"):staffT("Retry same import")}</button>}</div>
  </section>;
}
