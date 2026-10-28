import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,Headphones,MessageCircle,Pause,RefreshCw} from 'lucide-react';
import {gsap,useGSAP,ScrollTrigger} from './gsap-scroll';
import {landingCopy,type LandingLocale} from './landing-content';

const exampleCopy={
  en:{name:'English',direction:'ltr',text:'Put finished items on the blue shelf. Leave the walkway clear.',question:'Which shelf is for finished items?',choices:['Blue shelf','Yellow shelf','Red shelf','Green shelf']},
  ar:{name:'العربية',direction:'rtl',text:'ضع المنتجات المكتملة على الرف الأزرق. أبقِ الممر خالياً.',question:'أي رف مخصص للمنتجات المكتملة؟',choices:['الرف الأزرق','الرف الأصفر','الرف الأحمر','الرف الأخضر']},
  ur:{name:'اردو',direction:'rtl',text:'مکمل اشیا نیلے شیلف پر رکھیں۔ راستہ صاف رکھیں۔',question:'مکمل اشیا کس شیلف پر رکھنی ہیں؟',choices:['نیلا شیلف','پیلا شیلف','سرخ شیلف','سبز شیلف']},
} as const;
type ExampleLanguage=keyof typeof exampleCopy;

export function LandingDemo({locale,motionPaused=false}:{locale:LandingLocale;motionPaused?:boolean}){
  const t=landingCopy[locale],root=useRef<HTMLDivElement>(null);
  const [language,setLanguage]=useState<ExampleLanguage>(locale),[choice,setChoice]=useState<number|null>(null),[result,setResult]=useState<number|null>(null);
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]),[playing,setPlaying]=useState(false),[error,setError]=useState('');
  const utterance=useRef<SpeechSynthesisUtterance|null>(null),example=exampleCopy[language];
  const voice=voices.find(item=>item.lang.toLowerCase().split(/[-_]/)[0]===language);

  function stop(){if(utterance.current&&'speechSynthesis' in window)window.speechSynthesis.cancel();utterance.current=null;setPlaying(false);}
  useEffect(()=>{stop();setLanguage(locale);setChoice(null);setResult(null);setError('');},[locale]);
  useEffect(()=>{
    if(!('speechSynthesis' in window))return;
    const update=()=>setVoices(window.speechSynthesis.getVoices());update();window.speechSynthesis.addEventListener('voiceschanged',update);
    return()=>{window.speechSynthesis.removeEventListener('voiceschanged',update);if(utterance.current)window.speechSynthesis.cancel();utterance.current=null;};
  },[]);
  useGSAP(()=>{
    if(result!==null&&!motionPaused&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      gsap.from('.landing-demo-result',{y:8,opacity:0,duration:.2,ease:'power2.out'});
    ScrollTrigger.refresh();
  },{scope:root,dependencies:[result,language,motionPaused],revertOnUpdate:true});

  function play(){
    if(playing){stop();return;}if(!voice||!('speechSynthesis' in window))return;
    setError('');const value=new SpeechSynthesisUtterance(example.text);value.voice=voice;value.lang=voice.lang;utterance.current=value;
    value.onend=()=>{if(utterance.current===value){utterance.current=null;setPlaying(false);}};
    value.onerror=()=>{if(utterance.current===value){utterance.current=null;setPlaying(false);setError(t.audioFailed);}};
    setPlaying(true);window.speechSynthesis.speak(value);
  }

  return <div className="landing-demo" ref={root} data-testid="landing-demo">
    <div className="landing-demo-header"><span><span className="landing-status-dot"/>{t.example}</span><label><span className="visually-hidden">{t.exampleLanguage}</span><select aria-label={t.exampleLanguage} value={language} onChange={event=>{stop();setLanguage(event.target.value as ExampleLanguage);setChoice(null);setResult(null);setError('');}}>{Object.entries(exampleCopy).map(([code,item])=><option key={code} value={code} lang={code}>{item.name}</option>)}</select></label></div>
    <div className="landing-demo-body">
      <span className="landing-mini-label">{t.exampleSource}</span>
      <p className="landing-demo-instruction" lang={language} dir={example.direction}>{example.text}</p>
      <div className="landing-demo-audio"><button type="button" className="landing-audio-button" onClick={play} disabled={!voice}>{playing?<Pause size={16} aria-hidden="true"/>:<Headphones size={16} aria-hidden="true"/>}{playing?t.stop:t.play}</button><span>{voice?t.voiceNote:t.noVoice}</span></div>
      {error&&<p role="alert">{error}</p>}
      <form onSubmit={event=>{event.preventDefault();if(choice!==null)setResult(choice);}}>
        <fieldset className="landing-demo-choices"><legend><span className="landing-mini-label">{t.exampleQuestion}</span><span className="landing-demo-question" lang={language} dir={example.direction}>{example.question}</span><span className="landing-choice-hint">{t.choose}</span></legend>{example.choices.map((text,index)=><label key={text} className={choice===index?'is-selected':''} lang={language} dir={example.direction}><input type="radio" name="landing-shelf-choice" value={index} checked={choice===index} onChange={()=>{setChoice(index);setResult(null);}}/><span>{text}</span></label>)}</fieldset>
        <button className="landing-button landing-button--primary landing-demo-submit" disabled={choice===null} type="submit">{t.check}<ArrowRight size={17} className="landing-forward" aria-hidden="true"/></button>
      </form>
      <div className="landing-demo-result-area" aria-live="polite" aria-atomic="true">{result!==null&&<div className={`landing-demo-result ${result===0?'is-matched':'needs-follow-up'}`} role="status">{result===0?<Check size={21} aria-hidden="true"/>:<MessageCircle size={21} aria-hidden="true"/>}<div><strong>{result===0?t.correct:t.incorrect}</strong><p>{result===0?t.correctBody:t.incorrectBody}</p><button type="button" onClick={()=>{setChoice(null);setResult(null);}}><RefreshCw size={13} aria-hidden="true"/>{t.reset}</button></div></div>}</div>
      <p className="landing-demo-privacy">{t.demoPrivacy}</p>
    </div>
  </div>;
}
