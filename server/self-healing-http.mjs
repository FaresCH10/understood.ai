import {readJson,send} from './http.mjs';

export async function handleImprovementRoute(req,res,session,url,actions) {
  const match=url.pathname.match(/^\/api\/publications\/([^/]+)\/improvement(?:\/(draft))?$/);
  if(!match || !['GET','POST'].includes(req.method))return false;
  if(url.search || match[2] && req.method!=='POST')throw Error('Invalid improvement request');
  let result;
  if(req.method==='GET')result=await actions.read(session,match[1]);
  else {
    const input=await readJson(req);
    if(match[2])result=await actions.draft(session,match[1],input);
    else {
      if(Object.keys(input).length)throw Error('Invalid improvement request');
      result=await actions.analyze(session,match[1]);
    }
  }
  send(res,200,result);return true;
}
