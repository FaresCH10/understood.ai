import {useEffect,useRef,useState} from 'react';
import {CaseConversation} from './CaseConversation';
import {InstructionChat} from './InstructionChat';
import {useStaffUi} from './staff-language';
import {caseReason} from './clarification-locale';
import type {StaffRequestAuthority} from './useStaffRequest';

type StaffCase={id:string;status:string;reason:string};
export function StaffInstructionChat({assignmentId,cases,navigate,authority}:{
  assignmentId:string;cases:StaffCase[];navigate:(path:string)=>void;authority:StaffRequestAuthority;
}){
  const ui=useStaffUi(authority.session.timezone);
  const openCases=cases.filter(item=>item.status==='open');
  const newest=openCases[0]?.id??null;
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string|null>(null),[dirty,setDirty]=useState(false);
  const dismissed=useRef<string|null>(null);
  useEffect(()=>{
    if(!newest)return;
    setSelected(value=>value&&openCases.some(item=>item.id===value)?value:newest);
    if(!open&&dismissed.current!==newest)setOpen(true);
  },[newest,open]);
  if(!openCases.length)return null;
  const active=selected&&openCases.some(item=>item.id===selected)?selected:newest;
  const close=()=>{dismissed.current=newest;setOpen(false);setDirty(false);};
  return <InstructionChat variant="staff" title={ui.t('Instruction chat')} launcher={ui.t('Instruction chat')} count={openCases.length} countLabel={ui.t('{count} open chats')} open={open} onOpen={()=>setOpen(true)} onClose={close} dirty={dirty} dir={ui.dir} lang={ui.locale} copy={{
    close:ui.t('Close instruction chat'),closeTitle:ui.t('Close the chat?'),closeBody:ui.t('Your unsent message will be lost. Sent messages stay in the clarification record.'),keepWriting:ui.t('Keep writing'),closeConfirm:ui.t('Close chat'),
  }}>
    {open&&<>
      <div className="instruction-chat-cases" role="group" aria-label={ui.t('Instruction chat')}>
        {openCases.map(item=><button type="button" key={item.id} className={`instruction-chat-case${item.id===active?' is-active':''}`} aria-pressed={item.id===active} disabled={dirty} onClick={()=>setSelected(item.id)}>
          <span className="instruction-chat-state is-open">{ui.state(item.status)}</span>
          <bdi className="instruction-chat-reason">{ui.reason(caseReason(ui.locale,item.reason))}</bdi>
        </button>)}
      </div>
      {active&&<CaseConversation key={active} embedded caseId={active} assignmentId={assignmentId} session={{clientContext:authority.session.clientContext!,expiresAt:authority.session.expiresAt!}} language={ui.locale} timezone={authority.session.timezone} synthetic={authority.session.mode!=='live-credential'} current={authority.isCurrent} canMutate={authority.canMutate} canWrite={authority.canMutate()} onDirtyChange={setDirty} onSessionLost={authority.onSessionLost}/>}
      {active&&<button type="button" className="back-link instruction-chat-older" onClick={()=>navigate(`clarifications/${active}`)}>{ui.t('Open in clarifications')}</button>}
    </>}
  </InstructionChat>;
}
