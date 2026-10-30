import {readJson,send} from './http.mjs';
export async function handleWorkspaceRoute(req,res,session,url,run){
 const path=url.pathname;
 if(!path.startsWith('/api/workspace/'))return false;
 let operation,input;
 if(path==='/api/workspace/instructions'&&req.method==='GET'){operation='library';input=Object.fromEntries(url.searchParams);}
 const composition=path.match(/^\/api\/workspace\/drafts\/([^/]+)$/);
 if(composition&&['GET','POST'].includes(req.method)){operation='composition';input={id:composition[1],...(req.method==='POST'?{content:await readJson(req)}:{})};}
 const work=path.match(/^\/api\/workspace\/work(?:\/([^/]+))?$/);
 if(work&&req.method==='GET'){operation='work';input={workerId:url.searchParams.get('workerId')};}
 if(work?.[1]&&req.method==='POST'){await readJson(req);operation='work';input={complete:work[1]};}
 const files=path.match(/^\/api\/workspace\/attachments\/([^/]+)(?:\/([^/]+))?$/);
 if(files&&['GET','POST'].includes(req.method)){operation='attachments';input={requestId:files[1],...(files[2]?{download:files[2]}:{}),...(req.method==='POST'?{file:await readJson(req,7*1024*1024)}:{})};}
 const assignment=path.match(/^\/api\/workspace\/assignment-files\/([^/]+)$/);
 if(assignment&&req.method==='GET'){operation='assignment-files';input={id:assignment[1]};}
 const briefing=path.match(/^\/api\/workspace\/briefing-files\/([^/]+)$/);
 if(briefing&&req.method==='GET'){operation='briefing-files';input={id:briefing[1]};}
 if(!operation){send(res,404,{error:'Not found'});return true;}
 const result=await run(session,operation,input);
 if(operation==='attachments'&&input.download){
  res.writeHead(200,{'content-type':result.mime,'content-disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(result.name)}`,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"});res.end(Buffer.from(result.data_base64,'base64'));
 }else send(res,200,result);
 return true;
}
