import {useStaffText as useStaffStaticText} from './staff-language';
import {useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {usePublicationDetail} from './PublicationHistory';
import type {PublicationSummary} from './publication-history';
import {artifactField,artifactLanguages,artifactSpeechUrls,languageArtifacts} from './language-artifacts';

type Draft={id:string;source:string;state:string;next_version:number;revision:number;contentExpired?:boolean;archive?:unknown};
type Props={draft:Draft;publication:PublicationSummary|null;context:string;refresh:number};
export function InstructionOverview({draft,publication,context,refresh}:Props){
  const t=useStaffStaticText(),[tick,setTick]=useState(0);
  const [selectedLanguage,setSelectedLanguage]=useState('');
  const read=usePublicationDetail(draft.id,!draft.contentExpired?publication?.id||null:null,context,refresh+tick);
  const source=publication?read.data?.snapshot.source:draft.source;
  const deliveredLanguages=artifactLanguages.filter(language=>read.data?.sentLanguages?.includes(language.code));
  const language=deliveredLanguages.find(item=>item.code===selectedLanguage)??deliveredLanguages[0];
  const snapshot=read.data?.snapshot;
  const preview=language&&snapshot?languageArtifacts(snapshot,typeof source==='string'?source:'',language.code):null;
  const stored=language?snapshot?.languages?.[language.code]:undefined;
  const choiceList=(stored as {choices?:unknown}|undefined)?.choices;
  const choices=Array.isArray(choiceList)?choiceList.map(choice=>artifactField(choice?.text,500).value).filter(Boolean):[];
  const audio=publication&&language&&snapshot?.deliveryMode!=='text'
    ?artifactSpeechUrls(read.data?.artifactAudio,draft.id,publication.id,draft.revision,language.code):null;
  return <section className="panel instruction-content-panel minimal-instruction-overview">
    <h2>{t('Instruction')}</h2>
    {draft.contentExpired?<p>{t('Instruction content is no longer available.')}</p>:publication&&read.loading?<p role="status">{t('Loading instruction...')}</p>:publication&&read.error?<><p role="alert">{t('The instruction could not be loaded.')}</p><button className="button outline" onClick={()=>setTick(n=>n+1)}><RefreshCw size={17}/>{t('Try again')}</button></>:<>
      <p className="instruction-body-text" dir="auto">{typeof source==='string'?source:t('No instruction text is available.')}</p>
      {publication&&<div className="instruction-sent-languages"><h3>{t('Languages sent')}</h3>{read.data?.sentLanguages?.length?<ul>{read.data.sentLanguages.map(code=><li key={code}>{t.language(code)}</li>)}</ul>:<p>{t('No recipients yet.')}</p>}</div>}
      {language&&preview&&<details className="sent-worker-view">
        <summary>{t('View as worker')}</summary>
        <label className="field">{t('Recipient language')}<select value={language.code} onChange={event=>setSelectedLanguage(event.target.value)}>
          {deliveredLanguages.map(item=><option key={item.code} value={item.code}>{t.language(item.code)}</option>)}
        </select></label>
        <div lang={language.code} dir={language.dir} key={language.code} className="sent-worker-content">
          {preview.title.value&&<h3>{preview.title.value}</h3>}
          {preview.text.value&&snapshot?.deliveryMode!=='voice'&&<p>{preview.text.value}</p>}
          {audio&&<audio controls preload="none" src={audio.body} aria-label={t('Instruction audio')}/>}
          {preview.question.value&&snapshot?.responseMode!=='acknowledge'&&<>
            <h4>{preview.question.value}</h4>
            {choices.length>0&&<ul>{choices.map((choice,index)=><li key={index}>{choice}</li>)}</ul>}
            {audio&&<audio controls preload="none" src={audio.question} aria-label={t('Question audio')}/>}
          </>}
        </div>
        {!preview.text.value&&!audio&&<p>{t('No instruction text is available.')}</p>}
      </details>}
    </>}
  </section>;
}
