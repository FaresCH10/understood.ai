// Local generation only: plaintext passwords are never sent to an external service.
export function generateWorkerPassword(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#';
  const limit=Math.floor(256/alphabet.length)*alphabet.length;
  let password='';
  while(password.length<18){
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    for(const byte of bytes){if(byte<limit)password+=alphabet[byte%alphabet.length];if(password.length===18)break;}
  }
  return password;
}
