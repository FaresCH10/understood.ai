import {isWorkerLanguage} from '../server/languages.mjs';
import React,{useEffect,useId,useRef,useState} from 'react';
import {CheckCircle2,Play,RotateCcw,Square,TriangleAlert} from 'lucide-react';
import {artifactField,artifactLanguages,artifactVoiceLanguage,artifactSpeechUrls,languageArtifacts,type PreparedArtifacts} from './language-artifacts';
import {DraftReview} from './DraftReview';
import {RegenerationControl} from './Regeneration';
import {ArtifactCopy} from './ArtifactCopy';
import {ArtifactGlossary} from './ArtifactGlossary';
import {artifactReviewTabs,nextArtifactTab,type ArtifactReviewTab} from './artifact-review';
import {PublicationPicker,usePublicationDetail} from './PublicationHistory';
import type {PublicationSummary} from './publication-history';
import type {StaffRequestAuthority} from './useStaffRequest';

type Props={draft:{id:string;source:string;revision:number;next_version:number;state:string;prepared:PreparedArtifacts|null;artifactAudio?:unknown;regenerationLanguages?:string[];targetRegeneration?:{jobId:string;status:string;language:string;kind:string}|null;review?:{revision:number;question:string;facts:string[];askedFacts:string[];translations?:import('./review-recovery').TranslationEdits};archive?:unknown};selected:PublicationSummary|null;onSelect:(value:PublicationSummary|null)=>void;refresh:number;canViewRubric:boolean;scope?:string|null;clientContext:string;onChanged:()=>void;onEditingChange:(value:boolean)=>void;authority:StaffRequestAuthority};
const fieldLabels={present:'Present',missing:'Missing',invalid:'Invalid'};

