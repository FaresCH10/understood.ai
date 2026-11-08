import {createContext,useContext,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {LogOut} from 'lucide-react';
import './sign-out-confirmation.css';

const copy={
  en:{title:'Sign out of Understood?',body:'Are you sure you want to sign out of your account?',cancel:'Cancel',confirm:'Sign out'},
  ar:{title:'تسجيل الخروج من Understood؟',body:'هل أنت متأكد أنك تريد تسجيل الخروج من حسابك؟',cancel:'إلغاء',confirm:'تسجيل الخروج'},
  ur:{title:'Understood سے سائن آؤٹ کریں؟',body:'کیا آپ واقعی اپنے اکاؤنٹ سے سائن آؤٹ کرنا چاہتے ہیں؟',cancel:'منسوخ کریں',confirm:'سائن آؤٹ'},
};
const workerCopy={
  en:{title:'End this work session?',body:'You will be signed out on this device. You can sign in again with your worker ID and password.',cancel:'Cancel',confirm:'End session'},
  ar:{title:'إنهاء جلسة العمل؟',body:'سيتم تسجيل خروجك على هذا الجهاز. يمكنك تسجيل الدخول مجدداً برقم العامل وكلمة المرور.',cancel:'إلغاء',confirm:'إنهاء الجلسة'},
  ur:{title:'کام سیشن ختم کریں؟',body:'اس آلے پر آپ سائن آؤٹ ہو جائیں گے۔ آپ اپنے ورکر آئی ڈی اور پاس ورڈ سے دوبارہ سائن ان کر سکتے ہیں۔',cancel:'منسوخ کریں',confirm:'سیشن ختم کریں'},
};
const ConfirmationContext=createContext<(language?:string,worker?:boolean)=>Promise<boolean>>(async()=>false);
export const useSignOutConfirmation=()=>useContext(ConfirmationContext);

export function SignOutConfirmationProvider({children}:{children:ReactNode}){
  const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),trigger=useRef<HTMLElement|null>(null);
  const pending=useRef<{promise:Promise<boolean>;resolve:(confirmed:boolean)=>void}|null>(null);
  const [language,setLanguage]=useState('en'),[worker,setWorker]=useState(false),[open,setOpen]=useState(false);
  const text=(worker?workerCopy:copy)[language as keyof typeof copy]||(worker?workerCopy:copy).en;
  const settle=(confirmed:boolean)=>{
    const current=pending.current;pending.current=null;
    dialog.current?.close();setOpen(false);current?.resolve(confirmed);
    if(trigger.current?.isConnected){
      if(trigger.current.getClientRects().length)trigger.current.focus();
      else trigger.current.closest('details')?.querySelector('summary')?.focus();
    }
  };
  const confirm=(locale='en',workerAudience=false)=>{
    if(pending.current)return pending.current.promise;
    trigger.current=document.activeElement as HTMLElement;
    let resolve!:(value:boolean)=>void;
    const promise=new Promise<boolean>(done=>{resolve=done;});pending.current={promise,resolve};
    setLanguage(locale);setWorker(workerAudience);setOpen(true);return promise;
  };
  useLayoutEffect(()=>{if(open){dialog.current?.showModal();cancel.current?.focus();}},[open]);
  useEffect(()=>()=>{pending.current?.resolve(false);pending.current=null;},[]);
  return <ConfirmationContext.Provider value={confirm}>{children}{createPortal(
    <dialog ref={dialog} className="sign-out-confirmation" role="alertdialog" aria-labelledby="sign-out-title" aria-describedby="sign-out-description" lang={language} dir={['ar','ur'].includes(language)?'rtl':'ltr'} onCancel={event=>{event.preventDefault();settle(false);}} onClose={()=>{if(pending.current)settle(false);}}>
      <div className="sign-out-confirmation-symbol"><LogOut size={23} aria-hidden="true"/></div><h2 id="sign-out-title">{text.title}</h2><p id="sign-out-description">{text.body}</p>
      <div className="sign-out-confirmation-actions"><button ref={cancel} type="button" className="button outline" onClick={()=>settle(false)}>{text.cancel}</button><button type="button" className="button primary" onClick={()=>settle(true)}>{text.confirm}</button></div>
    </dialog>,document.body)}</ConfirmationContext.Provider>;
}
