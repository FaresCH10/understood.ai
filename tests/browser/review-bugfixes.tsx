import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import SendInstruction from '../../src/SendInstruction';
import '../../src/styles.css';

// Disposable fixture: exercises the real component with no server or provider writes.
let checks=0,sentId='',cancelled=new URLSearchParams(location.search).has('cancel');
const result=(state:'preparing'|'published')=>({requestId:sentId,briefingId:'fixture',state,responseMode:'question',deliveryMode:'text',audience:{type:'all',count:1},delivered:state==='published'?1:0,undelivered:0,undeliveredReasons:[],deliveryStates:{preparing:state==='preparing'?1:0,available:state==='published'?1:0,blocked:0,failed:0,withdrawn:0},publicationId:state==='published'?'publication':null,error:null,duplicate:false});
const originalFetch=window.fetch;
window.fetch=async(input,options)=>{
  const path=String(input);
  if(path==='/api/instructions/audience')return Response.json({workers:{total:1,byLanguage:{en:1}},crews:[]});
  if(path==='/api/instructions/send'){checks=0;sentId=JSON.parse(options!.body as string).requestId;return Response.json(result('preparing'));}
  if(path.startsWith('/api/instructions/sends/')){checks++;return Response.json(result(!cancelled&&checks>=3?'published':'preparing'));}
  return originalFetch(input,options);
};
const authority={session:{authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['fixture','site','owner']),siteState:'active',mode:'synthetic-demo',clientContext:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString()},isCurrent:()=>true,canMutate:()=>true,onSessionLost:()=>{throw Error('Unexpected session loss');}};
function Fixture(){
  const [mounted,setMounted]=useState(true),[verdict,setVerdict]=useState('Waiting for an instruction to send.');
  function stop(){if(!sentId){setVerdict('FAIL: no pending send to cancel.');return;}cancelled=true;setMounted(false);const previous=checks;setVerdict('Checking cancellation...');setTimeout(()=>setVerdict(checks===previous?'PASS: polling stops on unmount.':'FAIL: polling continued after unmount.'),3500);}
  return <main style={{maxWidth:850,margin:'40px auto'}}><h1>Send polling regression</h1><p role="status">{verdict}</p><button onClick={stop}>Unmount and check cancellation</button>{mounted&&<SendInstruction authority={authority} scope="fixture:site:owner" navigate={()=>{}} onSent={()=>setVerdict(checks===3?'PASS: three automatic status checks reached publication after two unchanged responses.':`FAIL: unexpected checks ${checks}`)}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
