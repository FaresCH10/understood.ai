import {useRef,useState} from 'react';
import {WORKER_LOCALES} from '../server/languages.mjs';
import {useStaffText} from './staff-language';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {StaffRequestError} from './staff-request';

type TestResult={instruction:string;question:string;choices:string[]};

export default function Gemma4TestPanel({authority,source}:{authority:StaffRequestAuthority;source:string}){
  const staffT=useStaffText();
  const ar=staffT.locale==='ar';
  const {request,current}=useStaffRequest(authority);
  const [language,setLanguage]=useState('en');
  const [result,setResult]=useState<TestResult|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const running=useRef(false);

  async function run(){
    if(running.current)return;
    running.current=true;
    setBusy(true);
    setResult(null);
    setError('');
    try{
      const output=await request<TestResult>('/api/instructions/gemma4-test',{language});
      if(current())setResult(output);
    }catch(error){
      if(current())setError(ar
        ? 'تعذّر إكمال الاختبار. حاول مرة أخرى.'
        : error instanceof StaffRequestError ? error.message : 'The test could not be completed. Try again.');
    }finally{
      running.current=false;
      setBusy(false);
    }
  }

  return <details className="notice">
    <summary>{ar?'اختبار ترجمة Gemma 4':'Gemma 4 translation test'}</summary>
    <p>{ar?'يعرض الاختبار ترجمة مثال ثابت وسؤالاً تجريبياً. راجع المعنى والإجابة الأولى.':'Preview a translation and question for this built-in example. Review the meaning and the first answer choice.'}</p>
    <p lang="en" dir="ltr">{source}</p>
    <label className="field">{ar?'لغة الاختبار':'Test language'}
      <select value={language} disabled={busy} onChange={event=>{setLanguage(event.target.value);setResult(null);setError('');}}>
        {WORKER_LOCALES.map(locale=><option key={locale.code} value={locale.code}>{staffT.language(locale.code)}</option>)}
      </select>
    </label>
    <button type="button" className="button outline" disabled={busy} onClick={()=>void run()}>
      {busy?(ar?'جارٍ الاختبار…':'Testing…'):(ar?'تشغيل الاختبار':'Run test')}
    </button>
    {busy&&<p role="status">{ar?'جارٍ انتظار نتيجة Gemma 4.':'Waiting for Gemma 4.'}</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div aria-live="polite" lang={language} dir="auto">
      <p>{result.instruction}</p>
      <p><strong>{result.question}</strong></p>
      <ol>{result.choices.map(choice=><li key={choice} dir="auto">{choice}</li>)}</ol>
    </div>}
  </details>;
}
