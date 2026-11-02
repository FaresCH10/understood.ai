import {createRoot} from 'react-dom/client';
import {CaseConversation} from '../../src/CaseConversation';
import {PreparationRequest} from '../../src/PreparationRequest';
import '../../src/styles.css';
const mode=new URLSearchParams(location.search).get('runtime') || 'live-credential';
const session={authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['fixture','site','owner']),siteState:'active',mode,
  clientContext:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString()};
const authority={session,isCurrent:()=>true,canMutate:()=>false,onSessionLost:()=>{throw Error('Unexpected fixture session change');}};
window.fetch=async(input,options)=>{
  const path=String(input),method=options?.method || 'GET';
  if(!['GET','HEAD'].includes(method))throw Error('This provider-notice fixture cannot send or prepare anything');
  if(path==='/api/session')return Response.json(session);
  if(path.startsWith('/api/clarifications/provider-fixture/messages?'))return Response.json({caseId:'provider-fixture',clientContext:session.clientContext,
    items:[],total:0,page:1,pageSize:20,status:'open',language:'en',canReply:true,canGenerate:true,canVoice:false});
  if(path==='/api/briefings/fixture/preparation-requests')return Response.json({briefingId:'fixture',revision:1,state:'draft',job:null});
  throw Error('Unexpected fixture request');
};
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:850,margin:'40px auto'}}>
  <h1>Provider notice check · {mode}</h1><p>Read-only fixture. All responses are local mocks.</p>
  <CaseConversation caseId="provider-fixture" session={session} synthetic={mode!=='live-credential'} canMutate={()=>true}/>
  <PreparationRequest authority={authority} briefingId="fixture" revision={1} onChanged={()=>{throw Error('Fixture must not mutate');}}/>
</main>);
