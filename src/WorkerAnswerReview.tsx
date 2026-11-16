import {useId} from 'react';
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
    <p className="briefing-text" lang={contentLanguage} dir="auto">{multiple?chosen?.text??copy.unrecorded:answerText}</p>
    {!multiple&&<p className="muted">{copy.body}</p>}
  </section>;
}
