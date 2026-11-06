import {readJson,send} from './http.mjs';
import {pilotHttpError} from './pilot-input.mjs';

export async function handlePilotRoute(req,res,url,repository) {
  const receipt=url.pathname.match(/^\/api\/public\/pilot\/([a-f0-9-]{36})$/i);
  if(url.pathname!=='/api/public/pilot' && !receipt)return false;
  try {
    if(url.search || req.headers['content-encoding'])throw Error('Invalid pilot request');
    if(!receipt && req.method==='POST') {
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))throw Error('Invalid pilot request');
      send(res,202,await repository.save(await readJson(req,8192)));
    }else if(receipt && req.method==='GET')send(res,200,await repository.read(receipt[1],req.headers['x-pilot-receipt']));
    else send(res,405,{error:'Method not allowed'},{allow:receipt?'GET':'POST'});
  }catch(error){const result=pilotHttpError(error);send(res,result.status,{error:result.error});}
  return true;
}
