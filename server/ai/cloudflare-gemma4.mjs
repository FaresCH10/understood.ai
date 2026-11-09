export const CLOUDFLARE_GEMMA4_MODEL='@cf/google/gemma-4-26b-a4b-it';

export function cloudflareGemma4(env,fetcher=fetch) {
  if(env.VERCEL_ENV!=='production' || env.UNDERSTOOD_TIER==='production')return null;
  const account=env.CLOUDFLARE_ACCOUNT_ID?.trim(),token=env.CLOUDFLARE_API_TOKEN?.trim();
  if(!/^[a-f0-9]{32}$/i.test(account ?? '') || !token)return null;
  return async (messages,{signal,maxTokens})=>{
    const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${CLOUDFLARE_GEMMA4_MODEL}`,{
      method:'POST',redirect:'error',signal,
      headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
      body:JSON.stringify({
        temperature:0,max_completion_tokens:maxTokens,store:false,
        chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_object'},messages,
      }),
    });
    if(response.status===429)throw Object.assign(Error('Cloudflare is rate limiting this request'),{status:429});
    if(!response.ok)throw Error('Provider rejected request');
    const envelope=await response.json();
    if(envelope?.success===false)throw Error('Provider rejected request');
    const choice=envelope?.result?.choices?.[0] ?? envelope?.choices?.[0];
    if(choice?.finish_reason==='length')throw Error('Truncated result');
    const content=choice?.message?.content ?? envelope?.result?.response ?? envelope?.response;
    return typeof content==='string'?JSON.parse(content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1')):content;
  };
}
