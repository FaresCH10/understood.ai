export async function neonFunctionStatus(env=process.env,fetchImpl=fetch){
  const value=env.NEON_FUNCTION_HELLO_BASE_URL;
  if(!value)return {configured:false};
  const url=new URL(value);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.neon.tech')||url.username||url.password)throw Error('Invalid Neon Function URL');
  const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  if(!response.ok||result.app!=='understood'||result.postgres!=='connected')throw Error('Neon Function unavailable');
  return {configured:true,functions:'connected',postgres:'connected'};
}
