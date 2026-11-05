import {readJson,send} from './http.mjs';
import {MAX_ATTACHMENT_JSON_BYTES} from './attachment-policy.mjs';
export async function handleWorkspaceRoute(req,res,session,url,run){
 const path=url.pathname;
 if(!path.startsWith('/api/workspace/'))return false;
 let operation,input;
 if(path==='/api/workspace/attachment-policy'&&req.method==='GET'){operation='attachment-policy';input={};}
 if(path==='/api/workspace/instructions'&&req.method==='GET'){operation='library';input=Object.fromEntries(url.searchParams);}
 const crewHistory=path.match(/^\/api\/workspace\/crews\/([a-zA-Z0-9_-]{1,100})\/instructions$/);
 if(crewHistory&&req.method==='GET'){
  const keys=[...url.searchParams.keys()];if(keys.some(key=>!['page','search','status'].includes(key))||new Set(keys).size!==keys.length){send(res,400,{error:'Invalid crew history request'});return true;}
  operation='crew-instructions';input={crewId:crewHistory[1],page:url.searchParams.get('page')??'1',search:url.searchParams.get('search')??'',status:url.searchParams.get('status')??'all'};
 }
 const composition=path.match(/^\/api\/workspace\/drafts\/([^/]+)$/);
 if(composition&&['GET','POST'].includes(req.method)){operation='composition';input={id:composition[1],...(req.method==='POST'?{content:await readJson(req)}:{})};}
 const work=path.match(/^\/api\/workspace\/work(?:\/([^/]+))?$/);
 if(work&&req.method==='GET'){
  const keys=[...url.searchParams.keys()];
  if(keys.some(key=>!['workerId','page','pageSize','status','search'].includes(key))||new Set(keys).size!==keys.length||work[1]&&keys.some(key=>key!=='workerId')){send(res,400,{error:'Invalid work request'});return true;}
  operation='work';input={...Object.fromEntries(url.searchParams),...(work[1]?{assignmentId:work[1]}:{})};
 }
 if(work?.[1]&&req.method==='POST'){
  const body=await readJson(req);if(url.search||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length){send(res,400,{error:'Invalid work request'});return true;}
  operation='work';input={complete:work[1]};
 }
 const files=path.match(/^\/api\/workspace\/attachments\/([^/]+)(?:\/([^/]+))?$/);
 if(files&&['GET','POST'].includes(req.method)){operation='attachments';input={requestId:files[1],...(files[2]?{download:files[2]}:{}),...(req.method==='POST'?{file:await readJson(req,MAX_ATTACHMENT_JSON_BYTES)}:{})};}
 const assignment=path.match(/^\/api\/workspace\/assignment-files\/([^/]+)$/);
 if(assignment&&req.method==='GET'){operation='assignment-files';input={id:assignment[1]};}
 const briefing=path.match(/^\/api\/workspace\/briefing-files\/([^/]+)$/);
 if(briefing&&req.method==='GET'){operation='briefing-files';input={id:briefing[1]};}
 if(!operation){send(res,404,{error:'Not found'});return true;}
 let result;
 try{result=await run(session,operation,input);}catch(error){
  if(['Attachments are unavailable until file safety scanning is configured','Attachment safety check unavailable','This file failed the safety check. Choose another file','This attachment exceeds the current download limit. Ask your supervisor to attach a smaller file'].includes(error.message)){
   send(res,error.message.startsWith('This file')?422:error.message.startsWith('This attachment')?413:503,{error:error.message});return true;
  }
  const status=operation==='crew-instructions'?{'Forbidden':403,'Sign in required':401,'Crew unavailable':404,'Invalid crew history request':400}[error.message]:operation==='work'?{'Forbidden':403,'Sign in required':401,'Assignment unavailable':404,'Invalid work request':400,'Confirm understanding and resolve follow-up before finishing work':409}[error.message]:undefined;
  if(!status)throw error;send(res,status,{error:error.message});return true;
 }
 if(operation==='attachments'&&input.download){
  res.writeHead(200,{'content-type':result.mime,'content-disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(result.name)}`,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"});res.end(Buffer.from(result.data_base64,'base64'));
 }else send(res,200,result);
 return true;
}
