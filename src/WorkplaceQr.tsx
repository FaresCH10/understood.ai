import {BrandLogo} from './BrandLogo';
import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import qrcode from 'qrcode-generator';
import {Check,Copy,Expand,Printer,X} from 'lucide-react';
import {gsap,useGSAP} from './gsap';
import {workplaceQrUrl} from './workplace-qr';

type WorkplaceQrProps={briefingId:string;title:string;organization:string;site:string;version:number;open:boolean;onClose:()=>void};

export function WorkplaceQr({briefingId,title,organization,site,version,open,onClose}:WorkplaceQrProps) {
  const staffT=useStaffStaticText();
  const dialog=useRef<HTMLDialogElement>(null),sheet=useRef<HTMLDivElement>(null);
  const [label,setLabel]=useState('');
  const [showTitle,setShowTitle]=useState(true);
  const [kiosk,setKiosk]=useState(false);
  const [copyState,setCopyState]=useState<'copied'|'failed'|null>(null);
  const url=useMemo(()=>workplaceQrUrl(window.location.origin,window.location.pathname,briefingId),[briefingId]);
  const svg=useMemo(()=>{
    const code=qrcode(0,'M');code.addData(url);code.make();
    return code.createSvgTag({cellSize:6,margin:2,scalable:true});
  },[url]);
  useEffect(()=>{
    if(!open)return;
    const element=dialog.current;
    if(!element)return;
    if(!element.open)element.showModal();
    document.body.classList.add('workplace-qr-printing');
    return()=>{document.body.classList.remove('workplace-qr-printing');if(element.open)element.close();};
  },[open]);
  useEffect(()=>{if(!open)setKiosk(false);},[open]);
  useGSAP(()=>{
    if(!open||!sheet.current||!window.matchMedia('(prefers-reduced-motion: no-preference)').matches)return;
    gsap.from(sheet.current,{opacity:0,y:14,duration:.34,ease:'power2.out',clearProps:'opacity,transform'});
  },{dependencies:[open],revertOnUpdate:true});
  if(!open)return null;
  const copy=async()=>{
    try {await navigator.clipboard.writeText(url);setCopyState('copied');}
    catch {setCopyState('failed');}
  };
  return createPortal(
    <dialog ref={dialog} className={`withdraw-dialog workplace-qr-dialog${kiosk?' kiosk':''}`} aria-labelledby="workplace-qr-title" aria-describedby="workplace-qr-signin"
      onCancel={event=>{event.preventDefault();if(kiosk)setKiosk(false);else onClose();}}
      onClose={()=>{if(!kiosk)onClose();}}>
      {kiosk && <button type="button" className="button outline workplace-qr-exit" onClick={()=>setKiosk(false)}><X size={18}/>{staffT("Exit display")}</button>}
      <div className="workplace-qr-sheet" ref={sheet} dir="ltr" lang="en">
        <header className="workplace-qr-brand"><span className="workplace-qr-wordmark"><BrandLogo/></span><span>{site}</span></header>
        <p className="workplace-qr-kicker">{staffT("Workplace instruction access")}</p>
        <h1 id="workplace-qr-title">{showTitle?title:staffT("Open this work instruction")}</h1>
        {label.trim()?<p className="workplace-qr-location">{label.trim()}</p>:null}
        <div className="workplace-qr-code" role="img" aria-label={staffT("QR code that opens this instruction after worker sign-in")} dangerouslySetInnerHTML={{__html:svg}}/>
        <p className="workplace-qr-scan">{staffT("Scan with your phone camera")}</p>
        <p className="workplace-qr-signin" id="workplace-qr-signin">{staffT("Sign in with your company ID and password. The instruction opens in your language.")}</p>
        <p className="workplace-qr-arabic" lang="ar" dir="rtl">امسح الرمز بكاميرا هاتفك، ثم سجّل الدخول بمعرّف الشركة وكلمة المرور. ستُفتح التعليمات بلغتك.</p>
        <p className="workplace-qr-note">{staffT("This code identifies this instruction. It does not grant access or contain worker information.")}</p>
        <footer><span>{organization}</span><span>{staffT("Version")} {version}</span></footer>
      </div>
      {!kiosk && <div className="workplace-qr-controls">
        <div className="workplace-qr-fields">
          <label className="field">{staffT("Work area label")} <span className="muted">{staffT("(optional)")}</span><input value={label} maxLength={60} placeholder={staffT("Assembly bench 2")} onChange={event=>setLabel(event.target.value)}/></label>
          <label className="recipient-row workplace-qr-toggle"><input type="checkbox" checked={showTitle} onChange={event=>setShowTitle(event.target.checked)}/><span>{staffT("Show the instruction title on the poster")}</span></label>
        </div>
        <label className="field">{staffT("Worker link")}<input readOnly value={url} onFocus={event=>event.currentTarget.select()} spellCheck={false}/></label>
        <div className="actions">
          <button type="button" className="button outline" onClick={()=>void copy()}>{copyState==='copied'?<Check size={18}/>:<Copy size={18}/>}{copyState==='copied'?staffT("Link copied"):copyState==='failed'?staffT("Select the link to copy"):staffT("Copy link")}</button>
          <button type="button" className="button outline" onClick={()=>window.print()}><Printer size={18}/>{staffT("Print poster")}</button>
          <button type="button" className="button outline" onClick={()=>setKiosk(true)}><Expand size={18}/>{staffT("Kiosk view")}</button>
          <button type="button" className="button primary" onClick={onClose}><X size={18}/>{staffT("Close")}</button>
        </div>
        <p className="muted">{staffT("The printed code works only after a worker signs in. Keep it attached to the work area, and remove it when the instruction is archived.")}</p>
      </div>}
    </dialog>,
    document.body
  );
}
