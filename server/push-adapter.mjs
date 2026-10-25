const disabled=Object.freeze({mode:'disabled',publicKey:null,send:async()=>{throw Error('Push notifications are not configured');}});
const synthetic=Object.freeze({mode:'synthetic',publicKey:null,synthetic:true,send:async()=>({accepted:true,synthetic:true})});

function vapidSubject(value) {
  return typeof value==='string' && (/^mailto:[^@\s]+@[^@\s]+$/.test(value) || /^https:\/\/[^\s]+$/.test(value)) ? value : null;
}

export function resolvePushAdapter(env=process.env) {
  const mode=env.UNDERSTOOD_PUSH_ADAPTER ?? 'disabled';
  if(mode==='disabled') return disabled;
  if(mode==='synthetic') {
    if(env.UNDERSTOOD_DATA_CLASS!=='synthetic') throw Error('Synthetic push requires an explicitly synthetic data class');
    return synthetic;
  }
  if(mode!=='webpush') throw Error('Invalid push adapter');
  const publicKey=env.UNDERSTOOD_PUSH_VAPID_PUBLIC_KEY?.trim(),privateKey=env.UNDERSTOOD_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject=vapidSubject(env.UNDERSTOOD_PUSH_VAPID_SUBJECT?.trim());
  if(!publicKey || !privateKey || !subject || publicKey.length>200 || privateKey.length>200) throw Error('Push VAPID configuration is incomplete');
  let modulePromise=null,configured=false;
  const load=async()=>{
    const module=await import('web-push');
    const webpush=module.default ?? module;
    if(!configured){webpush.setVapidDetails(subject,publicKey,privateKey);configured=true;}
    return webpush;
  };
  return {
    mode:'webpush',publicKey,
    async send(subscription,payload) {
      const webpush=await (modulePromise ??= load());
      const result=await webpush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},
        JSON.stringify(payload),{TTL:600,urgency:'normal'});
      return {accepted:true,statusCode:result?.statusCode ?? 201};
    },
  };
}

export const disabledPushAdapter=disabled;
export const syntheticPushAdapter=synthetic;
