import {createVercelOperatorHandler} from '../server/vercel-operator.mjs';
import {send} from '../server/http.mjs';

let runtime;
export default async function gateway(req,res){
  const url=new URL(req.url || '/api','http://internal.invalid');
  const captured=url.searchParams.get('understood_path') || '';
  url.searchParams.delete('understood_path');
  const queryStart=captured.indexOf('?');
  const path=(queryStart===-1?captured:captured.slice(0,queryStart)).replace(/^\/+/, '');
  if(!/^ops\/[a-z0-9/-]+$/i.test(path))return send(res,404,{error:'Not found'});
  if(url.searchParams.get('path')===path)url.searchParams.delete('path');
  const params=new URLSearchParams(queryStart===-1?'':captured.slice(queryStart+1));
  for(const [key,value] of url.searchParams)if(!params.has(key))params.append(key,value);
  const query=params.toString();
  req.url=`/api/${path}${query?`?${query}`:''}`;
  try {
    runtime??=createVercelOperatorHandler().catch(error=>{runtime=undefined;throw error;});
    return await (await runtime)(req,res);
  }catch {
    return send(res,503,{error:'Operator service configuration unavailable'});
  }
}
