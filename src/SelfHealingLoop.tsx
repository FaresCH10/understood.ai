import {useEffect,useRef,useState} from 'react';
import {RefreshCw,Sparkles} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {useStaffUi} from './staff-language';

type Counts={assessed:number;matched:number;clarification:number;matchRate:number|null};
type Improvement={publicationId:string;eligible:boolean;current:Counts;languages:(Counts & {language:string})[];
  signal:(Counts & {createdAt:string})|null;suggestion:{title:string;source:string}|null;
  followup:{briefingId:string;publicationId:string|null;state:string;counts:Counts}|null};

export function SelfHealingLoop({publicationId,authority,navigate}:{publicationId:string;authority:StaffRequestAuthority;navigate:(path:string)=>void}) {
  const ui=useStaffUi(authority.session.timezone);
  const {request,current}=useStaffRequest(authority),[open,setOpen]=useState(false),[tick,setTick]=useState(0),[busy,setBusy]=useState(false);
  const [data,setData]=useState<Improvement|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [title,setTitle]=useState(''),[source,setSource]=useState(''),edited=useRef(false),requestId=useRef(crypto.randomUUID());
  const canWrite=['owner','supervisor'].includes(authority.session.staffRole || '');
  const path=`/api/publications/${encodeURIComponent(publicationId)}/improvement`;
  const accept=(value:Improvement)=>{setData(value);if(value.suggestion&&!edited.current){setTitle(value.suggestion.title);setSource(value.suggestion.source);}};
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();setLoading(true);setError('');
    request<Improvement>(path,undefined,controller.signal).then(value=>{if(!controller.signal.aborted&&current())accept(value);})
      .catch(()=>{if(!controller.signal.aborted&&current())setError('Improvement unavailable. Refresh to check before retrying.');})
      .finally(()=>{if(!controller.signal.aborted&&current())setLoading(false);});
    return()=>controller.abort();
  },[open,tick,path,request,current]);
  const act=async(draft=false)=>{
    setBusy(true);setError('');
    try{const value=await request<Improvement>(draft?`${path}/draft`:path,draft?{requestId:requestId.current,title,source}:{});if(current())accept(value);}
    catch(caught){if(current())setError(caught instanceof Error?caught.message:'Improvement unavailable. Refresh to check before retrying.');}
    finally{if(current())setBusy(false);}
  };
  return <details lang={ui.locale} dir={ui.dir} className="instruction-loop-panel improvement-loop" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><Sparkles size={18} aria-hidden="true"/><span><strong>{ui.t('Improve this instruction')}</strong><small>{ui.t('Detect · review · re-check')}</small></span><span className="loop-badge">{ui.t(authority.session.mode==='live-credential'?'Rule-based analysis':'Simulated analysis')}</span></summary>
    <div className="instruction-loop-body">
      <p className="notice notice-blue">{ui.t('This local rule flags repeated clarification after at least 3 assessed responses, including at least 2 needing clarification and a 30% clarification rate. A supervisor reviews every corrective draft before preparation and publication.')}</p>
      <div className="actions"><button className="button outline" disabled={busy||loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={16}/>{ui.t('Refresh analysis')}</button>
        {canWrite&&data?.eligible&&!data.signal&&<button className="button" disabled={busy||loading} onClick={()=>void act()}>{ui.t('Analyze responses')}</button>}
      </div>
      {error&&<p role="alert" className="notice notice-amber">{ui.error(error,'Improvement unavailable. Refresh to check before retrying.')}</p>}
      {loading?<p role="status">{ui.t('Loading instruction analysis...')}</p>:data&&<>
        <p>{ui.t('Latest assessed responses: {assessed} · Need clarification: {clarification} · {match}',{assessed:ui.number(data.current.assessed),clarification:ui.number(data.current.clarification),match:data.current.matchRate===null?ui.t('No assessed answers yet'):ui.t('{rate} match the checked facts',{rate:ui.percent(data.current.matchRate)})})}</p>
        {data.languages.length>0&&<ul className="improvement-languages">{data.languages.map(group=><li key={group.language}><strong>{ui.language(group.language)}</strong>: {ui.t('Matches: {matched} / {assessed} · Need clarification: {clarification}',{matched:ui.number(group.matched),assessed:ui.number(group.assessed),clarification:ui.number(group.clarification)})}</li>)}</ul>}
        {!data.signal&&<p>{ui.t(data.eligible?'Repeated clarification detected. Analyze now or wait for the local background check.':'No repeated-clarification signal at this threshold. Acknowledgments are excluded from assessment counts.')}</p>}
        {data.signal&&<>
          <p className="notice notice-amber">{ui.t('When detected: {clarification} of {assessed} responses needed clarification. Review wording, translation and the question before deciding what to change.',{clarification:ui.number(data.signal.clarification),assessed:ui.number(data.signal.assessed)})}</p>
          {data.followup?<section aria-label={ui.t('Corrective instruction follow-up')}><h3>{data.followup.state==='draft'?ui.t('Corrective draft created'):ui.t('Follow-up instruction · {state}',{state:ui.state(data.followup.state)})}</h3>
            <button className="button" onClick={()=>navigate(`briefings/${data.followup!.briefingId}`)}>{ui.t(data.followup.state==='draft'?'Open corrective draft':'Open corrective instruction')}</button>
            {data.followup.state==='published'&&<p>{ui.t('Original checks: {rate} ({matched}/{assessed}). Follow-up checks: {followup}.',{rate:data.signal.matchRate===null?ui.t('No assessed answers yet'):ui.percent(data.signal.matchRate),matched:ui.number(data.signal.matched),assessed:ui.number(data.signal.assessed),followup:data.followup.counts.matchRate===null?ui.t('waiting for answers'):ui.t('{rate} match ({matched}/{assessed})',{rate:ui.percent(data.followup.counts.matchRate),matched:ui.number(data.followup.counts.matched),assessed:ui.number(data.followup.counts.assessed)})})}</p>}
            <p>{ui.t('Follow-up counts use workers assigned the original instruction. Participation and active membership can change; this comparison does not establish cause or certify understanding.')}</p>
          </section>:data.suggestion?<>
            <p>{ui.t('The proposed draft separates the original sentences. Check every fact and edit it for clarity. It opens as a separate instruction and uses the normal review and publication steps.')}</p>
            {canWrite?<div className="improvement-editor"><label className="field">{ui.t('Corrective title')}<input dir="auto" value={title} maxLength={120} disabled={busy} onChange={event=>{edited.current=true;setTitle(event.target.value);}}/></label>
              <label className="field">{ui.t('Review corrective instruction')}<textarea dir="auto" rows={6} value={source} maxLength={4000} disabled={busy} onChange={event=>{edited.current=true;setSource(event.target.value);}}/></label>
              <button className="button" disabled={busy||title.trim().length<3||source.trim().length<10} onClick={()=>void act(true)}>{ui.t(busy?'Saving draft...':'Create corrective draft')}</button></div>:<p>{ui.t('Only an owner or supervisor can create a corrective draft.')}</p>}
          </>:<p>{ui.t('The original content is unavailable for a corrective draft.')}</p>}
        </>}
      </>}
    </div>
  </details>;
}
