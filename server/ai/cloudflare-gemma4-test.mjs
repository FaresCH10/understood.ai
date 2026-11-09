import {languageTextMatches,workerLocale} from '../languages.mjs';

const model='@cf/google/gemma-4-26b-a4b-it';
const source='Place 2 sealed cartons on the blue shelf before 4 pm. Do not move unsealed cartons. Keep the walkway clear.';

export function cloudflareGemma4Test(env,fetcher=fetch) {
  if(env.VERCEL_ENV!=='preview' || env.UNDERSTOOD_TIER==='production' || env.UNDERSTOOD_CLOUDFLARE_GEMMA4_TEST!=='true')return null;
  const account=env.CLOUDFLARE_ACCOUNT_ID?.trim(),token=env.CLOUDFLARE_API_TOKEN?.trim();
  if(!/^[a-f0-9]{32}$/i.test(account ?? '') || !token)return null;

  return {
    source,
    async run(input) {
      const locale=workerLocale(input.language);
      if(!locale || Object.keys(input).length!==1)return {status:400,data:{error:'Choose a supported worker language.'}};

      const signal=AbortSignal.timeout(18000);
      try {
        const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,{
          method:'POST',redirect:'error',signal,
          headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
          body:JSON.stringify({
            temperature:0,max_completion_tokens:768,
            chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_object'},
            messages:[{role:'user',content:[
              `Translate this synthetic instruction into ${locale.englishName} (${locale.code}), using the ${locale.script} script.`,
              'Preserve the digits 2 and 4, the deadline, the prohibition and the walkway requirement.',
              'Write a multiple-choice question asking where sealed cartons should go. Give four distinct choices, with only the first one correct.',
              'Return a JSON object with instruction and question strings and a choices array. Write all values in the requested language.',
              `Source: ${source}`,
            ].join('\n')}],
          }),
        });
        if(response.status===429)return {status:429,data:{error:'Cloudflare is rate limiting this test. Try again later.'}};
        if(!response.ok)throw Error('Provider rejected request');
        const envelope=await response.json();
        if(envelope?.success===false)throw Error('Provider rejected request');
        const choice=envelope?.result?.choices?.[0] ?? envelope?.choices?.[0];
        if(choice?.finish_reason==='length')throw Error('Truncated result');
        const content=choice?.message?.content ?? envelope?.result?.response ?? envelope?.response;
        const value=typeof content==='string' ? JSON.parse(content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1')) : content;
        const clean=text=>typeof text==='string' ? text.trim() : '';
        const instruction=clean(value?.instruction),question=clean(value?.question);
        const choices=Array.isArray(value?.choices) ? value.choices.map(clean) : [];
        if(choices.length!==4 || new Set(choices).size!==4 || !/\b2\b/.test(instruction) || !/\b4\b/.test(instruction)
          || ![instruction,question,...choices].every(text=>text && languageTextMatches(locale.code,text)))
          return {status:502,data:{error:'Gemma returned an incomplete result or used the wrong script. Try again.'}};
        return {status:200,data:{instruction,question,choices}};
      } catch {
        if(signal.aborted)return {status:504,data:{error:'Gemma took too long to respond. Try again.'}};
        return {status:502,data:{error:'Gemma could not complete the test. Try again.'}};
      }
    },
  };
}
