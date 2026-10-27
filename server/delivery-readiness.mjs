const nonempty=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max;
const RESPONSE_MODES=['question','acknowledge'];
const DELIVERY_MODES=['text','voice','both'];

// Mirrors readySnapshot's per-language checks so a partially prepared target
// language is reported as undelivered instead of blocking ready recipients.
export function recipientDeliveryReadiness(prepared,worker,modes={}) {
  const responseMode=modes?.responseMode ?? 'question',deliveryMode=modes?.deliveryMode ?? 'both';
  const language=typeof worker?.language==='string' && worker.language ? worker.language : null;
  if(!RESPONSE_MODES.includes(responseMode) || !DELIVERY_MODES.includes(deliveryMode) || !language)
    return {delivery:false,reason:'language_unavailable',language};
  const content=prepared?.languages?.[language];
  if(!content) return {delivery:false,reason:'language_unavailable',language};
  if(!nonempty(content.title,120) || !nonempty(content.text,5000))
    return {delivery:false,reason:'content_unavailable',language};
  if(responseMode==='question' && !nonempty(content.question,500))
    return {delivery:false,reason:'question_unavailable',language};
  const generatedSpeech=prepared?.artifactBundle && typeof content.speech==='object'
    && typeof content.speech?.body?.id==='string' && (responseMode!=='question' || typeof content.speech?.question?.id==='string');
  if(deliveryMode!=='text' && content.speech!=='device-synthesis-demo' && !generatedSpeech)
    return {delivery:false,reason:'speech_unavailable',language};
  return {delivery:true,reason:null,language};
}

export function groupedUndelivered(reasons) {
  const counts=new Map();
  for(const reason of reasons) {
    const key=reason.reason+':'+(reason.language || '');
    const value=counts.get(key) || {...reason,count:0};
    value.count+=1;counts.set(key,value);
  }
  return [...counts.values()];
}

