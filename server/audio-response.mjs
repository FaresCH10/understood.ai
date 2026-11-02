export function singleAudioRange(header,size){
  if(header===undefined)return null;
  if(typeof header!=='string'||header.length>128)return false;
  if(!header.startsWith('bytes=')||header.includes(','))return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!match||!match[1]&&!match[2]||!Number.isSafeInteger(size)||size<=0)return false;
  if(!match[1]){
    const count=Number(match[2]);
    return Number.isSafeInteger(count)&&count>0?{start:Math.max(0,size-count),end:size-1}:false;
  }
  const start=Number(match[1]),end=match[2]?Number(match[2]):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return false;
  return {start,end:Math.min(end,size-1)};
}

// Call only after the route has authorized and verified the complete private file.
export function sendPrivateWav(req,res,bytes){
  const headers={'content-type':'audio/wav','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','accept-ranges':'bytes'};
  const range=req.headers['if-range']===undefined?singleAudioRange(req.headers.range,bytes.length):null;
  if(range===false){res.writeHead(416,{...headers,'content-range':`bytes */${bytes.length}`,'content-length':0});res.end();return;}
  if(range){
    const body=bytes.subarray(range.start,range.end+1);
    res.writeHead(206,{...headers,'content-range':`bytes ${range.start}-${range.end}/${bytes.length}`,'content-length':body.length});res.end(body);return;
  }
  res.writeHead(200,{...headers,'content-length':bytes.length});res.end(bytes);
}

// Call only after the route has authorized and verified the private stored image.
export function sendPrivateImage(res,mime,dataBase64){
  const bytes=Buffer.from(dataBase64,'base64');
  res.writeHead(200,{'content-type':mime,'cache-control':'no-store','x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer','content-disposition':'inline','content-length':bytes.length});
  res.end(bytes);
}
