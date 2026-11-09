import {languageTextMatches,workerLocale} from '../languages.mjs';
import {cloudflareGemma4} from './cloudflare-gemma4.mjs';

const source='Place 2 sealed cartons on the blue shelf before 4 pm. Do not move unsealed cartons. Keep the walkway clear.';

export function cloudflareGemma4Test(env,fetcher=fetch) {
  if(env.UNDERSTOOD_CLOUDFLARE_GEMMA4_TEST!=='true')return null;
  const run=cloudflareGemma4(env,fetcher);
  if(!run)return null;

  return {
    source,
    async run(input) {
      const locale=workerLocale(input.language);
      if(!locale || Object.keys(input).length!==1)return {status:400,data:{error:'Choose a supported worker language.'}};

      const signal=AbortSignal.timeout(18000);
      try {
        const value=await run([{role:'user',content:[
              `Translate this synthetic instruction into ${locale.englishName} (${locale.code}), using the ${locale.script} script.`,
              'Preserve the digits 2 and 4, the deadline, the prohibition and the walkway requirement.',
              'Write a multiple-choice question asking where sealed cartons should go. Give four distinct choices, with only the first one correct.',
              'Return a JSON object with instruction and question strings and a choices array. Write all values in the requested language.',
              `Source: ${source}`,
        ].join('\n')}],{signal,maxTokens:768});
        const clean=text=>typeof text==='string' ? text.trim() : '';
        const instruction=clean(value?.instruction),question=clean(value?.question);
        const choices=Array.isArray(value?.choices) ? value.choices.map(clean) : [];
        if(choices.length!==4 || new Set(choices).size!==4 || !/\b2\b/.test(instruction) || !/\b4\b/.test(instruction)
          || ![instruction,question,...choices].every(text=>text && languageTextMatches(locale.code,text)))
          return {status:502,data:{error:'Gemma returned an incomplete result or used the wrong script. Try again.'}};
        return {status:200,data:{instruction,question,choices}};
      } catch(error) {
        if(error.status===429)return {status:429,data:{error:'Cloudflare is rate limiting this test. Try again later.'}};
        if(signal.aborted)return {status:504,data:{error:'Gemma took too long to respond. Try again.'}};
        return {status:502,data:{error:'Gemma could not complete the test. Try again.'}};
      }
    },
  };
}
