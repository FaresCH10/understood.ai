import {randomBytes,randomInt} from 'node:crypto';
import {questionChoices} from './ai/question-choices.mjs';

const copy={
  en:{question:title=>`Which action follows the instruction “${title}”?`,wrong:['Carry on with another task without following this instruction.','Do the opposite of this instruction.','Replace this instruction with your own steps.']},
  ar:{question:title=>`أي إجراء يتبع التعليمات «${title}»؟`,wrong:['تابع مهمة أخرى دون اتباع هذه التعليمات.','افعل عكس هذه التعليمات.','استبدل هذه التعليمات بخطوات من اختيارك.']},
  ur:{question:title=>`کون سا عمل «${title}» کی ہدایت کے مطابق ہے؟`,wrong:['اس ہدایت پر عمل کیے بغیر کوئی دوسرا کام جاری رکھیں۔','اس ہدایت کے برعکس عمل کریں۔','اس ہدایت کی جگہ اپنے مراحل اختیار کریں۔']},
  hi:{question:title=>`“${title}” निर्देश के अनुसार कौन-सा कार्य सही है?`,wrong:['यह निर्देश माने बिना दूसरा काम जारी रखें।','इस निर्देश के विपरीत कार्य करें।','इस निर्देश की जगह अपने चरण अपनाएँ।']},
  bn:{question:title=>`“${title}” নির্দেশ অনুযায়ী কোন কাজটি সঠিক?`,wrong:['এই নির্দেশ না মেনে অন্য কাজ চালিয়ে যান।','এই নির্দেশের বিপরীত কাজ করুন।','এই নির্দেশের বদলে নিজের ধাপ অনুসরণ করুন।']},
  ml:{question:title=>`“${title}” എന്ന നിർദ്ദേശം പാലിക്കുന്ന പ്രവൃത്തി ഏതാണ്?`,wrong:['ഈ നിർദ്ദേശം പാലിക്കാതെ മറ്റൊരു ജോലി തുടരുക.','ഈ നിർദ്ദേശത്തിന്റെ വിപരീതം ചെയ്യുക.','ഈ നിർദ്ദേശത്തിന് പകരം സ്വന്തം നടപടികൾ സ്വീകരിക്കുക.']},
  ta:{question:title=>`“${title}” அறிவுறுத்தலைப் பின்பற்றும் செயல் எது?`,wrong:['இந்த அறிவுறுத்தலைப் பின்பற்றாமல் வேறு வேலையைத் தொடரவும்.','இந்த அறிவுறுத்தலுக்கு எதிராகச் செயல்படவும்.','இந்த அறிவுறுத்தலுக்குப் பதிலாக உங்கள் சொந்த படிகளைப் பின்பற்றவும்.']},
  te:{question:title=>`“${title}” సూచనకు అనుగుణమైన చర్య ఏది?`,wrong:['ఈ సూచనను పాటించకుండా వేరే పని కొనసాగించండి.','ఈ సూచనకు విరుద్ధంగా పని చేయండి.','ఈ సూచన బదులుగా మీ సొంత దశలను అనుసరించండి.']},
  ne:{question:title=>`“${title}” निर्देशन अनुसार कुन काम सही हो?`,wrong:['यो निर्देशन पालना नगरी अर्को काम जारी राख्नुहोस्।','यस निर्देशनको विपरीत काम गर्नुहोस्।','यस निर्देशनको सट्टा आफ्नै चरणहरू अपनाउनुहोस्।']},
  fil:{question:title=>`Aling gawain ang sumusunod sa tagubiling “${title}”?`,wrong:['Ipagpatuloy ang ibang gawain nang hindi sinusunod ang tagubiling ito.','Gawin ang kabaligtaran ng tagubiling ito.','Palitan ang tagubiling ito ng sarili mong mga hakbang.']},
  si:{question:title=>`“${title}” උපදෙසට අනුව නිවැරදි ක්‍රියාව කුමක්ද?`,wrong:['මෙම උපදෙස නොපිළිපදිමින් වෙනත් වැඩක් දිගටම කරන්න.','මෙම උපදෙසට ප්‍රතිවිරුද්ධ දේ කරන්න.','මෙම උපදෙස වෙනුවට ඔබේම පියවර භාවිත කරන්න.']},
  ru:{question:title=>`Какое действие соответствует инструкции «${title}»?`,wrong:['Продолжить другую работу, не выполняя эту инструкцию.','Сделать противоположное этой инструкции.','Заменить эту инструкцию собственными шагами.']},
  'pa-Guru':{question:title=>`“${title}” ਹਦਾਇਤ ਦੇ ਅਨੁਸਾਰ ਕਿਹੜਾ ਕੰਮ ਸਹੀ ਹੈ?`,wrong:['ਇਸ ਹਦਾਇਤ ਦੀ ਪਾਲਣਾ ਕੀਤੇ ਬਿਨਾਂ ਦੂਜਾ ਕੰਮ ਜਾਰੀ ਰੱਖੋ।','ਇਸ ਹਦਾਇਤ ਦੇ ਉਲਟ ਕੰਮ ਕਰੋ।','ਇਸ ਹਦਾਇਤ ਦੀ ਥਾਂ ਆਪਣੇ ਕਦਮ ਅਪਣਾਓ।']},
  'pa-Arab':{question:title=>`“${title}” دی ہدایت دے مطابق کیہڑا کم درست اے؟`,wrong:['اس ہدایت تے عمل کیتے بغیر دوجا کم جاری رکھو۔','اس ہدایت دے الٹ کم کرو۔','اس ہدایت دی تھاں اپنے مرحلے اپناؤ۔']},
  id:{question:title=>`Tindakan mana yang mengikuti instruksi “${title}”?`,wrong:['Lanjutkan pekerjaan lain tanpa mengikuti instruksi ini.','Lakukan kebalikan dari instruksi ini.','Ganti instruksi ini dengan langkah Anda sendiri.']},
};
export const choiceTextKey=value=>value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu,' ').trim();

