import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureBillingSchema,createInvoice,recordPayment,voidInvoice,getInvoice,listInvoices,billingReceipt} from '../server/billing.mjs';
import {moneyCents,invoiceInput,paymentInput,voidInput,invoiceTotals,invoiceFilters,billingRequestSignature} from '../server/billing-input.mjs';
import {createAppServer} from '../server/index.mjs';
import {sqliteApp,loginRoute,principalLoginBody} from './helpers/sqlite-app.mjs';

const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const invoice=()=>({requestId:randomUUID(),number:'INV-001',description:'Synthetic pilot service',issueDate:'2026-10-01',dueDate:'2026-10-10',amount:'25.00',confirmed:true});
const payment=()=>({requestId:randomUUID(),reference:'Synthetic transfer',note:'Disposable record only',date:'2026-10-01',amount:'10.10',confirmed:true});
const cancellation=()=>({requestId:randomUUID(),number:'INV-001',amount:'25.00',reason:'Issued in error - synthetic only',confirmed:true});
test('billing amounts use exact integer cents and dates/filters/confirmation are validated',()=>{
  for(const [value,cents] of [['0.01',1],['10.1',1010],['25.00',2500],['10000000',1000000000]]) {
    assert.equal(moneyCents(value),cents);
  }
  for(const value of ['-1','1e3','1.001','0','0.00','Infinity','10000001',' 25 ',25]) assert.throws(()=>moneyCents(value),/Invalid/);
  for(const patch of [{confirmed:false},{number:'../invoice'},{issueDate:'2026-02-30'},{dueDate:'2026-09-01'},{org_id:'harbor'}]) assert.throws(()=>invoiceInput({...invoice(),...patch}),/Invalid/);
  assert.throws(()=>paymentInput({...payment(),date:'2099-01-01'}),/future/);
  assert.throws(()=>invoiceFilters({org_id:'cedar'}),/Invalid/);assert.throws(()=>invoiceFilters({pageSize:101}),/Invalid/);
  for(const patch of [{confirmed:false},{reason:'  x '},{amount:'1.001'},{number:'../invoice'},{paid:0}]) assert.throws(()=>voidInput({...cancellation(),...patch}),/Invalid/);
  assert.throws(()=>invoiceTotals({amount_cents:2500,paid_cents:1,voided_cents:2500}),/invalid/);
});

