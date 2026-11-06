import nodemailer from 'nodemailer';
import {pilotDestination} from './pilot-input.mjs';

const smtpErrors=new Set(['EAUTH','ECONNECTION','EDNS','EENVELOPE','EMESSAGE','ESOCKET','ETIMEDOUT','ETLS']);

export function resolvePilotGmail(env,createTransport=nodemailer.createTransport) {
  const user=env.UNDERSTOOD_PILOT_GMAIL_USER?.trim().toLowerCase();
  const pass=env.UNDERSTOOD_PILOT_GMAIL_APP_PASSWORD?.replace(/\s/g,'');
  if(!user && !pass)return null;

  let destination;
  try {destination=pilotDestination(env.UNDERSTOOD_PILOT_TO ?? null);} catch {destination=null;}
  if(!destination || !/^[a-z0-9.]+@gmail\.com$/.test(user ?? '') || !/^[a-z0-9]{16}$/i.test(pass ?? '')) {
    console.warn('Pilot Gmail configuration is incomplete or invalid');
    return null;
  }

  const transport=createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user,pass},
    dnsTimeout:2500,connectionTimeout:4000,greetingTimeout:3000,socketTimeout:4500,
    disableFileAccess:true,disableUrlAccess:true});
  return {destination,async send(id,message) {
    try {
      const result=await transport.sendMail({from:{name:'Understood',address:user},to:{address:destination},
        subject:message.subject,text:message.text,messageId:`<pilot-${id}@understood-ai.vercel.app>`});
      if(result.accepted?.length!==1)throw Error('Gmail did not accept the pilot notification');
      return {providerId:result.messageId};
    } catch(error) {
      console.warn('Pilot Gmail delivery failed:',smtpErrors.has(error?.code)?error.code:'unconfirmed');
      throw Error('Pilot Gmail delivery could not be confirmed');
    }
  }};
}
