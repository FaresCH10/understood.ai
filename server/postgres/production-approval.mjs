import {readFileSync,statSync} from 'node:fs';

// Vercel can store the same reviewed manifest in an environment variable.
// It is input to the existing admission checks, never an approval substitute.
export function readProductionApproval(env=process.env){
  const json=env.UNDERSTOOD_RELEASE_APPROVAL_JSON,path=env.UNDERSTOOD_RELEASE_APPROVAL_FILE;
  if(json&&path)throw Error('Select one production approval source');
  let text;
  if(json!==undefined){if(typeof json!=='string'||Buffer.byteLength(json)>65536)throw Error('Production approval unavailable');text=json;}
  else if(path){if(statSync(path).size>65536)throw Error('Production approval unavailable');text=readFileSync(path,'utf8');}
  else throw Error('Production approval unavailable');
  try{return JSON.parse(text);}catch{throw Error('Production approval unavailable');}
}
