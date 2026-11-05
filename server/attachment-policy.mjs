import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

// Three MiB becomes four MiB after base64 encoding, leaving room for JSON
// metadata below the Vercel Function request/response limit.
export const MAX_ATTACHMENT_BYTES=3*1024*1024;
export const MAX_ATTACHMENT_JSON_BYTES=4*1024*1024+65536;
export const MAX_ATTACHMENT_TOTAL_BYTES=10*1024*1024;
export const attachmentDigest=bytes=>createHash('sha256').update(bytes).digest('hex');

class ScanNeeded extends Error{
  constructor(key,bytes,file){super('Scan required');this.key=key;this.bytes=Buffer.from(bytes);this.file={...file};}
}
// run must roll back on exceptions. Authorize and validate first, scan outside
// the transaction, then repeat every authority/state check with a bound verdict.
export async function withAttachmentScanOutsideTransaction(options,run){
  const scanner=options.attachmentScanner;
  if(options.integrationMode!=='live'||typeof scanner?.scan!=='function')return run(options);
  const verdicts=new Map();
  const checked={...options,attachmentScanner:{scan(bytes,file){
    const key=JSON.stringify([attachmentDigest(bytes),file.mime,file.name]);
    if(!verdicts.has(key))throw new ScanNeeded(key,bytes,file);
    return verdicts.get(key);
  }}};
  for(;;){
    try{return await run(checked);}
    catch(error){if(!(error instanceof ScanNeeded))throw error;verdicts.set(error.key,await scanner.scan(error.bytes,error.file));}
  }
}

export function attachmentPolicy({integrationMode='synthetic',attachmentScanner}={}) {
  const scanRequired=integrationMode==='live';
  return {maxBytes:MAX_ATTACHMENT_BYTES,maxFiles:5,totalBytes:MAX_ATTACHMENT_TOTAL_BYTES,
    scanRequired,uploadAllowed:!scanRequired||typeof attachmentScanner?.scan==='function'};
}

// This is a narrow server-to-server contract for a deployed malware scanner.
// It does not pretend that file signatures, an LLM, or a local stub are a scan.
export function resolveAttachmentScanner(env={}, {fetchImpl=fetch}={}) {
  const value=env.UNDERSTOOD_ATTACHMENT_SCANNER_URL,key=env.UNDERSTOOD_ATTACHMENT_SCANNER_KEY;
  if(!value&&!key)return null;
  let url;try{url=new URL(value);}catch{throw Error('Invalid attachment scanner configuration');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||isIP(url.hostname)
    ||!url.hostname.includes('.')||/(?:^localhost$|\.(?:localhost|local|internal|test|invalid|example)$)/i.test(url.hostname)
    ||typeof key!=='string'||key.length<16||key.length>256||/[\r\n]/.test(key))throw Error('Invalid attachment scanner configuration');
  return Object.freeze({async scan(bytes,{mime,name}={}){
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_ATTACHMENT_BYTES)throw Error('Attachment safety check unavailable');
    const sha256=attachmentDigest(bytes);
    try{
      const response=await fetchImpl(url.href,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
        headers:{authorization:`Bearer ${key}`,'content-type':'application/octet-stream','x-file-sha256':sha256,
          'x-file-content-type':mime||'application/octet-stream','x-file-name':encodeURIComponent(name||'attachment')},body:bytes});
      if(!response.ok||!response.body)throw Error();
      const reader=response.body.getReader();let size=0,text='';
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096)throw Error();text+=new TextDecoder().decode(part.value);}}
      finally{await reader.cancel().catch(()=>{});}
      const result=JSON.parse(text);
      if(!result||Object.keys(result).some(key=>!['sha256','verdict'].includes(key))||result.sha256!==sha256||!['clean','infected'].includes(result.verdict))throw Error();
      return result.verdict;
    }catch{throw Error('Attachment safety check unavailable');}
  }});
}

export async function requireSafeAttachment(bytes,file,options={}) {
  if(options.integrationMode!=='live')return;
  if(typeof options.attachmentScanner?.scan!=='function')throw Error('Attachments are unavailable until file safety scanning is configured');
  const result=await options.attachmentScanner.scan(bytes,file);
  if(result==='infected')throw Error('This file failed the safety check. Choose another file');
  if(result!=='clean')throw Error('Attachment safety check unavailable');
}
