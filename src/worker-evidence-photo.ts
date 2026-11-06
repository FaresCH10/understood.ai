import {EVIDENCE_MAX_BYTES} from '../server/evidence-policy.mjs';
// Resize locally before encoding: 3 MiB is at most 4 MiB in base64, below the hosted request cap.
export async function prepareEvidencePhoto(file:File){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw Error('Invalid photo');
 const bitmap=await createImageBitmap(file);
 try {
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');if(!context)throw Error('Photo processing unavailable');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const preview=canvas.toDataURL('image/jpeg',0.82),data=preview.slice(preview.indexOf(',')+1);
  if(data.length>Math.ceil(EVIDENCE_MAX_BYTES/3)*4)throw Error('Photo too large');
  return {mimeType:'image/jpeg',data,preview};
 }finally{bitmap.close();}
}
