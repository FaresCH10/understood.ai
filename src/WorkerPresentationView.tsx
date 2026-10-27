import {useEffect,useId,useRef,useState} from 'react';
import {Languages} from 'lucide-react';
import {isWorkerLanguage} from '../server/languages.mjs';
import {readWorkerPresentations,requestWorkerPresentation,WorkerPresentationError,
  type InstructionPresentationContent,type PresentationSourceKind,type WorkerPresentationArtifact} from './worker-presentations';
import {workerPresentationText} from './worker-presentation-text';
import {workerUiDirection,workerUiNativeName,type WorkerUiLanguage} from './worker-ui-language';
import type {PageSession} from './session-state';

type ViewState=({kind:'ready'|'pending'|'failed';artifact:WorkerPresentationArtifact}|{kind:'not_required'|'unavailable'|'deferred'|'conflict'});

export function WorkerPresentationView({assignmentId,version,sourceKind,sourceId,originalLanguage,approvedLanguage,
  uiLanguage,session,disabled=false,compact=false,hasAudio=false,current,onSessionLost,onActive,onChoices,requiresChoices=false}:{
  assignmentId:string;version:number;sourceKind:PresentationSourceKind;sourceId?:string;
  originalLanguage:string;approvedLanguage:string;uiLanguage:WorkerUiLanguage;session:PageSession;
  disabled?:boolean;compact?:boolean;hasAudio?:boolean;current:()=>boolean;onSessionLost:()=>void;onActive?:(id:string|null)=>void;requiresChoices?:boolean;onChoices?:(choices:{id:string;text:string}[]|null)=>void;
}){
  const t=workerPresentationText[uiLanguage],panelId=useId();
  const [opened,setOpened]=useState(false),[busy,setBusy]=useState(false),[view,setView]=useState<ViewState|null>(null),[failure,setFailure]=useState('');
  const request=useRef<AbortController|null>(null);
  const notify=useRef(onActive);notify.current=onActive;
  const notifyChoices=useRef(onChoices);notifyChoices.current=onChoices;
  const enabled=isWorkerLanguage(originalLanguage)&&isWorkerLanguage(approvedLanguage)&&originalLanguage!==approvedLanguage
    &&(sourceKind==='instruction'||!!sourceId);
  useEffect(()=>()=>{request.current?.abort();notify.current?.(null);notifyChoices.current?.(null);},[]);
  useEffect(()=>{request.current?.abort();setOpened(false);setView(null);setFailure('');setBusy(false);},[assignmentId,version,sourceKind,sourceId,approvedLanguage]);
  const activeId=opened&&view?.kind==='ready'&&view.artifact.content
    &&(!requiresChoices||(view.artifact.content as InstructionPresentationContent).choices?.length===4)
    &&(view.artifact.sourceKind==='answer'||(view.artifact.content as {question?:string|null}).question)
    ?view.artifact.id:null;
  useEffect(()=>{notify.current?.(activeId);notifyChoices.current?.(activeId&&view?.kind==='ready'?(view.artifact.content as InstructionPresentationContent).choices??null:null);},[activeId,view]);
  if(!enabled)return null;
  const target=approvedLanguage as WorkerUiLanguage;
  const origin=((view&&'artifact' in view?view.artifact.originalLanguage:originalLanguage) as WorkerUiLanguage);
  const direction=workerUiDirection(target);
  const chosen=(items:WorkerPresentationArtifact[],status:'ready'|'pending'|'failed')=>items.find(item=>item.status===status)??null;
  const load=async(mode:'open'|'check')=>{
    if(busy||disabled||!current())return;
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    const guard=()=>current()&&!controller.signal.aborted;
    const expectedSourceId=sourceKind==='answer'?sourceId!:'';
    setBusy(true);setFailure('');
    try{
      if(mode==='open'){
        const list=await readWorkerPresentations(fetch,session,assignmentId,controller.signal,guard);
        const matches=list.items.filter(item=>item.sourceKind===sourceKind&&item.sourceId===expectedSourceId
          &&item.publicationVersion===version&&item.targetLanguage===target
          &&(!requiresChoices||item.status!=='ready'||(item.content as InstructionPresentationContent)?.choices?.length===4));
        for(const status of ['ready','pending','failed'] as const){
          const artifact=chosen(matches,status);
          if(artifact){setView({kind:status,artifact});setOpened(true);return;}
        }
      }
      const result=await requestWorkerPresentation(fetch,session,assignmentId,{requestId:crypto.randomUUID(),sourceKind,
        ...(sourceKind==='answer'?{sourceId:expectedSourceId}:{})},controller.signal,guard);
      if(result.status==='ready'||result.status==='pending'||result.status==='failed')setView({kind:result.status,artifact:result.presentation!});
      else if(result.status==='not_required'||result.status==='unavailable'||result.status==='deferred')setView({kind:result.status});
      else setView({kind:'unavailable'});
      setOpened(true);
    }catch(error){
      if(controller.signal.aborted||!current())return;
      if(error instanceof WorkerPresentationError&&error.code==='session'){onSessionLost();return;}
      if(error instanceof WorkerPresentationError&&error.code==='conflict'){setView({kind:'conflict'});setOpened(true);return;}
      setFailure(error instanceof WorkerPresentationError&&error.code==='unavailable'?t.unavailable:t.unknown);
    }finally{if(request.current===controller)setBusy(false);}
  };
  const hide=()=>{request.current?.abort();setOpened(false);setView(null);setFailure('');setBusy(false);};
  return <>
    <button type="button" className={compact?'button outline':'button outline full'} aria-expanded={opened} aria-controls={panelId}
      disabled={disabled||busy} onClick={()=>opened?hide():void load('open')}>
      <Languages size={18} aria-hidden="true"/>{busy?t.loading:opened?t.hide:t.view}
    </button>
    {opened&&<section className="worker-presentation" id={panelId} aria-label={t.title}>
      <div className="worker-card-head">
        <p className="muted">{t.title}{view&&'artifact' in view&&<> · <bdi>{workerUiNativeName(origin)}</bdi> → <bdi>{workerUiNativeName(target)}</bdi></>}</p>
        <button type="button" className="button subtle" onClick={hide}>{t.hide}</button>
      </div>
      {failure?<><p className="notice notice-amber" role="alert">{failure}</p><button type="button" className="button outline" disabled={busy} onClick={()=>void load('check')}>{busy?t.loading:t.check}</button></>:
       view?.kind==='ready'&&requiresChoices&&!(view.artifact.content as InstructionPresentationContent)?.choices?<><p role="status">{t.pending}</p><button type="button" className="button outline" disabled={busy} onClick={()=>void load('check')}>{busy?t.loading:t.check}</button></>:
       view?.kind==='ready'?<>
        {view.artifact.sourceKind==='instruction'&&view.artifact.content?<div lang={target} dir={direction}>
          <h3>{(view.artifact.content as {title:string}).title}</h3>
          <p className="briefing-text" lang={target} dir={direction}>{(view.artifact.content as {text:string}).text}</p>
          {(view.artifact.content as {question:string|null}).question&&<><h4>{t.question}</h4><p className="question" lang={target} dir={direction}>{(view.artifact.content as {question:string}).question}</p></>}
          {(view.artifact.content as InstructionPresentationContent).choices&&<ul>{(view.artifact.content as InstructionPresentationContent).choices!.map(choice=><li key={choice.id}>{choice.text}</li>)}</ul>}
        </div>:view.artifact.content?<div lang={target} dir={direction}>
          <h3>{t.answer}</h3>
          <p className="briefing-text" lang={target} dir={direction}>{(view.artifact.content as {text:string}).text}</p>
        </div>:null}
        <p className="muted">{t.ready}</p>
        <p className="muted">{t.providerLabel}: <bdi>{view.artifact.provider}</bdi> · {view.artifact.live?t.live:t.prepared}</p>
        <p className="muted">{sourceKind==='instruction'?t.boundNote:hasAudio?t.answerNote:null}</p>
       </>:
       view?.kind==='pending'?<><p role="status">{t.pending}</p><button type="button" className="button outline" disabled={busy} onClick={()=>void load('check')}>{busy?t.loading:t.check}</button></>:
       view?.kind==='failed'?<p role="alert">{t.failed}</p>:
       view?.kind==='deferred'?<p role="status">{t.deferred}</p>:
       view?.kind==='conflict'?<p role="alert">{t.conflict}</p>:
       view?.kind==='not_required'?<p role="status">{t.notRequired}</p>:
       view?.kind==='unavailable'?<p role="status">{t.unavailable}</p>:null}
    </section>}
  </>;
}
