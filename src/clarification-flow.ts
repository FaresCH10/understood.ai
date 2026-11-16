export type ClarificationExchange={id:string;kind:'request'|'explanation';state:'queued'|'processing'|'delivered'|'failed';text:string|null;language:string;originalText:string|null;originalLanguage:string|null;createdAt:string;attemptId:string};
export type ClarificationFlow={clientContext:string;caseId:string|null;assignmentId?:string;attemptId?:string;worker?:string;title?:string;instruction?:string;question?:string;answer?:string;outcome?:string;status?:string;needsArea:boolean;items:ClarificationExchange[]};
export type ClarificationCommand={requestId:string;text:string};
export function readClarificationCommand(key:string):ClarificationCommand|null{
  const raw=sessionStorage.getItem(key);if(!raw)return null;const value=JSON.parse(raw);
  if(!value||Object.keys(value).sort().join(',')!=='requestId,text'||typeof value.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(value.requestId)||typeof value.text!=='string'||value.text.trim().length<3||value.text.length>500)throw Error('Unverified clarification recovery');
  return value;
}
export function checkedClarificationFlow(value:unknown,context:string):ClarificationFlow{
  if(!value||typeof value!=='object')throw Error('Clarification unavailable');
  const data=value as ClarificationFlow;
  if(data.clientContext!==context)throw Error('Session changed');
  if(typeof data.needsArea!=='boolean'||data.caseId!==null&&typeof data.caseId!=='string'||!Array.isArray(data.items)||data.items.length>1000
    ||data.items.some(item=>!item||typeof item.id!=='string'||!['request','explanation'].includes(item.kind)||!['queued','processing','delivered','failed'].includes(item.state)
      ||item.text!==null&&typeof item.text!=='string'||item.originalText!==null&&typeof item.originalText!=='string'))throw Error('Clarification unavailable');
  return data;
}
export const clarificationFlowCopy=(language:string)=>language==='ar'?{
  area:'أي جزء من التعليمات يحتاج إلى توضيح؟',required:'إجابتك غير صحيحة. اشرح الجزء الذي لم تفهمه قبل المتابعة.',send:'أرسل طلب التوضيح',sent:'تم إرسال طلبك إلى المشرف. انتظر الشرح قبل المحاولة مجدداً.',preparing:'جارٍ إعداد الترجمة…',failed:'تعذّر إكمال الترجمة. سيبقى الطلب محفوظاً.',explanation:'توضيح المشرف',retry:'تحقق من الحالة',error:'تعذّر تأكيد الطلب. حاول مجدداً لإرسال الطلب نفسه.',back:'العودة إلى التعليمات',write:'اشرح التعليمات',followup:'إرسال الشرح وإعادة المحاولة',wrong:'الإجابة المختارة',request:'الجزء غير الواضح',waiting:'بانتظار أن يحدد العامل الجزء غير الواضح.',title:'التوضيحات',empty:'لا توجد طلبات توضيح.',instruction:'التعليمات',question:'السؤال',pending:'بانتظار التوضيح',delivered:'تم إرسال المتابعة',saved:'تم حفظ الشرح. ستصل المتابعة بعد اكتمال الترجمة.'
}:language==='ur'?{
  area:'ہدایت کا کون سا حصہ واضح نہیں؟',required:'جواب درست نہیں۔ آگے بڑھنے سے پہلے بتائیں کہ کون سا حصہ واضح نہیں۔',send:'وضاحت کی درخواست بھیجیں',sent:'درخواست سپروائزر کو بھیج دی گئی۔ دوبارہ کوشش سے پہلے وضاحت کا انتظار کریں۔',preparing:'ترجمہ تیار ہو رہا ہے…',failed:'ترجمہ مکمل نہیں ہوا۔ درخواست محفوظ ہے۔',explanation:'سپروائزر کی وضاحت',retry:'حالت چیک کریں',error:'درخواست کی تصدیق نہیں ہوئی۔ وہی درخواست دوبارہ بھیجیں۔',back:'ہدایت پر واپس جائیں',write:'ہدایت کی وضاحت کریں',followup:'وضاحت اور دوبارہ کوشش بھیجیں',wrong:'منتخب جواب',request:'غیر واضح حصہ',waiting:'کارکن کے غیر واضح حصہ بتانے کا انتظار ہے۔',title:'وضاحتیں',empty:'وضاحت کی کوئی درخواست نہیں۔',instruction:'ہدایت',question:'سوال',pending:'وضاحت کا انتظار',delivered:'فالو اپ بھیج دیا گیا',saved:'وضاحت محفوظ ہے۔ ترجمے کے بعد فالو اپ پہنچے گا۔'
}:{
  area:'Which part of the instruction needs explaining?',required:'That answer is incorrect. Tell your supervisor which part you did not understand before continuing.',send:'Send clarification request',sent:'Your request was sent to your supervisor. Wait for their explanation before trying again.',preparing:'Preparing the translation…',failed:'Translation could not be completed. Your request is saved.',explanation:'Supervisor explanation',retry:'Check status',error:'The request could not be confirmed. Retry to send the same request.',back:'Return to instruction',write:'Explain the instruction',followup:'Send explanation and follow-up',wrong:'Selected answer',request:'Part needing clarification',waiting:'Waiting for the worker to identify the unclear part.',title:'Clarifications',empty:'No clarification requests.',instruction:'Instruction',question:'Question',pending:'Awaiting explanation',delivered:'Follow-up sent',saved:'Explanation saved. The follow-up will arrive once translation is complete.'
};
