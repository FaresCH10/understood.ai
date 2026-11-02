import {TextRetentionSettings} from '../../src/TextRetentionSettings';
import {textRetentionDays} from '../../server/text-retention-input.mjs';
import {staffStaticArabic} from '../../src/staff-static-ar';
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {PublicationResponses} from '../../src/PublicationResponses';
import {PublicationHistory} from '../../src/PublicationHistory';
import {StaffLanguageContext,StaffTimezoneContext} from '../../src/staff-language';
import type {StaffRequestAuthority} from '../../src/useStaffRequest';
import '../../src/styles.css';
import '../../src/ui-refresh.css';
import '../../src/instruction-detail.css';

const query=new URLSearchParams(location.search),scenario=query.get('scenario')||'signal';
let followup=false;const requests:{path:string;method:string;body:unknown}[]=[];
const publication={id:'publication-qa',version:12,state:scenario==='withdrawn'?'withdrawn':'published',published_at:'2026-10-31T23:30:00.000Z'};
const counts={assessed:3,matched:0,clarification:3,matchRate:0};
const suggestion={title:'Valve A-12 — corrective instruction',source:'Close valve A-12.\nCheck pressure is below 30 psi.\nReport to Maya before restarting.'};
const session={authenticated:true,role:'staff',staffRole:scenario==='auditor'?'auditor':'owner',clientContext:'a'.repeat(64),staffScope:JSON.stringify(['qa-user','qa-org','qa-site']),siteState:'active',mode:query.get('runtime')||'live-credential',expiresAt:'2099-11-01T00:00:00.000Z',timezone:'Asia/Beirut'};
const authority:StaffRequestAuthority={session,isCurrent:()=>true,canMutate:()=>true,onSessionLost:()=>{throw Error('Unexpected session loss');}};
window.fetch=async(input,options)=>{
  const path=String(input),url=new URL(path,location.origin),method=options?.method||'GET',body=options?.body?JSON.parse(String(options.body)):null;
  requests.push({path,method,body});document.documentElement.dataset.requests=JSON.stringify(requests);
  if(url.origin!==location.origin||!path.startsWith('/api/'))throw Error('External requests are disabled');
  if(url.pathname.startsWith('/api/retention/')){
    if(method!=='GET')throw Error('Policy writes are disabled in the Arabic UI fixture');
    const category=({text:'response',cases:'case',generated:'generated',activity:'activity',briefings:'briefing'} as Record<string,string>)[url.pathname.split('/').pop()!]||'response';
    const prefix=({response:'Scheduled cleanup redacts worker answer',case:'Scheduled cleanup redacts resolved case',generated:'Generated body/question speech expires',activity:'Scheduled cleanup permanently clears',briefing:'Archived briefing content expires'} as Record<string,string>)[category];
    const limitations=Object.keys(staffStaticArabic).find(key=>key.startsWith(prefix))!;
    return Response.json({revision:0,days:null,canWrite:true,recoveryScope:category==='response'?session.staffScope:category+':'+session.staffScope,options:textRetentionDays,completed:{},limitations});
  }
  if(scenario==='loading')return new Promise<Response>(()=>{});
  if(scenario==='error')return Response.json({error:'PRIVATE_TRANSPORT_DIAGNOSTIC'},{status:503});
  if(url.pathname.endsWith('/improvement/draft')){
    if(scenario==='conflict')return Response.json({error:'Improvement request conflict'},{status:409});
    followup=true;document.documentElement.dataset.draft=JSON.stringify(body);
  }
  if(url.pathname.includes('/improvement'))return Response.json({publicationId:publication.id,eligible:!['empty','no-assessed'].includes(scenario),current:scenario==='no-assessed'?{assessed:0,matched:0,clarification:0,matchRate:null}:counts,languages:scenario==='no-assessed'?[]:[{language:'pa-Guru',...counts},{language:'ur',...counts}],signal:['eligible','empty','no-assessed'].includes(scenario)?null:{...counts,createdAt:publication.published_at},suggestion,followup:followup||['draft','published','withdrawn'].includes(scenario)?{briefingId:'corrective-qa',publicationId:scenario==='draft'||followup?null:'followup-qa',state:followup?'draft':scenario==='withdrawn'?'withdrawn':scenario==='draft'?'draft':'published',counts:scenario==='published'?{assessed:3,matched:3,clarification:0,matchRate:100}:counts}:null});
  if(url.pathname.endsWith('/publications'))return Response.json({briefingId:'briefing-qa',items:[publication],total:1,page:1,pageSize:20,version:null});
  if(url.pathname.endsWith('/publications/publication-qa'))return Response.json({...publication,briefingId:'briefing-qa',snapshot:{source:suggestion.source,question:'When may valve A-12 be restarted?',facts:['Pressure below 30 psi','Report to Maya'],responseMode:'question',deliveryMode:'both'},artifactAudio:null,metrics:{assigned:21,responses:3,matches:0,clarifications:3,unassessed:0,pending:18,completion:14},withdrawal:scenario==='withdrawn'?{reason:'Supervisor requested inspection — فحص الصمام',withdrawn_by:'qa-owner',occurred_at:publication.published_at}:null});
  if(url.pathname.endsWith('/responses/assignment-1'))return Response.json({publication,assignment:{id:'assignment-1',worker:'عامل / QA-0012',language:'ur',dueAt:'2026-11-01T10:00:00.000Z'},question:'When may valve A-12 be restarted?',workerQuestion:'والو دوبارہ کب شروع کیا جا سکتا ہے؟',facts:['Pressure below 30 psi','Report to Maya'],receipts:[{sequence:'12',kind:'text',receivedAt:publication.published_at,isLatest:true,answerText:'I will restart at 40 psi — الإجابة الأصلية',outcome:'clarification',reasons:['missing_asked_fact'],recordingId:'recording-qa',audioStatus:null,evidence:[{factIndex:0,quote:'40 psi — النص الأصلي'}]}],total:11,page:Number(url.searchParams.get('page')||1),pageSize:10,cases:[{id:'case-qa',status:'open',reason:'missing_asked_fact'}]});
  if(url.pathname.endsWith('/responses'))return Response.json({publication,items:scenario==='empty'?[]:[{assignmentId:'assignment-1',worker:'عامل / QA-0012',language:'ur',status:'clarification',receivedAt:publication.published_at},{assignmentId:'assignment-2',worker:'QA-0013',language:'pa-Guru',status:'awaiting_response',receivedAt:null}],total:scenario==='empty'?0:21,page:Number(url.searchParams.get('page')||1),pageSize:20});
  if(url.pathname.startsWith('/api/recordings/'))return new Response(null,{status:404});
  throw Error('Unexpected fixture request '+path);
};
function Fixture(){
  const [locale,setLocale]=useState<'ar'|'en'>('ar'),[history,setHistory]=useState(false);
  return <StaffLanguageContext.Provider value={locale}><StaffTimezoneContext.Provider value="Asia/Beirut"><main lang={locale} dir={locale==='ar'?'rtl':'ltr'} style={{maxWidth:1320,margin:'0 auto',padding:20}}><nav className="actions" aria-label="أدوات الاختبار"><button type="button" onClick={()=>setLocale(locale==='ar'?'en':'ar')}>العربية / English</button><button type="button" onClick={()=>setHistory(!history)}>الاستجابات / السجل</button></nav><h1>{locale==='ar'?'استجابات التعليمات والتحسين':'Instruction responses and improvement'}</h1>{query.get('area')==='retention'?<>{(['response','case','generated','activity','briefing'] as const).map(category=><TextRetentionSettings key={category} category={category} authority={authority}/>)}</>:history?<PublicationHistory briefingId="briefing-qa" selected={publication} onSelect={()=>{}} context={session.clientContext} refresh={0} onView={()=>{}} canWrite={false} onChanged={()=>{}} authority={authority}/>:<PublicationResponses briefingId="briefing-qa" publication={publication} onSelect={()=>{}} context={session.clientContext} refresh={0} navigate={path=>{document.documentElement.dataset.navigation=path;}} canPlayAudio={scenario!=='auditor'} authority={authority}/>}</main></StaffTimezoneContext.Provider></StaffLanguageContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
