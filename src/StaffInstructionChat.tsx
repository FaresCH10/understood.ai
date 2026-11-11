import {useEffect,useRef,useState} from 'react';
import {ExternalLink,RefreshCw} from 'lucide-react';
import {CaseConversation} from './CaseConversation';
import {InstructionChat} from './InstructionChat';
import {useStaffUi} from './staff-language';
import {caseReason} from './clarification-locale';
import type {StaffRequestAuthority} from './useStaffRequest';

type StaffCase={id:string;status:string;reason:string;createdAt:string;helpText:string|null};
export function StaffInstructionChat({assignmentId,worker,cases,navigate,authority}:{
  assignmentId:string;worker?:string;cases:StaffCase[];navigate:(path:string)=>void;authority:StaffRequestAuthority;
}){
  const ui=useStaffUi(authority.session.timezone);
  const openCases=cases.filter(item=>item.status==='open');
  const newest=openCases[0]?.id??null,first=cases[0]?.id??null;
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string|null>(null),[dirty,setDirty]=useState(false),[refresh,setRefresh]=useState(0);
  const dismissed=useRef<string|null>(null);
  useEffect(()=>{
    setSelected(value=>value&&cases.some(item=>item.id===value)?value:newest??first);
    if(!newest)return;
    if(!open&&dismissed.current!==newest)setOpen(true);
  },[newest,first,open]);
  if(!cases.length)return null;
  const active=selected&&cases.some(item=>item.id===selected)?selected:newest??first;
  const selectedCase=cases.find(item=>item.id===active)||null;
  const close=()=>{dismissed.current=newest;setOpen(false);setDirty(false);};
  const subtitle=worker??ui.t('{count} open chats').replace('{count}',new Intl.NumberFormat(ui.locale).format(openCases.length));
  return <InstructionChat variant="staff" title={ui.t('Instruction chat')} subtitle={<bdi>{subtitle}</bdi>} launcher={ui.t('Instruction chat')} count={openCases.length} countLabel={ui.t('{count} open chats')} open={open} onOpen={()=>setOpen(true)} onClose={close} dirty={dirty} dir={ui.dir} lang={ui.locale} actions={<>
    <button type="button" className="icon-button" title={ui.t('Refresh chat')} aria-label={ui.t('Refresh chat')} disabled={dirty} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={18} aria-hidden="true"/></button>
    {active&&<button type="button" className="icon-button" title={ui.t('Open in clarifications')} aria-label={ui.t('Open in clarifications')} disabled={dirty} onClick={()=>navigate(`clarifications/${active}`)}><ExternalLink size={18} aria-hidden="true"/></button>}
  </>} copy={{
    close:ui.t('Close instruction chat'),closeTitle:ui.t('Close the chat?'),closeBody:ui.t('Your unsent message will be lost. Sent messages stay in the clarification record.'),keepWriting:ui.t('Keep writing'),closeConfirm:ui.t('Close chat'),
  }}>
    {open&&<>
      {cases.length>1&&<div className="instruction-chat-cases" role="group" aria-label={ui.t('Instruction chat')}>
        {cases.map(item=><button type="button" key={item.id} className={`instruction-chat-case${item.id===active?' is-active':''}`} aria-pressed={item.id===active} disabled={dirty} onClick={()=>setSelected(item.id)}>
          <span className={`instruction-chat-state is-${item.status}`}>{ui.state(item.status)}</span>
          <bdi className="instruction-chat-reason">{ui.reason(caseReason(ui.locale,item.reason))}</bdi>
        </button>)}
      </div>}
      {active&&<CaseConversation key={active} embedded caseId={active} assignmentId={assignmentId} session={{clientContext:authority.session.clientContext!,expiresAt:authority.session.expiresAt!}} language={ui.locale} timezone={authority.session.timezone} synthetic={authority.session.mode!=='live-credential'} current={authority.isCurrent} canMutate={authority.canMutate} canWrite={authority.canMutate()&&selectedCase?.status==='open'} leadingMessage={selectedCase?.helpText?{text:selectedCase.helpText,createdAt:selectedCase.createdAt}:null} onDirtyChange={setDirty} onSessionLost={authority.onSessionLost} refreshSignal={refresh}/>}
    </>}
  </InstructionChat>;
}
