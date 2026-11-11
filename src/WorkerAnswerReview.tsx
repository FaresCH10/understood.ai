import {useId} from 'react';
import {Check} from 'lucide-react';
import {workerAnswerReviewText} from './worker-answer-review-text';
import type {WorkerUiLanguage} from './worker-ui-language';

type Choice={id:string;text:string};
export function WorkerAnswerReview({language,questionType,choices,answerText,contentLanguage}:{
  language:WorkerUiLanguage;questionType?:string;choices?:Choice[];answerText:string|null|undefined;contentLanguage:string;
}){
  const copy=workerAnswerReviewText(language),titleId=useId();
  if(!answerText)return null;
  const multiple=questionType==='multiple-choice'&&Array.isArray(choices)&&choices.length>0;
  const chosen=multiple?choices.find(choice=>choice.id===answerText):null;
  return <section className="worker-answer-record" aria-labelledby={titleId}>
    <h3 id={titleId}>{copy.title}</h3>
    {multiple?<ul className="worker-answer-record-list">
      {choices.map(choice=><li key={choice.id} className={choice.id===answerText?'is-chosen':''}>
        <span lang={contentLanguage} dir="auto">{choice.text}</span>
        {choice.id===answerText&&<span className="worker-answer-tag"><Check size={13} aria-hidden="true"/>{copy.chosen}</span>}
      </li>)}
    </ul>:<p className="briefing-text" lang={contentLanguage} dir="auto">{answerText}</p>}
    <p className="muted">{multiple&&!chosen?copy.unrecorded:copy.body}</p>
  </section>;
}
