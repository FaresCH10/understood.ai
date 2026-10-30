import {workerWorkText} from './worker-work-text';
import {useStaffText} from './staff-language';
import {useEffect,useState} from 'react';
import {Paperclip,Download} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
type FileRow={id:string;name:string;mime:string;bytes:number};
export function AttachmentComposer({authority,requestId,disabled,saveDraft,onBusy}:{onBusy:(busy:boolean)=>void;authority:StaffRequestAuthority;requestId:string;disabled:boolean;saveDraft:()=>Promise<void>}){
 const tr=useStaffText();
 const {request,current}=useStaffRequest(authority),[items,setItems]=useState<FileRow[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();request<{items:FileRow[]}>(`/api/workspace/attachments/${requestId}`,undefined,controller.signal).then(value=>{if(current())setItems(value.items);}).catch(()=>{});return()=>controller.abort();},[requestId,request,current]);
 async function upload(file:File){
  if(busy||disabled)return;setBusy(true);onBusy(true);setError('');
  try{
   if(file.size>5*1024*1024)throw Error('Choose a file up to 5 MB.');
   await saveDraft();
   const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('File could not be read'));reader.readAsDataURL(file);});
   const result=await request<{items:FileRow[]}>(`/api/workspace/attachments/${requestId}`,{id:crypto.randomUUID(),name:file.name,mime:({'pdf':'application/pdf','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','txt':'text/plain','csv':'text/csv','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation'}[file.name.split('.').pop()?.toLowerCase()||'']||file.type),data});
   if(current())setItems(result.items);
  }catch(reason){if(current())setError((reason as Error).message);}finally{onBusy(false);if(current())setBusy(false);}
 }
 async function remove(id:string){if(busy||disabled)return;setBusy(true);onBusy(true);setError('');try{const result=await request<{items:FileRow[]}>(`/api/workspace/attachments/${requestId}`,{remove:id});if(current())setItems(result.items);}catch(reason){if(current())setError((reason as Error).message);}finally{onBusy(false);if(current())setBusy(false);}}
 return <section className="instruction-attachments"><label className="field"><span><Paperclip size={17}/> {tr("Attachments")}</span><input type="file" accept=".jpg,.jpeg,.png,.pdf,.txt,.csv,.docx,.xlsx,.pptx" disabled={disabled||busy} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value='';}}/></label><p className="muted">{tr("Photos, PDFs, Office documents, CSV and text files. Up to 5 MB each; five files and 10 MB total. Workers receive these with the instruction.")}</p>{busy&&<p role="status">{tr("Saving attachment…")}</p>}{error&&<p role="alert">{error}</p>}{items.length>0&&<ul>{items.map(file=><li key={file.id}>{file.name} <small>({Math.ceil(file.bytes/1024)} KB)</small> <button type="button" className="text-link" disabled={busy||disabled} onClick={()=>void remove(file.id)} aria-label={`Remove ${file.name}`}>{tr("Remove")}</button></li>)}</ul>}</section>;
}
export function InstructionFiles({assignmentId,clientContext,current,onSessionLost,language='en'}:{language?:string;assignmentId:string;clientContext:string;current:()=>boolean;onSessionLost:()=>void}){
 const t=workerWorkText(language);
 const [data,setData]=useState<{items:FileRow[];requestId?:string}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();fetch(`/api/workspace/assignment-files/${encodeURIComponent(assignmentId)}`,{credentials:'include',cache:'no-store',signal:controller.signal,headers:{'x-client-session-context':clientContext}}).then(async response=>{if(response.status===401||response.status===409)onSessionLost();if(!response.ok)throw Error(t.fileUnavailable);return response.json();}).then(value=>{if(current()&&!controller.signal.aborted)setData(value);}).catch(reason=>{if(current()&&!controller.signal.aborted)setError(reason.message);});return()=>controller.abort();},[assignmentId,clientContext]);
 async function download(file:FileRow){
  if(!current())return;setError('');
  try{const response=await fetch(`/api/workspace/attachments/${data?.requestId}/${file.id}`,{credentials:'include',cache:'no-store',headers:{'x-client-session-context':clientContext}});if(response.status===401||response.status===409)onSessionLost();if(!response.ok)throw Error(t.fileUnavailable);const blob=await response.blob();if(!current())return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(reason){if(current())setError((reason as Error).message);}
 }
 if(!data?.items.length&&!error)return null;
 return <section className="worker-card"><h2><Paperclip size={19}/> {t.attachments}</h2>{error&&<p role="alert">{error}</p>}{data?.items.map(file=><button className="item-row" key={file.id} onClick={()=>void download(file)}><Download size={18}/><span>{file.name}<small> · {Math.ceil(file.bytes/1024)} KB</small></span></button>)}</section>;
}
export function StaffInstructionFiles({briefingId,authority,refresh}:{briefingId:string;authority:StaffRequestAuthority;refresh:number}){
 const tr=useStaffText(),{request,current}=useStaffRequest(authority),[data,setData]=useState<{requestId?:string;items:FileRow[]}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();request<{requestId?:string;items:FileRow[]}>(`/api/workspace/briefing-files/${encodeURIComponent(briefingId)}`,undefined,controller.signal).then(value=>{if(current())setData(value);}).catch(reason=>{if(current()&&!controller.signal.aborted)setError(reason.message);});return()=>controller.abort();},[briefingId,request,current,refresh]);
 async function download(file:FileRow){if(!current()||!data?.requestId)return;setError('');try{const response=await fetch(`/api/workspace/attachments/${data.requestId}/${file.id}`,{credentials:'include',cache:'no-store',redirect:'error',headers:{'x-client-session-context':authority.session.clientContext!}});if(response.status===401||response.status===409)authority.onSessionLost();if(!response.ok)throw Error('Attachment unavailable.');const bytes=await response.blob();if(!current())return;const url=URL.createObjectURL(bytes),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(reason){if(current())setError((reason as Error).message);}}
 if(!data?.items.length&&!error)return null;
 return <section className="panel"><h2>{tr('Attachments')}</h2>{error&&<p role="alert">{error}</p>}{data?.items.map(file=><button className="item-row" key={file.id} onClick={()=>void download(file)}><Download size={18}/><span>{file.name} · {Math.ceil(file.bytes/1024)} KB</span></button>)}</section>;
}
