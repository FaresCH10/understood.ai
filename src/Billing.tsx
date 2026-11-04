import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowLeft,CheckCircle2,ChevronLeft,ChevronRight,Download,FileText,Plus,RefreshCw,Save,TriangleAlert,Ban,X} from 'lucide-react';
import {readPendingBilling,savePendingBilling,clearPendingBilling,checkedBillingReceipt,checkedBillingResult,type PendingBilling} from './billing-recovery';
import {keepDialogFocus} from './dialog-focus';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {completeStaffRequest,retainStaffRequest,StaffRequestError} from './staff-request';

type Invoice={id:string;number:string;description:string;issueDate:string;dueDate:string;currency:string;issuerName:string;siteName:string;amountCents:number;paidCents:number;voidedCents:number;balanceCents:number;status:'unpaid'|'partial'|'paid'|'void'};
type Detail=Invoice & {voidRecord:{reason:string;createdAt:string}|null;payments:{id:string;amountCents:number;date:string;reference:string;note:string;recordedAt:string}[];paymentCount:number;paymentPage:number;paymentPageSize:number};
type Page={items:Invoice[];total:number;page:number;pageSize:number};
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const today=()=>new Date().toISOString().slice(0,10);
function useBillingRequests(authority:StaffRequestAuthority) {
  const scoped=useStaffRequest(authority);
  const complete=<T,>(value:unknown,validate:(value:unknown)=>T|Promise<T>,done:(result:T)=>void)=>completeStaffRequest(value,validate,done,scoped.current,authority.canMutate);
  const accepted=(value:unknown,pending:PendingBilling,done:(invoiceId:string)=>void)=>complete(value,async value=>{
    checkedBillingResult(value,pending);
    const receipt=await scoped.request(`/api/invoices/requests/${pending.kind}/${pending.requestId}`);
    const id=await checkedBillingReceipt(receipt,pending);if(!id)throw Error('The billing outcome is not confirmed. Check the saved receipt.');return id;
  },done);
  return {...scoped,complete,accepted};
}
function Status({value}:{value:Invoice['status']}) {
  const staffT=useStaffStaticText();return <span className={`status status-${value==='paid' ? 'green' : value==='void' ? 'gray' : 'amber'}`}>{value==='paid'?staffT("Paid"):value==='partial'?staffT("Partially paid"):value==='void'?staffT("Voided"):staffT("Awaiting payment")}</span>;}
