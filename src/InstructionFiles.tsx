import {useStaffText as useStaffStaticText} from './staff-language';
import {workerWorkText} from './worker-work-text';
import {useStaffText} from './staff-language';
import {useEffect,useState} from 'react';
import {Paperclip,Download} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
type FileRow={id:string;name:string;mime:string;bytes:number;captions?:Record<string,string>};
const photo=(mime:string)=>mime==='image/png'||mime==='image/jpeg';
const direction=(code:string)=>['ar','ur','fa','he','pa-Arab'].includes(code)?'rtl':'ltr';
const captionFor=(captions:Record<string,string>|undefined,language:string)=>{
 const values=captions||{};
 return values[language]||values.en||Object.values(values).find(value=>!!value)||'';
};
function AttachmentPreview({requestId,file,clientContext,current,onSessionLost,alt}:{requestId:string;file:FileRow;clientContext:string;current:()=>boolean;onSessionLost:()=>void;alt:string}){
 const [url,setUrl]=useState('');
 useEffect(()=>{
  if(!photo(file.mime))return;
  let objectUrl='';const controller=new AbortController();
  setUrl('');
  fetch(`/api/workspace/attachments/${requestId}/${file.id}`,{credentials:'include',cache:'no-store',signal:controller.signal,headers:{'x-client-session-context':clientContext}})
   .then(async response=>{if(response.status===401||response.status===409)onSessionLost();if(!response.ok)throw Error();return response.blob();})
   .then(blob=>{if(current()&&!controller.signal.aborted){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}})
   .catch(()=>{});
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[requestId,file.id,file.mime,clientContext]);
 return url?<img className="attachment-preview" src={url} alt={alt} loading="lazy"/>:null;
}
function CaptionEditor({file,languages,disabled,busy,onSave}:{file:FileRow;languages:string[];disabled:boolean;busy:boolean;onSave:(id:string,captions:Record<string,string>)=>void}){
 const staffT=useStaffStaticText();
 const [values,setValues]=useState<Record<string,string>>(file.captions||{});
 useEffect(()=>setValues(file.captions||{}),[file.id,file.captions]);
 const codes=[...new Set([...languages,...Object.keys(file.captions||{})])];
 if(!codes.length)return null;
 return <details className="attachment-caption-editor"><summary>{staffT("Photo captions")}</summary>
  <p className="muted">{staffT("Captions appear under this photo in the worker's language. English is the fallback.")}</p>
  <div className="attachment-caption-fields">{codes.map(code=><label className="field" key={code}><span>{staffT.language(code)}</span><input maxLength={300} lang={code} dir={direction(code)} value={values[code]||''} disabled={disabled||busy} onChange={event=>setValues(old=>({...old,[code]:event.target.value}))}/></label>)}</div>
  <button type="button" className="button outline" disabled={disabled||busy} onClick={()=>onSave(file.id,Object.fromEntries(Object.entries(values).map(([code,text])=>[code,text.trim()]).filter(([,text])=>!!text)))}>{staffT("Save captions")}</button>
 </details>;
}
export function AttachmentComposer({authority,requestId,disabled,ready,saveDraft,onBusy,languages=[]}:{onBusy:(busy:boolean)=>void;authority:StaffRequestAuthority;requestId:string;disabled:boolean;ready:boolean;saveDraft:()=>Promise<void>;languages?:string[]}){
 const staffT=useStaffStaticText();
 const tr=useStaffText();
 const {request,current}=useStaffRequest(authority),[items,setItems]=useState<FileRow[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[captionDraft,setCaptionDraft]=useState<Record<string,string>>({});
 useEffect(()=>{if(!ready){setItems([]);return;}const controller=new AbortController();request<{items:FileRow[]}>(`/api/workspace/attachments/${requestId}`,undefined,controller.signal).then(value=>{if(current())setItems(value.items);}).catch(()=>{});return()=>controller.abort();},[requestId,request,current,ready]);
 async function upload(file:File){
  if(busy||disabled)return;setBusy(true);onBusy(true);setError('');
  try{
   if(file.size>5*1024*1024)throw Error('Choose a file up to 5 MB.');
   await saveDraft();
   const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('File could not be read'));reader.readAsDataURL(file);});
   const mime={'pdf':'application/pdf','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','txt':'text/plain','csv':'text/csv','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation'}[file.name.split('.').pop()?.toLowerCase()||'']||file.type;
   const captions=photo(mime)?Object.fromEntries(Object.entries(captionDraft).map(([code,text])=>[code,text.trim()]).filter(([,text])=>!!text)):undefined;
   const result=await request<{items:FileRow[]}>(`/api/workspace/attachments/${requestId}`,{id:crypto.randomUUID(),name:file.name,mime,data,...(captions&&Object.keys(captions).length?{captions}:{})});
   if(current()){setItems(result.items);if(captions)setCaptionDraft({});}
  }catch(reason){if(current())setError((reason as Error).message);}finally{onBusy(false);if(current())setBusy(false);}
 }
 async function remove(id:string){if(busy||disabled)return;setBusy(true);onBusy(true);setError('');try{const result=await request<{items:FileRow[]}>(`/api/workspace/attachments/${requestId}`,{remove:id});if(current())setItems(result.items);}catch(reason){if(current())setError((reason as Error).message);}finally{onBusy(false);if(current())setBusy(false);}}
 async function saveCaptions(id:string,captions:Record<string,string>){if(busy||disabled)return;setBusy(true);onBusy(true);setError('');try{const result=await request<{items:FileRow[]}>(`/api/workspace/attachments/${requestId}`,{id,captions});if(current())setItems(result.items);}catch(reason){if(current())setError((reason as Error).message);}finally{onBusy(false);if(current())setBusy(false);}}
 return <section className="instruction-attachments"><label className="field"><span><Paperclip size={17}/> {tr("Attachments")}</span><input type="file" accept=".jpg,.jpeg,.png,.pdf,.txt,.csv,.docx,.xlsx,.pptx" disabled={disabled||busy} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value='';}}/></label><p className="muted">{tr("Photos, PDFs, Office documents, CSV and text files. Up to 5 MB each; five files and 10 MB total. Workers receive these with the instruction.")}</p>{languages.length>0&&<details className="attachment-caption-editor attachment-caption-new" open={Object.keys(captionDraft).length>0}><summary>{staffT("Photo captions (optional)")}</summary><p className="muted">{staffT("Added to the next photo you attach. Captions appear in the worker's language, with English as the fallback.")}</p><div className="attachment-caption-fields">{languages.map(code=><label className="field" key={code}><span>{staffT.language(code)}</span><input maxLength={300} lang={code} dir={direction(code)} value={captionDraft[code]||''} disabled={disabled||busy} onChange={event=>setCaptionDraft(old=>({...old,[code]:event.target.value}))}/></label>)}</div></details>}{busy&&<p role="status">{tr("Saving attachment…")}</p>}{error&&<p role="alert">{staffT.error(error)}</p>}{items.length>0&&<ul className="attachment-list">{items.map(file=><li key={file.id}><div className="attachment-item-head"><span>{file.name} <small>({Math.ceil(file.bytes/1024)} {staffT("KB)")}</small></span> <button type="button" className="text-link" disabled={busy||disabled} onClick={()=>void remove(file.id)} aria-label={staffT("Remove {p0}",{p0:file.name})}>{tr("Remove")}</button></div>{photo(file.mime)&&<CaptionEditor file={file} languages={languages} disabled={disabled} busy={busy} onSave={(id,captions)=>void saveCaptions(id,captions)}/>}</li>)}</ul>}</section>;
}
export function InstructionFiles({assignmentId,clientContext,current,onSessionLost,language='en'}:{language?:string;assignmentId:string;clientContext:string;current:()=>boolean;onSessionLost:()=>void}){
 const staffT=useStaffStaticText();
 const t=workerWorkText(language);
 const [data,setData]=useState<{items:FileRow[];requestId?:string}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();fetch(`/api/workspace/assignment-files/${encodeURIComponent(assignmentId)}`,{credentials:'include',cache:'no-store',signal:controller.signal,headers:{'x-client-session-context':clientContext}}).then(async response=>{if(response.status===401||response.status===409)onSessionLost();if(!response.ok)throw Error(t.fileUnavailable);return response.json();}).then(value=>{if(current()&&!controller.signal.aborted)setData(value);}).catch(reason=>{if(current()&&!controller.signal.aborted)setError(reason.message);});return()=>controller.abort();},[assignmentId,clientContext]);
 async function download(file:FileRow){
  if(!current())return;setError('');
  try{const response=await fetch(`/api/workspace/attachments/${data?.requestId}/${file.id}`,{credentials:'include',cache:'no-store',headers:{'x-client-session-context':clientContext}});if(response.status===401||response.status===409)onSessionLost();if(!response.ok)throw Error(t.fileUnavailable);const blob=await response.blob();if(!current())return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(reason){if(current())setError((reason as Error).message);}
 }
 if(!data?.items.length&&!error)return null;
 return <section className="worker-card"><h2><Paperclip size={19}/> {t.attachments}</h2>{error&&<p role="alert">{staffT.error(error)}</p>}{data?.items.map(file=>{const caption=photo(file.mime)?captionFor(file.captions,language):'';return <div className="worker-attachment" key={file.id}>{photo(file.mime)&&<AttachmentPreview requestId={data.requestId!} file={file} clientContext={clientContext} current={current} onSessionLost={onSessionLost} alt={caption||file.name}/>}{caption&&<p className="attachment-caption" lang={language} dir={direction(language)}>{caption}</p>}<button className="item-row" onClick={()=>void download(file)}><Download size={18}/><span>{file.name}<small> · {Math.ceil(file.bytes/1024)} KB</small></span></button></div>;})}</section>;
}
export function StaffInstructionFiles({briefingId,authority,refresh}:{briefingId:string;authority:StaffRequestAuthority;refresh:number}){
 const staffT=useStaffStaticText();
 const tr=useStaffText(),{request,current}=useStaffRequest(authority),[data,setData]=useState<{requestId?:string;items:FileRow[]}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();request<{requestId?:string;items:FileRow[]}>(`/api/workspace/briefing-files/${encodeURIComponent(briefingId)}`,undefined,controller.signal).then(value=>{if(current())setData(value);}).catch(reason=>{if(current()&&!controller.signal.aborted)setError(reason.message);});return()=>controller.abort();},[briefingId,request,current,refresh]);
 async function download(file:FileRow){if(!current()||!data?.requestId)return;setError('');try{const response=await fetch(`/api/workspace/attachments/${data.requestId}/${file.id}`,{credentials:'include',cache:'no-store',redirect:'error',headers:{'x-client-session-context':authority.session.clientContext!}});if(response.status===401||response.status===409)authority.onSessionLost();if(!response.ok)throw Error('Attachment unavailable.');const bytes=await response.blob();if(!current())return;const url=URL.createObjectURL(bytes),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(reason){if(current())setError((reason as Error).message);}}
 if(!data?.items.length&&!error)return null;
 return <section className="panel"><h2>{tr('Attachments')}</h2>{error&&<p role="alert">{staffT.error(error)}</p>}{data?.items.map(file=>{const captions=Object.entries(file.captions||{});return <div className="staff-attachment" key={file.id}>{photo(file.mime)&&data.requestId&&<AttachmentPreview requestId={data.requestId} file={file} clientContext={authority.session.clientContext!} current={current} onSessionLost={authority.onSessionLost} alt={captionFor(file.captions,'en')||file.name}/>}{captions.length>0&&<ul className="attachment-caption-list">{captions.map(([code,text])=><li key={code}><span>{staffT.language(code)}</span><p lang={code} dir={direction(code)}>{text}</p></li>)}</ul>}<button className="item-row" onClick={()=>void download(file)}><Download size={18}/><span>{file.name} · {Math.ceil(file.bytes/1024)} KB</span></button></div>;})}</section>;
}