// Local synthetic preview only. Live adapters provide independently checked choices.
// Change an actual factual value rather than offering generic disobedience as an answer.
const colors={en:['blue','yellow','red','green'],ar:['الأزرق','الأصفر','الأحمر','الأخضر'],ur:['نیلے','پیلے','سرخ','سبز'],
  hi:['नीले','पीले','लाल','हरे'],bn:['নীল','হলুদ','লাল','সবুজ'],ml:['നീല','മഞ്ഞ','ചുവപ്പ്','പച്ച'],ta:['நீல','மஞ்சள்','சிவப்பு','பச்சை'],
  te:['నీలం','పసుపు','ఎరుపు','ఆకుపచ్చ'],ne:['नीलो','पहेंलो','रातो','हरियो'],fil:['asul','dilaw','pula','berde'],si:['නිල්','කහ','රතු','කොළ'],
  ru:['синюю','жёлтую','красную','зелёную'],'pa-Guru':['ਨੀਲੇ','ਪੀਲੇ','ਲਾਲ','ਹਰੇ'],'pa-Arab':['نیلے','پیلے','سرخ','سبز'],id:['biru','kuning','merah','hijau']};
const negate={en:'Do not carry out this action:',ar:'لا تنفذ هذا الإجراء:',ur:'یہ عمل نہ کریں:',hi:'यह कार्य न करें:',bn:'এই কাজটি করবেন না:',ml:'ഈ പ്രവൃത്തി ചെയ്യരുത്:',ta:'இந்தச் செயலைச் செய்ய வேண்டாம்:',te:'ఈ చర్య చేయవద్దు:',ne:'यो काम नगर्नुहोस्:',fil:'Huwag gawin ang gawaing ito:',si:'මෙම ක්‍රියාව නොකරන්න:',ru:'Не выполняйте это действие:','pa-Guru':'ਇਹ ਕੰਮ ਨਾ ਕਰੋ:','pa-Arab':'ایہ کم نہ کرو:',id:'Jangan lakukan tindakan ini:'};
function previewDistractors(text,language){
  const words=colors[language]||[];
  for(const found of words){
    const match=new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${found}(?![\\p{L}\\p{N}\\p{M}])`,'iu').exec(text);
    if(match)return words.filter(word=>word!==found).map(word=>text.slice(0,match.index)+word+text.slice(match.index+match[0].length));
  }
  const number=/\d+(?:\.\d+)?/.exec(text);
  if(number){const value=Number(number[0]);return [1,2,3].map(offset=>text.slice(0,number.index)+(value+offset)+text.slice(number.index+number[0].length));}
  return copy[language].wrong;
}

// Frozen with the publication. Only public options are delivered to a worker;
// the answer key stays in the private rubric and is never accepted from a client.
export function withMultipleChoice(prepared,{preserveQuestions=true,preserveAskedFacts=true}={}){
  if(prepared?.responseMode==='acknowledge' || !prepared?.question || prepared.rubric?.mode==='multiple-choice')return prepared;
  const ids=Array.from({length:4},()=>randomBytes(16).toString('hex'));
  const order=[0,1,2,3];
  for(let i=order.length-1;i>0;i--){const j=randomInt(i+1);[order[i],order[j]]=[order[j],order[i]];}
  const languages={};
  for(const [language,item] of Object.entries(prepared.languages || {})){
    const t=copy[language];
    // Never silently substitute English options for another content language.
    if(!t)continue;
    const {answerChoices,...publicContent}=item;
    const generated=answerChoices?questionChoices(answerChoices):null;
    const values=generated||[item.text],seen=new Set(values.map(choiceTextKey));
    for(const text of generated?[]:previewDistractors(item.text,language)){
      const key=choiceTextKey(text);
      if(!seen.has(key)){seen.add(key);values.push(text);}
      if(values.length===4)break;
    }
    if(values.length<4){const last=previewDistractors(item.text,language).at(-1);values.push(`${last} ${last}`);}
    if(values.length!==4||new Set(values.map(choiceTextKey)).size!==4)throw Error('Instruction needs four distinct answer choices');
    languages[language]={...publicContent,question:preserveQuestions?item.question:t.question(item.title),questionType:'multiple-choice',choices:order.map(index=>({id:ids[index],text:values[index]}))};
  }
  return {...prepared,question:languages.en?.question || prepared.question,languages,
    rubric:{mode:'multiple-choice',askedFacts:preserveAskedFacts?prepared.rubric.askedFacts:['Follow the actions stated in the instruction.'],correctChoiceId:ids[0]}};
}

export function assessMultipleChoice(answer,snapshot,language){
  const choices=snapshot?.languages?.[language]?.choices || snapshot?.languages?.en?.choices;
  if(snapshot?.rubric?.mode!=='multiple-choice' || !Array.isArray(choices) || choices.length!==4
    || !choices.some(choice=>choice.id===answer.trim()))throw Error('Select one of the published choices');
  const correct=answer.trim()===snapshot.rubric.correctChoiceId;
  return {outcome:correct?'matched':'clarification',reasons:[correct?'correct_choice':'incorrect_choice'],
    evidence:correct?snapshot.rubric.askedFacts.map((_,factIndex)=>({factIndex,quote:answer.trim()})):[]};
}

