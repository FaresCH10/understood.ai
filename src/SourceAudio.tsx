import {useEffect,useRef,useState} from 'react';
import {Mic,Pause,Play,Square,Upload,Trash2,X} from 'lucide-react';
import {checkSourceAudio,prepareSourceAudio,SOURCE_AUDIO_MAX_BYTES,type PreparedSourceAudio} from './source-audio';

type Phase='idle'|'requesting'|'recording'|'preparing'|'preview';
export default function SourceAudio({disabled,onChange,onActivityChange,mode='record'}:{disabled:boolean;onChange:(value:PreparedSourceAudio|null)=>void;onActivityChange:(active:boolean)=>void;mode?:'record'|'upload'}) {
  const [phase,setPhase]=useState<Phase>('idle'),[error,setError]=useState(''),[url,setUrl]=useState(''),[seconds,setSeconds]=useState(0),[paused,setPaused]=useState(false);
  const current=useRef<Phase>('idle'),mounted=useRef(false),generation=useRef(0),recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null);
  const preview=useRef(''),prepared=useRef<PreparedSourceAudio|null>(null),decode=useRef<AbortController|null>(null),started=useRef(0),elapsedBefore=useRef(0);
  const callback=useRef(onChange);callback.current=onChange;
  const change=(next:Phase)=>{current.current=next;if(mounted.current)setPhase(next);};
  function release() {
    const media=recorder.current;recorder.current=null;
    if(media){media.onstop=null;media.onerror=null;media.ondataavailable=null;if(media.state!=='inactive')try{media.stop();}catch{/* Browser already stopped capture. */}}
    stream.current?.getTracks().forEach(track=>{track.onended=null;track.stop();});stream.current=null;
  }
  function clearPreview() {
    if(preview.current)URL.revokeObjectURL(preview.current);preview.current='';prepared.current=null;
    if(mounted.current)setUrl('');callback.current(null);
  }
  function cancel() {
    generation.current++;decode.current?.abort();decode.current=null;release();setError('');setPaused(false);elapsedBefore.current=0;
    change(prepared.current?'preview':'idle');
  }
  function discard() {cancel();clearPreview();setSeconds(0);change('idle');}
  function pause() {
    const media=recorder.current;
    if(!media || media.state!=='recording')return;
    elapsedBefore.current+=(performance.now()-started.current)/1000;
    try{media.pause();setPaused(true);}catch{setError('Recording could not be paused.');}
  }
  function resume() {
    const media=recorder.current;
    if(!media || media.state!=='paused')return;
    try{media.resume();started.current=performance.now();setPaused(false);}catch{setError('Recording could not be resumed.');}
  }
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;decode.current?.abort();release();if(preview.current)URL.revokeObjectURL(preview.current);};},[]);
  useEffect(()=>{onActivityChange(phase!=='idle');return()=>onActivityChange(false);},[phase,onActivityChange]);
  useEffect(()=>{
    if(phase!=='recording' || paused)return;
    const timer=setInterval(()=>{
      const elapsed=elapsedBefore.current+(performance.now()-started.current)/1000;
      setSeconds(Math.min(90,Math.floor(elapsed)));
      if(elapsed>=89)stopRecording.current();
    },250);
    return()=>clearInterval(timer);
  },[phase,paused]);
  useEffect(()=>{
    if(!['requesting','recording','preparing','preview'].includes(phase))return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[phase]);
  async function prepare(blob:Blob,version:number) {
    const controller=new AbortController();decode.current=controller;change('preparing');setError('');
    try {
      const next=await prepareSourceAudio(blob,crypto.randomUUID(),undefined,controller.signal);
      if(!mounted.current || version!==generation.current)return;
      const bytes=await next.recording.bytes();
      if(!mounted.current || version!==generation.current)return;
      const nextUrl=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));
      clearPreview();preview.current=nextUrl;prepared.current=next;setUrl(nextUrl);callback.current(next);change('preview');
    }catch(reason){if(mounted.current && version===generation.current){setError((reason as Error).message || 'Audio could not be prepared.');change(prepared.current?'preview':'idle');}}
    finally {if(decode.current===controller)decode.current=null;}
  }
  async function upload(file:File|undefined) {
    if(disabled || !file || !['idle','preview'].includes(current.current))return;
    try {checkSourceAudio(file);}catch(reason){setError((reason as Error).message);return;}
    await prepare(file,++generation.current);
  }
  async function start() {
    if(disabled || !['idle','preview'].includes(current.current))return;
    const version=++generation.current;change('requesting');setError('');let live:MediaStream|null=null;
    try {
      if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)throw Error('Microphone recording is unavailable on this device.');
      live=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true}});
      if(!mounted.current || version!==generation.current){live.getTracks().forEach(track=>track.stop());return;}
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(value=>MediaRecorder.isTypeSupported(value));
      const media=mime?new MediaRecorder(live,{mimeType:mime}):new MediaRecorder(live);
      let total=0,stopped=false,finished=false;const chunks:Blob[]=[];
      const fail=(message:string)=>{
        if(finished)return;finished=true;release();
        if(mounted.current && version===generation.current){setError(message);change(prepared.current?'preview':'idle');}
      };
      media.ondataavailable=event=>{if(finished || !event.data.size)return;total+=event.data.size;if(total>SOURCE_AUDIO_MAX_BYTES){fail('Source audio must be no larger than 10 MB.');return;}chunks.push(event.data);};
      media.onerror=()=>fail('Recording was interrupted. Your earlier preview, if any, is unchanged.');
      media.onstop=()=>{
        if(finished)return;finished=true;release();
        if(!mounted.current || version!==generation.current)return;
        if(!stopped){setError('Recording stopped unexpectedly. Record again.');change(prepared.current?'preview':'idle');return;}
        void prepare(new Blob(chunks,{type:media.mimeType}),version);
      };
      for(const track of live.getTracks())track.onended=()=>fail('Microphone disconnected. Record again.');
      recorder.current=media;stream.current=live;
      const stop=()=>{if(media.state==='recording' || media.state==='paused'){stopped=true;if(media.state==='paused')try{media.resume();}catch{/* Stop below still finalizes. */}try{media.stop();}catch{fail('Recording could not be stopped. Record again.');}}};
      media.start(500);started.current=performance.now();elapsedBefore.current=0;setPaused(false);setSeconds(0);change('recording');
      stopRecording.current=stop;
    }catch(reason){live?.getTracks().forEach(track=>track.stop());if(!mounted.current || version!==generation.current)return;release();setError((reason as DOMException).name==='NotAllowedError'?'Microphone permission was denied. Choose an audio file or use text.':(reason as Error).message || 'Microphone unavailable.');change(prepared.current?'preview':'idle');}
  }
  const stopRecording=useRef<()=>void>(()=>{}),locked=disabled || !['idle','preview'].includes(phase);
  const clock=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  return <div className={`source-audio source-audio-${mode}`}>
    {url && <label className="field">Source audio preview<audio controls src={url}/><span>{prepared.current?.durationSeconds.toFixed(1)} seconds</span></label>}
    {error && <p className="record-error" role="alert">{error}</p>}
    {phase==='requesting' && <p role="status">Waiting for microphone permission...</p>}{phase==='preparing' && <p role="status">Preparing source audio...</p>}
    {phase==='recording' && <div className="source-recording" role="status"><span className="source-wave" aria-hidden="true">{[9,16,25,34,19,28,40,22,31,17,26,38,20,12,24,33,18,27,14,21,10].map((height,index)=><i key={index} style={{height}} className={paused||index>13?'muted':''}/>)}</span><strong>{clock}</strong><small>{paused?'Paused':'Recording...'} · 90s maximum</small></div>}
    <div className="actions">
      {phase==='recording'?<>{paused?<button type="button" className="button outline" onClick={resume}><Play size={18}/>Resume</button>:<button type="button" className="button outline" onClick={pause}><Pause size={18}/>Pause</button>}<button type="button" className="button primary" onClick={()=>stopRecording.current()}><Square size={18}/>Finish recording</button></>:mode==='record'?<button type="button" className="button primary" disabled={locked} onClick={()=>void start()}><Mic size={18}/>Record source</button>:<label className={`button primary source-file${locked?' disabled':''}`}><Upload size={18}/>Choose audio file<input aria-label="Choose source audio file" type="file" accept="audio/*" disabled={locked} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void upload(file);}}/></label>}
      {mode==='record' && phase!=='recording' && <label className={`button outline source-file${locked?' disabled':''}`}><Upload size={18}/>Choose a file instead<input aria-label="Choose source audio file" type="file" accept="audio/*" disabled={locked} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void upload(file);}}/></label>}
      {['requesting','recording','preparing'].includes(phase) && <button type="button" className="button outline" onClick={cancel}><X size={18}/>Cancel audio capture</button>}
      {url && !locked && <button type="button" className="button outline" onClick={discard}><Trash2 size={18}/>Discard source audio</button>}
    </div>
    {mode==='record' && !url && phase!=='recording' && <p className="source-audio-hint">You can edit the transcript before AI processing.</p>}
  </div>;
}
