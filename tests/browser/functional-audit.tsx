import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useWorkerSessionGuard} from '../../src/useWorkerSessionGuard';
import {SessionConnectionNotice} from '../../src/SessionConnectionNotice';
import {WorkerNotifications} from '../../src/WorkerNotifications';
import NewBriefing from '../../src/NewBriefing';
import {WorkerPresentationView} from '../../src/WorkerPresentationView';
import SendInstruction from '../../src/SendInstruction';
import type {PageSession} from '../../src/session-state';
import '../../src/styles.css';
const mode=new URLSearchParams(location.search).get('mode')||'session';
const session:PageSession={authenticated:true,role:'worker',workerId:'fixture',language:'en',mode:'synthetic-credential',clientContext:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString()};
const staff={...session,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['fixture','site','owner']),siteState:'active'};
let offline=false,sends=0;
const ids=Array.from({length:20},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const notifications=ids.map((id,i)=>({id,kind:'instruction.available',label:`Instruction ${i+1}`,destination:'inbox',objectType:'assignment',objectId:id,occurredAt:new Date(Date.UTC(2026,9,26,0,i)).toISOString(),readAt:null as string|null}));
window.fetch=async(input,init)=>{
  const path=String(input);
  if(path==='/api/session'){if(offline)throw TypeError('Offline');return Response.json(session);}
  if(path.startsWith('/api/notifications?')){
    const params=new URL(path,location.origin).searchParams,unread=params.get('status')==='unread',page=Number(params.get('page')),items=unread?notifications.filter(item=>!item.readAt):notifications;
    return Response.json({items:items.slice((page-1)*10,page*10),total:items.length,unread:notifications.filter(item=>!item.readAt).length,page,pageSize:10,asOf:new Date().toISOString(),since:'2026-01-01T00:00:00.000Z'});
  }
  if(path.startsWith('/api/notifications/')){const item=notifications.find(item=>path.includes(item.id))!;item.readAt=new Date().toISOString();return Response.json(item);}
  if(path==='/api/push/status')return Response.json({adapter:'disabled',configured:false,publicKey:null,subscriptions:[]});
  if(path.startsWith('/api/templates?'))return Response.json({items:[{id:'template-one',title:'Shelf template',status:'active'}]});
  if(path==='/api/templates/template-one')return Response.json({selected:{content:{title:'Template title',source:'Keep the finished items on the blue shelf.'}}});
  if(path.startsWith('/api/processing?'))return Response.json({items:[]});
  if(path==='/api/overview')return Response.json({assigned:0,responses:0,matches:0,clarifications:0,pending:0});
  if(path.includes('/presentations'))return Response.json({assignmentId:'assignment',originalLanguage:'en',approvedLanguage:'hi',items:[presentation],clientContext:session.clientContext});
  if(path==='/api/instructions/audience')return Response.json({workers:{total:1,notSelected:0,byLanguage:{en:1}},crews:[]});
  if(path==='/api/instructions/send'){sends++;throw TypeError('Lost response');}
  throw Error(`Unexpected fixture request: ${path}`);
};
function Draft(){const [value,setValue]=useState('Keep my unsent instruction');const id=useRef(crypto.randomUUID());return <><label>Unsent draft<input value={value} onChange={event=>setValue(event.target.value)}/></label><p data-testid="draft-id">{id.current}</p></>;}
function SessionFixture(){const guard=useWorkerSessionGuard(session,false),[proof,setProof]=useState('');return <><h1>Session recovery</h1><button onClick={()=>{offline=true;window.dispatchEvent(new Event('focus'));}}>Simulate temporary connection loss</button><button onClick={()=>{offline=false;guard.retry();}}>Restore connection</button><button onClick={()=>setProof(!guard.suspended&&!guard.isLocked()&&document.querySelector('input')?.value==='My retained answer'?'PASS: draft retained and server actions resumed':'FAIL: draft or guard state changed')}>Check retained draft</button><p role="status">{proof}</p>{guard.suspended&&<SessionConnectionNotice language="en" retry={guard.retry}/>}<div hidden={guard.suspended}><Draft/></div></>;}
function NotificationFixture(){const [proof,setProof]=useState('');return <><h1>Unread pagination regression</h1><button onClick={()=>{const times=Array.from(document.querySelectorAll('.notification-row time')).map(element=>element.getAttribute('datetime'));setProof(times.length===10&&times.includes(notifications[10].occurredAt)?'PASS: unread page refilled with item 11':'FAIL: unread item skipped');}}>Check first unread page</button><p role="status">{proof}</p><WorkerNotifications session={session} language="en" navigate={()=>{}} refresh={0} current={()=>true} onSessionLost={()=>{throw Error('Unexpected session change');}}/></>;}
function SendFixture(){const [proof,setProof]=useState(''),[denied,setDenied]=useState(false);return <><h1>Durable send recovery</h1><button onClick={()=>{Storage.prototype.setItem=function(){throw new DOMException('Blocked','QuotaExceededError');};setDenied(true);}}>Block browser storage</button><button onClick={()=>setProof(denied&&sends===0?'PASS: storage failure prevented the send':`FAIL: unexpected sends ${sends}`)}>Check no send occurred</button><p role="status">{proof}</p><SendInstruction authority={{session:staff,isCurrent:()=>true,canMutate:()=>true,onSessionLost:()=>{throw Error('Session changed');}}} scope="functional-fixture" navigate={()=>{}} onSent={()=>{}}/></>;}
const publicChoices=Array.from({length:4},(_,i)=>({id:String(i).repeat(32),text:`हिंदी विकल्प ${i+1}`}));
const presentation={id:'11111111-1111-4111-8111-111111111111',sourceKind:'instruction',sourceId:'',publicationId:'publication',publicationVersion:1,originalLanguage:'en',targetLanguage:'hi',status:'ready',content:{title:'निर्देश',text:'नीली शेल्फ का प्रयोग करें।',question:'आपको क्या करना है?',questionType:'multiple-choice',choices:publicChoices},provider:'synthetic-hi',live:false,errorCode:null,sourceHash:'b'.repeat(64),createdAt:new Date().toISOString(),readyAt:new Date().toISOString()};
const authority={session:staff,isCurrent:()=>true,canMutate:()=>true,onSessionLost:()=>{throw Error('Unexpected session change');}};
function TemplateFixture(){const navigationGuard=useRef(null),[proof,setProof]=useState('');return <><button onClick={()=>setProof(document.querySelector('textarea')?.value==='Keep the finished items on the blue shelf.'&&document.querySelector<HTMLButtonElement>('.source-tabs button.selected')?.textContent==='Type'?'PASS: template is visible in Type mode':'FAIL: template source is hidden')}>Check applied template</button><p role="status">{proof}</p><NewBriefing scope="template-fixture" uploadSession={{clientContext:session.clientContext!,expiresAt:session.expiresAt!}} authority={authority} navigate={()=>{}} navigationGuard={navigationGuard}/></>;}
function ChoicesFixture(){const [choices,setChoices]=useState<{id:string;text:string}[]|null>(null),[proof,setProof]=useState('');return <><h1>Translated choices</h1><button onClick={()=>setProof(choices?.length===4&&choices.every((choice,i)=>choice.id===publicChoices[i].id&&choice.text===publicChoices[i].text)?'PASS: translated choices retain all grading IDs':'FAIL: translated choices missing')}>Check translated choices</button><p role="status">{proof}</p><WorkerPresentationView assignmentId="assignment" version={1} sourceKind="instruction" originalLanguage="en" approvedLanguage="hi" uiLanguage="en" session={{...session,language:'hi'}} current={()=>true} onSessionLost={()=>{throw Error('Session changed');}} requiresChoices onChoices={setChoices}/></>;}
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:850,margin:'30px auto'}}>{mode==='template'?<TemplateFixture/>:mode==='choices'?<ChoicesFixture/>:mode==='session'?<SessionFixture/>:mode==='notifications'?<NotificationFixture/>:<SendFixture/>}</main>);