function Pager({page,total,setPage,label}:{page:number;total:number;setPage:(page:number)=>void;label:string}) {
  const staffT=useStaffStaticText();
  const pages=Math.max(1,Math.ceil(total/20));
  return <div className="audit-pagination"><span>{staffT("Page")} {staffT.number(page)} {staffT("of")} {staffT.number(pages)} · {total} {label}</span><div className="actions"><button className="icon-button" title={staffT("Previous {p0} page",{p0:label})} aria-label={staffT("Previous {p0} page",{p0:label})} disabled={page<=1} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button><button className="icon-button" title={staffT("Next {p0} page",{p0:label})} aria-label={staffT("Next {p0} page",{p0:label})} disabled={page>=pages} onClick={()=>setPage(page+1)}><ChevronRight size={18}/></button>{page>pages && <button className="button outline" onClick={()=>setPage(1)}>{staffT("First page")}</button>}</div></div>;
}
function LedgerForm({invoice,onSaved,onLocked,scope,authority}:{invoice?:Invoice;onSaved:(id:string)=>void;onLocked:(locked:boolean)=>void;scope:string;authority:StaffRequestAuthority}) {
  const staffT=useStaffStaticText();
  const {request,current,accepted}=useBillingRequests(authority);
  const [values,setValues]=useState({number:'',description:'',issueDate:today(),dueDate:today(),amount:'',date:today(),reference:'',note:''});
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
  const sending=useRef(false),pending=useRef<{key:string;id:string}|null>(null);
  const update=(key:keyof typeof values,value:string)=>{setValues(old=>({...old,[key]:value}));setConfirmed(false);setError('');};
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(sending.current || !confirmed || !current()) return;
    const payload:Record<string,string|boolean>=invoice ? {amount:values.amount,date:values.date,reference:values.reference.trim(),note:values.note.trim(),confirmed:true} : {number:values.number,description:values.description.trim(),issueDate:values.issueDate,dueDate:values.dueDate,amount:values.amount,confirmed:true};
    const key=JSON.stringify(payload);if(pending.current?.key!==key) pending.current={key,id:crypto.randomUUID()};
    sending.current=true;setBusy(true);setError('');
    let sent=false;
    const submitted:PendingBilling={requestId:pending.current.id,kind:invoice ? 'payment' : 'invoice',invoiceId:invoice?.id || null,body:payload};
    try {savePendingBilling(sessionStorage,scope,submitted);sent=true;
      const saved=await request(invoice ? `/api/invoices/${encodeURIComponent(invoice.id)}/payments` : '/api/invoices',{...payload,requestId:submitted.requestId});
      await accepted(saved,submitted,invoiceId=>{clearPendingBilling(sessionStorage,scope,submitted.requestId,submitted);pending.current=null;setUncertain(false);setConfirmed(false);setValues(old=>({...old,amount:'',reference:'',note:''}));onSaved(invoiceId);});}
    catch(err) {if(!current())return;const unknown=retainStaffRequest(uncertain,sent,err instanceof StaffRequestError?err:null);setError((err as Error).message);setUncertain(unknown);if(sent && !unknown && pending.current) {try {clearPendingBilling(sessionStorage,scope,submitted.requestId,submitted);}catch(storageError){setError((storageError as Error).message);setUncertain(true);}}}
    finally {sending.current=false;if(current())setBusy(false);}
  };
  const locked=busy || uncertain;
  useEffect(()=>{if(current())onLocked(locked);},[locked,onLocked,current]);
  return <form className="billing-form" onSubmit={event=>void submit(event)}>
    <h2>{invoice?staffT("Record received payment"):staffT("Create invoice")}</h2>
    {!invoice && <><label className="field">{staffT("Invoice number")}<input value={values.number} onChange={event=>update('number',event.target.value)} pattern="[A-Z0-9][A-Z0-9-]{0,39}" maxLength={40} disabled={locked} required/></label><label className="field">{staffT("Description")}<textarea value={values.description} onChange={event=>update('description',event.target.value)} maxLength={500} disabled={locked} required/></label><div className="billing-dates"><label className="field">{staffT("Issue date")}<input type="date" value={values.issueDate} onChange={event=>update('issueDate',event.target.value)} disabled={locked} required/></label><label className="field">{staffT("Due date")}<input type="date" min={values.issueDate} value={values.dueDate} onChange={event=>update('dueDate',event.target.value)} disabled={locked} required/></label></div></>}
    <label className="field">{staffT("Amount (USD)")}<input inputMode="decimal" value={values.amount} pattern="[0-9]{1,8}(\.[0-9]{1,2})?" maxLength={11} onChange={event=>update('amount',event.target.value)} disabled={locked} required/></label>
    {invoice && <><label className="field">{staffT("Payment reference")}<input value={values.reference} onChange={event=>update('reference',event.target.value)} maxLength={120} disabled={locked} required/></label><label className="field">{staffT("Date received")}<input type="date" max={today()} value={values.date} onChange={event=>update('date',event.target.value)} disabled={locked} required/></label><label className="field">{staffT("Note (optional)")}<textarea value={values.note} onChange={event=>update('note',event.target.value)} maxLength={500} disabled={locked}/></label></>}
    <label className="billing-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={locked} required/><span>{invoice?staffT("I confirm this payment has already been received."):staffT("I have checked the invoice number, description, amount and dates.")}</span></label>
    {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
    <button className="button primary full" type="submit" disabled={busy || !confirmed}><Save size={18}/>{busy?staffT("Saving..."):uncertain?staffT("Retry unchanged request"):invoice?staffT("Save payment record"):staffT("Create invoice")}</button>
    <div className="notice notice-blue"><FileText size={20}/><span>{invoice?staffT("This records a payment; it does not charge a card."):staffT("Issued invoices cannot be edited or deleted.")}</span></div>
  </form>;
}
function VoidControl({invoice,scope,disabled,onSaved,onLocked,authority}:{invoice:Invoice;scope:string;disabled:boolean;onSaved:(id:string,message?:string)=>void;onLocked:(value:boolean)=>void;authority:StaffRequestAuthority}) {
  const staffT=useStaffStaticText();
  const {request,current,accepted}=useBillingRequests(authority);
  const dialog=useRef<HTMLDialogElement>(null),sending=useRef(false),pending=useRef<{key:string;id:string}|null>(null);
  const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
  const locked=busy || uncertain;
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(sending.current || !confirmed || reason.trim().length<3 || !current()) return;
    const body={number:invoice.number,amount:(invoice.amountCents/100).toFixed(2),reason:reason.trim(),confirmed:true},key=JSON.stringify(body);
    if(pending.current?.key!==key) pending.current={key,id:crypto.randomUUID()};
    sending.current=true;setBusy(true);onLocked(true);setError('');let sent=false;
    const submitted:PendingBilling={kind:'void',invoiceId:invoice.id,requestId:pending.current.id,body};
    try {savePendingBilling(sessionStorage,scope,submitted);sent=true;
      const result=await request(`/api/invoices/${encodeURIComponent(invoice.id)}/void`,{...body,requestId:submitted.requestId});
      await accepted(result,submitted,id=>{clearPendingBilling(sessionStorage,scope,submitted.requestId,submitted);pending.current=null;setUncertain(false);dialog.current?.close();onLocked(false);onSaved(id,'Invoice voided.');});}
    catch(err) {if(!current())return;let unknown=retainStaffRequest(uncertain,sent,err instanceof StaffRequestError?err:null);setError((err as Error).message);
      if(sent && !unknown && pending.current) {try {clearPendingBilling(sessionStorage,scope,submitted.requestId,submitted);}catch(storageError){setError((storageError as Error).message);unknown=true;}}
      setUncertain(unknown);onLocked(unknown);}
    finally {sending.current=false;if(current())setBusy(false);}
  };
  return <><button className="button outline" disabled={disabled || busy} onClick={()=>{setReason('');setConfirmed(false);setError('');dialog.current?.showModal();}}><Ban size={18}/>{staffT("Void invoice")}</button>
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby="void-title" aria-describedby="void-impact" onKeyDown={keepDialogFocus} onCancel={event=>{if(sending.current || uncertain) event.preventDefault();}} onClose={()=>setConfirmed(false)}>
      <form onSubmit={event=>void submit(event)}><div className="withdraw-heading"><h2 id="void-title">{staffT("Void invoice")} {invoice.number}?</h2><button type="button" className="icon-button" autoFocus title={staffT("Close invoice void")} aria-label={staffT("Close invoice void")} disabled={locked} onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
        <p id="void-impact" className="withdraw-impact"><TriangleAlert size={24}/><span>{staffT("The unpaid")} {staffT.money(invoice.amountCents)} {staffT("balance will be cancelled. The original invoice and your reason remain in the ledger. This cannot be undone and does not process a refund.")}</span></p>
        <label className="field">{staffT("Reason for voiding")}<textarea value={reason} minLength={3} maxLength={500} required rows={3} disabled={locked} onChange={event=>{setReason(event.target.value);setConfirmed(false);}}/></label>
        <label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={locked || reason.trim().length<3} onChange={event=>setConfirmed(event.target.checked)}/><span>{staffT("I confirm cancellation of this unpaid invoice.")}</span></label>
        {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}<div className="actions"><button type="button" className="button outline" disabled={locked} onClick={()=>dialog.current?.close()}>{staffT("Cancel")}</button><button className="button primary" disabled={busy || !confirmed || reason.trim().length<3}><Ban size={18}/>{busy?staffT("Saving..."):uncertain?staffT("Retry unchanged request"):staffT("Confirm void")}</button></div>
      </form>
    </dialog></>;
}
function Recovery({pending,scope,onSaved,authority}:{pending:PendingBilling;scope:string;onSaved:(id:string)=>void;authority:StaffRequestAuthority}) {
  const staffT=useStaffStaticText();
  const {request,current:sessionCurrent,complete,accepted}=useBillingRequests(authority),saved=useRef(onSaved);saved.current=onSaved;
  const [error,setError]=useState(''),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[receiptMissing,setReceiptMissing]=useState(false),[refresh,setRefresh]=useState(0);
  const sending=useRef(false);
  useEffect(()=>{const controller=new AbortController();setChecking(true);setReceiptMissing(false);setError('');
    request(`/api/invoices/requests/${pending.kind}/${pending.requestId}`,undefined,controller.signal).then(receipt=>complete(receipt,value=>checkedBillingReceipt(value,pending),id=>{
      if(controller.signal.aborted)return;if(id){clearPendingBilling(sessionStorage,scope,pending.requestId,pending);saved.current(id);}else setReceiptMissing(true);
    })).catch(err=>{if(!controller.signal.aborted && sessionCurrent())setError((err as Error).message);}).finally(()=>{if(!controller.signal.aborted && sessionCurrent())setChecking(false);});
    return ()=>controller.abort();
  },[pending,scope,refresh,request,sessionCurrent]);
  const retry=async()=>{if(sending.current || !receiptMissing || !sessionCurrent()) return;sending.current=true;setBusy(true);setError('');
    try {const result=await request(pending.kind==='invoice' ? '/api/invoices' : `/api/invoices/${pending.invoiceId}/${pending.kind==='void' ? 'void' : 'payments'}`,{...pending.body,requestId:pending.requestId});await accepted(result,pending,id=>{clearPendingBilling(sessionStorage,scope,pending.requestId,pending);saved.current(id);});}
    catch(err){if(sessionCurrent())setError((err as Error).message);}finally{sending.current=false;if(sessionCurrent())setBusy(false);}};
  return <section className="panel billing-new"><h2>{staffT("Recover pending billing record")}</h2><p>{pending.kind==='payment'?staffT("A payment save was interrupted. No second payment will be entered."):pending.kind==='void'?staffT("An invoice void was interrupted."):staffT("An invoice save was interrupted.")}</p><dl className="billing-details"><dt>{staffT("Amount (USD)")}</dt><dd>{String(pending.body.amount)}</dd><dt>{pending.kind==='payment'?staffT("Payment reference"):staffT("Invoice number")}</dt><dd>{String(pending.body.number || pending.body.reference)}</dd><dt>{pending.kind==='invoice'?staffT("Description"):pending.kind==='void'?staffT("Reason for voiding"):staffT("Date received")}</dt><dd>{String(pending.body.description || pending.body.reason || pending.body.date)}</dd></dl>{checking && <p role="status">{staffT("Checking saved receipt...")}</p>}{error && <p role="alert" className="record-error">{staffT.error(error)}</p>}<div className="actions"><button className="button outline" disabled={busy || checking} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={18}/>{staffT("Check saved record")}</button>{receiptMissing && <button className="button primary" disabled={busy || checking} onClick={()=>void retry()}><Save size={18}/>{busy?staffT("Saving..."):staffT("Retry unchanged request")}</button>}</div></section>;
}
export function BillingPage({id,newInvoice,owner,navigate,scope,authority}:{id?:string;newInvoice?:boolean;owner:boolean;navigate:(path:string)=>void;scope?:string|null;authority:StaffRequestAuthority}) {
  const staffT=useStaffStaticText();
  const {request,current:sessionCurrent}=useBillingRequests(authority);
  const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(1),[paymentPage,setPaymentPage]=useState(1),[refresh,setRefresh]=useState(0);
  const [list,setList]=useState<Page|null>(null),[detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[message,setMessage]=useState('');
  const [formLocked,setFormLocked]=useState(false);
  const [pending,setPending]=useState<PendingBilling|null>(null),[recoveryError,setRecoveryError]=useState('');
  useEffect(()=>{if(!owner || !scope) return;try {setPending(readPendingBilling(sessionStorage,scope));}catch(err){setRecoveryError((err as Error).message);}},[owner,scope]);
  const heading=useRef<HTMLHeadingElement>(null);
  const query=new URLSearchParams({search,status,page:String(page),pageSize:'20'}).toString();
  useEffect(()=>{heading.current?.focus();},[id,newInvoice,pending]);
  useEffect(()=>{
    if(newInvoice) {setLoading(false);return;}
    const controller=new AbortController();setLoading(true);setError('');setDetail(null);setList(null);
    request<Page|Detail>(id ? `/api/invoices/${encodeURIComponent(id)}?page=${paymentPage}&pageSize=20` : `/api/invoices?${query}`,undefined,controller.signal)
      .then(data=>{if(!controller.signal.aborted && sessionCurrent()) {if(id) setDetail(data as Detail);else setList(data as Page);}})
      .catch(err=>{if(!controller.signal.aborted && sessionCurrent()) {setError((err as Error).message);setDetail(null);setList(null);}})
      .finally(()=>{if(!controller.signal.aborted && sessionCurrent())setLoading(false);});
    return ()=>controller.abort();
  },[id,newInvoice,query,paymentPage,refresh,request,sessionCurrent]);
  const saved=(invoiceId:string,message='Payment record saved.')=>{if(!sessionCurrent())return;setFormLocked(false);if(newInvoice) navigate(`settings/invoices/${invoiceId}`);else {setMessage(message);setPaymentPage(1);setRefresh(value=>value+1);heading.current?.focus();}};
  const recovered=(invoiceId:string)=>{if(!sessionCurrent())return;setPending(null);setMessage('Saved billing receipt recovered.');if(id===invoiceId) {setRefresh(value=>value+1);heading.current?.focus();}else navigate(`settings/invoices/${invoiceId}`);};
  if(recoveryError) return <p role="alert" className="record-error">{staffT.error(recoveryError)}</p>;
  if(pending && scope) return <><div className="page-header"><h1 ref={heading} tabIndex={-1}>{staffT("Pending billing record")}</h1></div><Recovery authority={authority} pending={pending} scope={scope} onSaved={recovered}/></>;
  return <>
    {(id || newInvoice) && <button className="back-link" disabled={formLocked} onClick={()=>navigate('settings/invoices')}><ArrowLeft size={18}/>{staffT("Invoices")}</button>}
    <div className="page-header"><div><h1 ref={heading} tabIndex={-1}>{newInvoice?staffT("New invoice"):id?staffT("Invoice {p0}",{p0:detail?.number || ''}):staffT("Invoices & payment records")}</h1><p>{staffT("Manual billing for this workspace.")}</p></div><div className="actions">{!newInvoice && <button className="icon-button" title={staffT("Refresh invoices")} aria-label={staffT("Refresh invoices")} disabled={formLocked} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={19}/></button>}{!id && !newInvoice && owner && <button className="button primary" onClick={()=>navigate('settings/invoices/new')}><Plus size={18}/>{staffT("New invoice")}</button>}</div></div>
    {message && <p role="status"><CheckCircle2 size={18}/>{staffT.message(message)}</p>}
    {newInvoice ? owner && scope ? <section className="panel billing-new"><LedgerForm authority={authority} onSaved={saved} onLocked={setFormLocked} scope={scope}/></section> : <p role="alert">{staffT("Your role cannot create invoices.")}</p> : <>
      {!id && <div className="filters"><label className="search-box"><span className="sr-only">{staffT("Search invoices")}</span><input value={search} maxLength={80} placeholder={staffT("Search invoices")} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label><label className="select-label">{staffT("Payment status")}<select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="all">{staffT("All statuses")}</option><option value="unpaid">{staffT("Awaiting payment")}</option><option value="partial">{staffT("Partially paid")}</option><option value="paid">{staffT("Paid")}</option><option value="void">{staffT("Voided")}</option></select></label></div>}
      {loading ? <p data-page-loading role="status">{staffT("Loading invoices...")}</p> : error ? <p role="alert" className="record-error">{staffT.error(error)}</p> : id && detail ? <div className="billing-grid"><div>
        <section className="panel"><h2>{staffT("Invoice preview")}</h2><div className="billing-issuer"><strong>{detail.issuerName}</strong><span>{detail.siteName}</span></div><dl className="billing-details"><dt>{staffT("Invoice")}</dt><dd>{detail.number}</dd><dt>{staffT("Issue date")}</dt><dd>{detail.issueDate}</dd><dt>{staffT("Due date")}</dt><dd>{detail.dueDate}</dd><dt>{staffT("Status")}</dt><dd><Status value={detail.status}/></dd></dl><p className="billing-description">{detail.description}</p><dl className="billing-totals"><dt>{staffT("Total (USD)")}</dt><dd>{staffT.money(detail.amountCents)}</dd><dt>{staffT("Paid")}</dt><dd>{staffT.money(detail.paidCents)}</dd>{detail.voidedCents>0 && <><dt>{staffT("Voided amount")}</dt><dd>{staffT.money(detail.voidedCents)}</dd></>}<dt>{staffT("Outstanding balance")}</dt><dd>{staffT.money(detail.balanceCents)}</dd></dl>{detail.voidRecord && <div className="notice"><Ban size={20}/><span><strong>{staffT("Invoice voided")}</strong><br/>{detail.voidRecord.reason}<br/>{detail.voidRecord.createdAt}</span></div>}<a className="button outline full" href={`/api/invoices/${detail.id}/download`} download={`invoice-${detail.number}.html`}><Download size={18}/>{staffT("Download invoice")}</a>{owner && scope && detail.status==='unpaid' && <VoidControl authority={authority} invoice={detail} scope={scope} disabled={formLocked} onSaved={saved} onLocked={setFormLocked}/>}</section>
        <section className="panel"><h2>{staffT("Payment records (")}{detail.paymentCount})</h2>{detail.payments.length ? <ul className="billing-payments">{detail.payments.map(item=><li key={item.id}><div><strong>{item.reference}</strong><span>{item.date}</span>{item.note && <p>{item.note}</p>}</div><strong>{staffT.money(item.amountCents)}</strong></li>)}</ul> : <p>{staffT("No received payments recorded.")}</p>}<Pager page={paymentPage} total={detail.paymentCount} setPage={setPaymentPage} label={staffT("payments")}/></section>
      </div><aside className="panel">{owner && scope && detail.balanceCents>0 ? <LedgerForm authority={authority} key={detail.id} invoice={detail} onSaved={saved} onLocked={setFormLocked} scope={scope}/> : <><h2>{detail.status==='void'?staffT("Voided invoice"):detail.balanceCents===0?staffT("Paid in full"):staffT("Read-only record")}</h2><p>{detail.status==='void'?staffT("No payments can be recorded on this invoice."):detail.balanceCents===0?staffT("No outstanding balance."):staffT("Only the workspace owner can record payments.")}</p></>}<div className="notice notice-blue"><FileText size={20}/><span>{staffT("Invoice and payment records are retained as immutable evidence.")}</span></div></aside></div> : list && <section className="panel"><h2>{staffT("Invoices (")}{staffT.number(list.total)})</h2>{list.items.length ? <div className="billing-list">{list.items.map(item=><button className="billing-row" key={item.id} onClick={()=>navigate(`settings/invoices/${item.id}`)}><span><strong>{item.number}</strong><small>{item.issueDate} {staffT("· Due")} {item.dueDate}</small><span>{item.description}</span></span><span><strong>{staffT.money(item.amountCents)}</strong><small>{staffT.money(item.balanceCents)} {staffT("outstanding")}</small><Status value={item.status}/></span><ChevronRight size={18}/></button>)}</div> : <div className="settings-empty"><FileText size={30} aria-hidden="true"/><p>{page>Math.ceil(list.total/20) && page>1?staffT("This page is no longer available."):staffT("No invoices match these filters.")}</p></div>}<Pager page={page} total={list.total} setPage={setPage} label={staffT("invoices")}/></section>}
    </>}
    <div className="notice"><TriangleAlert size={20}/><span>{staffT("Payment records are entered manually. They are not bank or provider reconciliation.")}</span></div>
  </>;
}