test('SQLite unpaid voids retain original totals and immutable evidence with exact replay and audit rollback',()=>{
  const db=openDatabase(':memory:');seed(db);ensureBillingSchema(db);
  try {
    const created=createInvoice(db,owner,invoice()),input=cancellation();
    assert.throws(()=>voidInvoice(db,owner,created.id,{...input,amount:'24.99'}),/details changed/);
    db.exec("CREATE TRIGGER reject_void_audit BEFORE INSERT ON audit WHEN NEW.action='invoice.voided' BEGIN SELECT RAISE(ABORT,'Injected audit failure'); END");
    assert.throws(()=>voidInvoice(db,owner,created.id,input),/Injected/);assert.equal(getInvoice(db,owner,created.id).status,'unpaid');
    db.exec('DROP TRIGGER reject_void_audit');const result=voidInvoice(db,owner,created.id,input);
    assert.equal(result.duplicate,false);assert.deepEqual(voidInvoice(db,owner,created.id,{...input,amount:'25'}),{...result,duplicate:true});
    assert.throws(()=>voidInvoice(db,owner,created.id,{...input,reason:'Different reason'}),/conflict/);
    assert.throws(()=>voidInvoice(db,owner,created.id,{...input,requestId:randomUUID()}),/voided/);
    const detail=getInvoice(db,owner,created.id);assert.equal(detail.amountCents,2500);assert.equal(detail.paidCents,0);assert.equal(detail.voidedCents,2500);assert.equal(detail.balanceCents,0);assert.equal(detail.status,'void');assert.equal(detail.voidRecord.reason,input.reason);
    assert.equal(listInvoices(db,owner,{status:'void'}).total,1);assert.equal(listInvoices(db,owner,{status:'unpaid'}).total,0);assert.equal(listInvoices(db,owner,{status:'paid'}).total,0);
    assert.deepEqual(billingReceipt(db,owner,'void',input.requestId),{found:true,kind:'void',id:input.requestId,invoiceId:created.id,requestHash:createHash('sha256').update(billingRequestSignature('void',input.requestId,created.id,voidInput(input))).digest('hex')});
    assert.throws(()=>recordPayment(db,owner,created.id,payment()),/voided/);
    assert.throws(()=>db.prepare('INSERT INTO invoice_payments VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'cedar','beirut',created.id,1,'2026-10-01','Synthetic','','{}','maya','2026-10-01'),/voided/);
    for(const sql of ["UPDATE invoice_voids SET reason='changed'",'DELETE FROM invoice_voids']) assert.throws(()=>db.exec(sql),/immutable/);
    const paid=createInvoice(db,owner,{...invoice(),number:'INV-002'});recordPayment(db,owner,paid.id,payment());
    assert.throws(()=>voidInvoice(db,owner,paid.id,{...cancellation(),number:'INV-002'}),/Only unpaid/);
    assert.throws(()=>db.prepare('INSERT INTO invoice_voids VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),'cedar','beirut',paid.id,'Synthetic cancellation','{}','maya','2026-10-01'),/Only unpaid/);
    assert.throws(()=>voidInvoice(db,{...owner,principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard'},created.id,cancellation()),/unavailable/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='invoice.voided'").get().n,1);
  } finally {db.close();}
});
test('SQLite manual invoices and partial payments replay exactly, preserve balances and roll back audit failures',()=>{
  const db=openDatabase(':memory:');seed(db);ensureBillingSchema(db);
  try {
    const request=invoice(),created=createInvoice(db,owner,request);
    assert.deepEqual(createInvoice(db,owner,{...request,amount:'25'}),{...created,duplicate:true});
    assert.throws(()=>createInvoice(db,owner,{...request,description:'Changed'}),/conflict/);
    assert.throws(()=>createInvoice(db,owner,{...request,requestId:randomUUID()}),/number already/);
    const first=payment(),recorded=recordPayment(db,owner,created.id,first);
    assert.deepEqual(billingReceipt(db,owner,'invoice',created.id),{found:true,kind:'invoice',id:created.id,invoiceId:created.id,requestHash:createHash('sha256').update(billingRequestSignature('invoice',created.id,created.id,invoiceInput(request))).digest('hex')});
    assert.deepEqual(billingReceipt(db,owner,'payment',recorded.id),{found:true,kind:'payment',id:recorded.id,invoiceId:created.id,requestHash:createHash('sha256').update(billingRequestSignature('payment',recorded.id,created.id,paymentInput(first))).digest('hex')});assert.equal(billingReceipt(db,owner,'payment',randomUUID()).found,false);
    assert.deepEqual(recordPayment(db,owner,created.id,first),{...recorded,duplicate:true});
    let detail=getInvoice(db,owner,created.id);assert.equal(detail.amountCents,2500);assert.equal(detail.paidCents,1010);assert.equal(detail.balanceCents,1490);assert.equal(detail.status,'partial');assert.equal(detail.payments.length,1);
    assert.throws(()=>recordPayment(db,owner,created.id,{...first,amount:'10.11'}),/conflict/);
    assert.throws(()=>recordPayment(db,owner,created.id,{...payment(),amount:'14.91'}),/balance/);
    db.exec("CREATE TRIGGER reject_billing_audit BEFORE INSERT ON audit WHEN NEW.action='invoice.payment_recorded' BEGIN SELECT RAISE(ABORT,'Injected audit failure'); END");
    assert.throws(()=>recordPayment(db,owner,created.id,{...payment(),amount:'14.90'}),/Injected/);assert.equal(getInvoice(db,owner,created.id).balanceCents,1490);
    db.exec('DROP TRIGGER reject_billing_audit');recordPayment(db,owner,created.id,{...payment(),amount:'14.90'});
    detail=getInvoice(db,owner,created.id);assert.equal(detail.balanceCents,0);assert.equal(detail.status,'paid');assert.equal(detail.payments.length,2);
    assert.deepEqual(recordPayment(db,owner,created.id,first),{...recorded,duplicate:true});assert.throws(()=>recordPayment(db,owner,created.id,payment()),/balance/);
    assert.equal(listInvoices(db,owner,{status:'paid'}).total,1);assert.equal(listInvoices(db,owner,{status:'unpaid'}).total,0);
    for(const table of ['invoices','invoice_payments']) for(const statement of [`UPDATE ${table} SET org_id='harbor'`,`DELETE FROM ${table}`]) assert.throws(()=>db.exec(statement),/immutable/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='invoice.payment_recorded'").get().n,2);
    assert.ok(!JSON.stringify(detail).includes('request_json'));
    db.prepare("UPDATE organizations SET name='Changed issuer' WHERE id='cedar'").run();
    assert.equal(getInvoice(db,owner,created.id).issuerName,'Cedar Works');
  } finally {db.close();}
});

test('SQLite billing private HTTP routes replay invoices/payments and escape private downloads',async()=>{
  const db=openDatabase(':memory:');seed(db);const server=sqliteApp(db,{publicOrigin:'http://127.0.0.1:3020'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  const call=(path,cookie,body)=>fetch(base+path,{method:body ? 'POST' : 'GET',headers:{...(cookie ? {cookie} : {}),'content-type':'application/json',origin:'http://127.0.0.1:3020'},body:body ? JSON.stringify(body) : undefined});
  try {
    const login=await call(loginRoute('maya'),null,principalLoginBody('maya')),cookie=login.headers.get('set-cookie').split(';')[0];
    const request={...invoice(),description:'<script>alert(1)</script> & synthetic service'},created=await call('/invoices',cookie,request);assert.equal(created.status,201);const {id}=await created.json();
    assert.equal((await call('/invoices',cookie,request)).status,200);
    const invoiceReceipt=await call(`/invoices/requests/invoice/${request.requestId}`,cookie);assert.equal(invoiceReceipt.status,200);assert.equal((await invoiceReceipt.json()).invoiceId,id);assert.match(invoiceReceipt.headers.get('cache-control'),/no-store/);
    const paid=payment();assert.equal((await call(`/invoices/${id}/payments`,cookie,paid)).status,201);assert.equal((await call(`/invoices/${id}/payments`,cookie,paid)).status,200);
    const download=await call(`/invoices/${id}/download`,cookie);assert.equal(download.status,200);assert.match(download.headers.get('cache-control'),/no-store/);assert.match(download.headers.get('content-security-policy'),/default-src 'none'/);assert.match(download.headers.get('content-disposition'),/attachment/);
    const html=await download.text();assert.match(html,/\$14\.90/);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));
    assert.equal((await call('/invoices?status=bad',cookie)).status,400);assert.equal((await call(`/invoices/${id}/payments`,cookie,{...payment(),amount:'14.91'})).status,409);
    assert.equal((await call(`/invoices/${id}`,cookie)).status,200);assert.equal((await call(`/invoices/${id}/download`,null)).status,401);
    const workerLogin=await call(loginRoute('worker-30'),null,principalLoginBody('worker-30')),workerCookie=workerLogin.headers.get('set-cookie').split(';')[0];assert.equal((await call(`/invoices/${id}/download`,workerCookie)).status,403);
    assert.equal((await call(`/invoices/requests/invoice/${request.requestId}`,workerCookie)).status,403);
    const foreignLogin=await call(loginRoute('harbor-owner'),null,principalLoginBody('harbor-owner')),foreignCookie=foreignLogin.headers.get('set-cookie').split(';')[0];assert.equal((await call(`/invoices/${id}/download`,foreignCookie)).status,404);
    assert.equal((await (await call(`/invoices/requests/invoice/${request.requestId}`,foreignCookie)).json()).found,false);
    const voidRequest={...invoice(),number:'HTTP-VOID'},voidCreated=await call('/invoices',cookie,voidRequest),voidId=(await voidCreated.json()).id;
    const input={...cancellation(),number:'HTTP-VOID',reason:'Synthetic <script> cancellation'};
    assert.equal((await call(`/invoices/${voidId}/void`,cookie,{...input,confirmed:false})).status,400);
    assert.equal((await call(`/invoices/${voidId}/void`,workerCookie,input)).status,403);
    assert.equal((await call(`/invoices/${voidId}/void`,foreignCookie,input)).status,404);
    assert.equal((await call(`/invoices/${voidId}/void`,cookie,input)).status,201);assert.equal((await call(`/invoices/${voidId}/void`,cookie,input)).status,200);
    assert.equal((await call(`/invoices/${id}/void`,cookie,cancellation())).status,409);
    assert.equal((await call(`/invoices/${voidId}/payments`,cookie,payment())).status,409);
    assert.equal((await (await call(`/invoices/requests/void/${input.requestId}`,cookie)).json()).invoiceId,voidId);
    const voidHtml=await (await call(`/invoices/${voidId}/download`,cookie)).text();assert.match(voidHtml,/Voided amount/);assert.match(voidHtml,/&lt;script&gt;/);assert.match(voidHtml,/\$0\.00/);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});

test('SQLite invoice and payment pages have complete counts and nonoverlapping bounded pages',()=>{
  const db=openDatabase(':memory:');seed(db);ensureBillingSchema(db);
  try {
    for(let i=0;i<105;i++) createInvoice(db,owner,{...invoice(),number:`PAGE-${String(i).padStart(3,'0')}`});
    const first=listInvoices(db,owner,{pageSize:100}),second=listInvoices(db,owner,{page:2,pageSize:100});assert.equal(first.total,105);assert.equal(second.items.length,5);assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,105);
    const id=first.items[0].id;for(let i=0;i<105;i++) recordPayment(db,owner,id,{...payment(),amount:'0.01'});
    const a=getInvoice(db,owner,id,{pageSize:100}),b=getInvoice(db,owner,id,{page:2,pageSize:100});assert.equal(a.paymentCount,105);assert.equal(b.payments.length,5);assert.equal(new Set([...a.payments,...b.payments].map(item=>item.id)).size,105);assert.equal(b.balanceCents,2395);
    assert.equal(listInvoices(db,owner,{search:'%'}).total,0);
  } finally {db.close();}
});
test('SQLite billing reads/writes recheck actual owner/auditor role and tenant/site scope',()=>{
  const db=openDatabase(':memory:');seed(db);ensureBillingSchema(db);
  try {
    const created=createInvoice(db,owner,invoice());
    const auditor={...owner,role:'auditor',principal_id:'billing-auditor'};db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run(auditor.principal_id,'cedar','beirut','Billing auditor','auditor');
    assert.equal(getInvoice(db,auditor,created.id).number,'INV-001');assert.throws(()=>createInvoice(db,auditor,invoice()),/Forbidden/);assert.throws(()=>recordPayment(db,auditor,created.id,payment()),/Forbidden/);
    for(const session of [{...owner,role:'supervisor'},{...owner,principal_id:'missing'},{...owner,site_id:'harbor-yard'},{principal_type:'worker'}]) assert.throws(()=>getInvoice(db,session,created.id),/Forbidden/);
    const foreign={...owner,principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard'};
    assert.equal(listInvoices(db,foreign).total,0);assert.throws(()=>getInvoice(db,foreign,created.id),/unavailable/);assert.throws(()=>recordPayment(db,foreign,created.id,payment()),/unavailable/);
    db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();assert.throws(()=>getInvoice(db,owner,created.id),/Forbidden/);
  } finally {db.close();}
});