export function LanguageArtifacts({draft,selected,onSelect,refresh,canViewRubric,scope,clientContext,onChanged,onEditingChange,authority}:Props) {
  const selection=selected?.id || 'draft';
  const [target,setTarget]=useState('ar'),[detailTick,setDetailTick]=useState(0);
  const published=usePublicationDetail(draft.id,selected?.id || null,clientContext,refresh+detailTick);
  const [tab,setTab]=useState<ArtifactReviewTab>('text'),tabId=useId(),tabRefs=useRef<Record<string,HTMLButtonElement|null>>({});
  const [reviewEditing,setReviewEditing]=useState(false),[regenerating,setRegenerating]=useState(false);
  const editing=reviewEditing || regenerating;
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]),[playing,setPlaying]=useState(''),[error,setError]=useState('');
  const currentPreview=useRef<SpeechSynthesisUtterance|null>(null);
  const bodyPlayer=useRef<HTMLAudioElement|null>(null),questionPlayer=useRef<HTMLAudioElement|null>(null);
  const [audioError,setAudioError]=useState<'body'|'question'|null>(null);
  const publication=published.data;
  const prepared=selection==='draft' ? draft.prepared : publication?.snapshot || null;
  const source=selection==='draft' ? draft.source : artifactField(prepared?.source,4000).value;
  const view=languageArtifacts(prepared,source,target);
  const audioMap=selection==='draft' ? draft.artifactAudio : publication?.artifactAudio;
  const speech=canViewRubric && view.sourceMatches ? artifactSpeechUrls(audioMap,draft.id,selection,draft.revision,target) : null;
  const language=artifactLanguages.find((item) => item.code===target)!;
  const voice=voices.find((item) => artifactVoiceLanguage(item.lang,target));
  const sourceQuestion=artifactField(prepared?.question,500);
  const known=artifactLanguages.map((item) => item.code as string);
  const unknown=Object.keys(prepared?.languages || {}).filter((code) => !known.includes(code));
  const adapter=artifactField(prepared?.provenance?.adapter,120).value;
  const savedTranslation=isWorkerLanguage(target) && target!=='en' ? draft.review?.translations?.[target] : null;
  useEffect(() => {
    if(!('speechSynthesis' in window)) return;
    const load=() => setVoices(window.speechSynthesis.getVoices());
    load();window.speechSynthesis.addEventListener('voiceschanged',load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged',load);
  },[]);
  useEffect(() => {
    const players=[bodyPlayer.current,questionPlayer.current];
    currentPreview.current=null;window.speechSynthesis?.cancel();setPlaying('');setError('');setAudioError(null);
    return () => {currentPreview.current=null;window.speechSynthesis?.cancel();players.forEach(player=>player?.pause());};
  },[selection,target,tab,view.text.value,view.question.value,view.canPreview,draft.revision,speech?.body,speech?.question,canViewRubric,editing]);
  const preview=(kind:'briefing'|'question') => {
    if(!view.canPreview || !voice || !('speechSynthesis' in window)) return;
    bodyPlayer.current?.pause();questionPlayer.current?.pause();
    currentPreview.current=null;window.speechSynthesis.cancel();setError('');
    const utterance=new SpeechSynthesisUtterance(kind==='briefing' ? view.text.value : view.question.value);
    utterance.voice=voice;utterance.lang=voice.lang;
    utterance.onend=() => {if(currentPreview.current===utterance) {currentPreview.current=null;setPlaying('');}};
    utterance.onerror=(event) => {if(currentPreview.current!==utterance) return;currentPreview.current=null;setPlaying('');if(!['canceled','interrupted'].includes(event.error)) setError('Device speech could not play. No generated audio file is available.');};
    currentPreview.current=utterance;setPlaying(kind);window.speechSynthesis.speak(utterance);
  };
  const renderAudio=(kinds:('body'|'question')[]) => <div className="artifact-audio"><h3>Audio evidence</h3>
    {speech ? kinds.map(kind=><div key={[selection,draft.revision,target,kind].join(':')}>
      <div className="artifact-field-heading"><h4>{kind==='body'?'Instruction audio':'Question audio'}</h4><ArtifactCopy value={location.origin+speech[kind]} label={kind==='body'?'Copy private instruction audio link':'Copy private question audio link'} context={clientContext} disabled={editing}/></div>
      <audio ref={kind==='body'?bodyPlayer:questionPlayer} controls preload="none" src={speech[kind]} aria-label={language.name+' '+(kind==='body'?'instruction':'question')+' audio'}
        onPlay={()=>{currentPreview.current=null;window.speechSynthesis?.cancel();setPlaying('');(kind==='body'?questionPlayer:bodyPlayer).current?.pause();}} onError={()=>setAudioError(kind)}/>
      {audioError===kind && <><p role="alert">Private audio could not be loaded. No device speech has been substituted.</p><button className="button outline" title="Reload private audio" onClick={()=>{setAudioError(null);(kind==='body'?bodyPlayer:questionPlayer).current?.load();}}><RotateCcw size={18}/>Reload audio</button></>}
    </div>):<p>No verified private generated audio file is available for this language.</p>}
    {view.canPreview && <><p>{voice?'Device voice: '+voice.name+' ('+voice.lang+')':'No '+language.name+' device voice is available.'}</p><div className="actions">
      {kinds.map(kind=><button key={kind} className="button outline" disabled={!voice || editing} onClick={()=>preview(kind==='body'?'briefing':'question')}><Play size={18}/>{kind==='body'?'Preview text on device':'Preview question on device'}</button>)}
      {playing && <button className="icon-button" title="Stop device preview" aria-label="Stop device preview" onClick={()=>{currentPreview.current=null;window.speechSynthesis.cancel();setPlaying('');}}><Square size={18}/></button>}
    </div><span role="status">{playing?'Playing '+playing+' on this device':''}</span></>}{error && <p role="alert">{error}</p>}
  </div>;
  const rubric=canViewRubric && <details className="artifact-rubric"><summary>Private answer rubric</summary>{Array.isArray(prepared?.rubric?.askedFacts)?<ul>{prepared.rubric.askedFacts.map((value,index)=><li key={index}>{artifactField(value,500).value || 'Invalid stored rubric fact'}</li>)}</ul>:<p>No stored answer rubric.</p>}</details>;
  const field=(label:string,value:string,code:string,direction:string)=> <><div className="artifact-field-heading"><h3>{label}</h3><ArtifactCopy value={value} label={'Copy '+(code==='en'?'English':language.name)+' '+label.toLowerCase()} context={clientContext} disabled={editing || !view.sourceMatches}/></div><p className="artifact-text" lang={code} dir={direction}>{value || 'Not available'}</p></>;
  return <section className="language-artifacts" aria-label="Language coverage and artifacts">
    <div className="filters artifact-filters">
      <label className="select-label">Target language<select disabled={editing} value={target} onChange={event=>setTarget(event.target.value)}>{artifactLanguages.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
    </div>
    <PublicationPicker briefingId={draft.id} selected={publication || selected} onSelect={onSelect} context={clientContext} refresh={refresh} disabled={editing} allowDraft draftLabel={`Draft v${draft.next_version} · revision ${draft.revision}`}/>
    {selected && published.loading && <p role="status">Loading selected version...</p>}
    {selected && published.error && <><p role="alert">{published.error}</p><button className="icon-button" title="Reload selected version" aria-label="Reload selected version" disabled={editing} onClick={()=>setDetailTick(n=>n+1)}><RotateCcw size={18}/></button></>}
    <div className="artifact-provenance"><strong>{selection==='draft'?'Draft v'+draft.next_version+' · revision '+draft.revision+' · '+draft.state:publication?'v'+publication.version+' · '+publication.state+' · immutable':'v'+selected?.version+' · evidence '+(published.loading?'loading':'unavailable')}</strong><span>Adapter: <bdi>{selected && !publication?'Not loaded':adapter || 'Not recorded'}</bdi></span><span>{selected && !publication?'No artifact evidence loaded':view.synthetic || prepared?.provenance?.dataClass==='synthetic'?'Synthetic outputs · no live AI verification':'Live artifact verification unavailable'}</span></div>
    {(!selected || publication) && <div className="artifact-coverage table-wrap" tabIndex={0} role="region" aria-label="Stored language coverage"><table><caption className="sr-only">Stored language fields and audio evidence</caption><thead><tr><th>Language</th><th>Title</th><th>Text</th><th>Question</th><th>Audio</th></tr></thead><tbody>{artifactLanguages.map(item=>{const result=languageArtifacts(prepared,source,item.code),privateAudio=canViewRubric && result.sourceMatches && artifactSpeechUrls(audioMap,draft.id,selection,draft.revision,item.code);return <tr key={item.code} className={item.code===target?'selected':''}><th scope="row"><button className="text-link" disabled={editing} aria-pressed={item.code===target} onClick={()=>setTarget(item.code)}>{item.name}</button></th><td>{fieldLabels[result.title.status]}</td><td>{fieldLabels[result.text.status]}</td><td>{fieldLabels[result.question.status]}</td><td>{privateAudio?'Private generated audio':result.audio==='device-demo'?'Device demo only':result.audio==='missing'?'Missing':'Unverified'}</td></tr>;})}</tbody></table></div>}
    {unknown.length>0 && <p role="status">Unsupported stored languages ({unknown.length}): <bdi>{unknown.slice(0,20).join(', ')}</bdi>{unknown.length>20?'...':''}</p>}
    <div className="artifact-tabs" role="tablist" aria-label="Artifact views">{artifactReviewTabs.map(item=><button type="button" role="tab" key={item} id={tabId+'-'+item+'-tab'} aria-controls={tabId+'-'+item+'-panel'} aria-selected={tab===item} tabIndex={tab===item?0:-1} disabled={editing} ref={element=>{tabRefs.current[item]=element;}} onClick={()=>setTab(item)} onKeyDown={event=>{const next=nextArtifactTab(item,event.key);if(next){event.preventDefault();setTab(next);tabRefs.current[next]?.focus();}}}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div>
    {artifactReviewTabs.filter(item=>item!==tab).map(item=><div key={item} hidden id={tabId+'-'+item+'-panel'} role="tabpanel" aria-labelledby={tabId+'-'+item+'-tab'}/>)}
    <div key={[selection,target,draft.revision,tab,clientContext].join(':')} id={tabId+'-'+tab+'-panel'} className="artifact-tab-panel" role="tabpanel" aria-labelledby={tabId+'-'+tab+'-tab'} tabIndex={0}>
      {!prepared?<p role="status">{selected && published.loading?'Loading selected version...':selected && published.error?'Selected version evidence is unavailable.':selection==='draft' && draft.state==='processing'?'Draft preparation is processing. Language outputs are not available yet.':'No prepared language outputs are stored for this version.'}</p>:tab==='glossary'?<ArtifactGlossary key={target} target={target} context={clientContext} prepared={prepared} disabled={editing}/>:<>
        {!view.sourceMatches && <div className="notice notice-amber" role="status"><TriangleAlert size={22}/><span>Stored outputs do not match this source. They cannot be previewed as the current draft.</span></div>}
        <div className="artifact-comparison">
          <section className="artifact-column" aria-label="English source"><h2>English source</h2>
            {tab==='question'?<>{field('Question',sourceQuestion.value,'en','ltr')}{rubric}</>:<>{field('Instruction',source,'en','ltr')}{tab==='text' && <>{Array.isArray(prepared.facts) && <><h3>Key facts</h3><ul>{prepared.facts.map((value,index)=><li key={index}>{artifactField(value,500).value || 'Invalid stored fact'}</li>)}</ul></>}{rubric}</>}{tab==='audio' && field('Question',sourceQuestion.value,'en','ltr')}</>}
          </section>
          <section className="artifact-column" aria-label={language.name+' artifacts'}><h2>{language.name}</h2>
            {tab==='text'?<>{field('Title',view.title.value,target,language.dir)}{field('Instruction',view.text.value,target,language.dir)}{renderAudio(['body'])}</>:tab==='question'?<>{field('Question',view.question.value,target,language.dir)}{renderAudio(['question'])}</>:<>{field('Instruction',view.text.value,target,language.dir)}{field('Question',view.question.value,target,language.dir)}{renderAudio(['body','question'])}</>}
          </section>
        </div>
        <div className="artifact-check"><CheckCircle2 size={20}/><span>Field presence is a technical check, not a correctness assessment or proof of safe work.</span></div>
      </>}
    </div>
    {selection==='draft' && canViewRubric && !draft.archive && draft.targetRegeneration?.language===target && ['queued','processing','failed'].includes(draft.targetRegeneration.status) && <p role="status">{language.name} {draft.targetRegeneration.kind} regeneration: {draft.targetRegeneration.status}. <a className="text-link" href={`#processing/${encodeURIComponent(draft.targetRegeneration.jobId)}`}>View processing job</a></p>}
    {selection==='draft' && canViewRubric && !draft.archive && draft.id && !reviewEditing && (regenerating || draft.regenerationLanguages?.includes(target)) && isWorkerLanguage(target) && <RegenerationControl authority={authority} key={`regeneration-${draft.revision}-${target}`} id={draft.id} revision={draft.revision} language={target} scope={scope} disabled={draft.state==='processing'} onChanged={onChanged} onEditingChange={value=>{setRegenerating(value);onEditingChange(value);}}/>}
    {selection==='draft' && canViewRubric && !draft.archive && draft.id && !regenerating && (speech || savedTranslation && draft.review?.revision===draft.revision) && isWorkerLanguage(target) && target!=='en' && <DraftReview authority={authority} key={`${draft.revision}-${target}`} id={draft.id} revision={draft.revision} review={draft.review || null} prepared={null} canWrite scope={scope} disabled={draft.state==='processing'} failed={draft.state==='failed'} target={{code:target,name:language.name,dir:language.dir,title:view.title.value,text:view.text.value,question:view.question.value}} onChanged={onChanged} onEditingChange={value=>{setReviewEditing(value);onEditingChange(value);}}/>}
  </section>;
}
