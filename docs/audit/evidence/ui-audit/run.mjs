import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';

const staffBase='http://127.0.0.1:3220';
const workerBase='http://127.0.0.1:3194';
const operatorBase='http://127.0.0.1:3195';
const evidence=new URL('./',import.meta.url);
await mkdir(evidence,{recursive:true});
const shot=name=>new URL(name,evidence).pathname.slice(1);
const englishWords=['Today','Instructions','Calendar','Team','Crews','Clarifications','Reports','Settings','Sign out','Send instruction','Overview','Responses','Languages','History','Draft','Published','Scheduled','Loading','Retry','Search','Owner','Status','Deadline','Received','No deadline','Unassigned','Open','Resolved','All cases','Filters','Refresh','Back','Cancel','Save','Delete','Archive','Invite','Staff','Usage','Retention','Notifications','Help','Device','Work','Answer','Question','Text','Audio','Glossary','Private answer rubric','Field presence','Delivery','Format','Sent','Not delivered','Waiting','Needs attention','No instructions','No workers','No cases','No notifications','No activity','Calendar unavailable','This page is not available','Workspace settings','Organization & site','Plan & usage','Privacy & retention','Staff & access','Invoices','Invitations','Language readiness','AI processing','Source audio','Templates','Command center','Support desk','Processing jobs','Workspaces','Entitlements','Translation feedback','AI & quotas','Dispatch controls','Audit trail','Troubleshooting'];
const staffRoutes=[
  ['overview','#overview'],['briefings','#briefings'],['instruction','#briefings/shelf'],['new-instruction','#briefings/new'],['send','#send'],
  ['calendar','#calendar'],['people','#people'],['people-new','#people/new'],['crews','#people/crews'],['new-crew','#people/new-crew'],['import','#people/import'],['worker-detail','#people/worker/worker-1'],
  ['clarifications','#clarifications'],['clarification-new','#clarifications/new'],['clarification-detail','#clarifications/clarification-28'],
  ['reports','#reports'],['notifications','#notifications'],['search','#search'],['settings','#settings'],['settings-staff','#settings/staff'],['settings-invitations','#settings/invitations'],['settings-invoices','#settings/invoices'],['settings-invoice-new','#settings/invoices/new'],['settings-usage','#settings/usage'],['settings-retention','#settings/retention'],['settings-onboarding','#settings/onboarding'],
  ['language-readiness','#language-readiness'],['processing','#processing'],['source-audio','#source-audio'],['glossary','#glossary'],['glossary-new','#glossary/new'],['templates','#templates'],['translation-feedback','#translation-feedback'],['first-run','#onboarding/first-run'],['operations','#operations'],['unknown','#no-such-page'],['unknown-settings','#settings/no-such-tab']
];
const publicRoutes=[['home','#home'],['platform','#platform'],['how-it-works','#how-it-works'],['languages','#languages'],['companies','#companies'],['plans','#plans'],['pricing','#pricing'],['contact','#contact'],['walkthrough','#walkthrough'],['pilot','#pilot'],['support','#support'],['support-send','#support/send-instructions'],['sign-in','#sign-in'],['register','#register'],['register-pro','#register/pro'],['account-recovery','#account-recovery'],['reset-password','#reset-password'],['accept-invitation','#accept-invitation'],['verify-registration','#verify-registration'],['worker-access','#worker-access']];
const workerLocales=['en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'];
const operatorTabs=['Command center','Support desk','Processing jobs','Workspaces','Entitlements','Translation feedback','AI & quotas','Dispatch controls','Audit trail','Troubleshooting'];

const chrom=await chromium.launch({channel:'msedge',headless:true});
const results={staff:[],public:[],arabic:[],worker:[],operator:[],errors:[]};
function watch(page,label){
  page.on('pageerror',e=>results.errors.push(`${label} pageerror: ${e.message}`));
  page.on('console',m=>{if(m.type()==='error')results.errors.push(`${label} console: ${m.text()}`);});
  page.on('response',r=>{if(r.status()>=400)results.errors.push(`${label} http ${r.status()}: ${r.url()}`);});
}
async function inspect(page,label,route,{screenshot=null,english=false}={}){
  await page.waitForTimeout(900);
  const data=await page.evaluate(({english,words})=>{
    const visible=node=>!!(node && (node.offsetWidth||node.offsetHeight||node.getClientRects().length));
    const name=node=>{
      const labelled=node.getAttribute?.('aria-labelledby');
      const labelledText=labelled?labelled.split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim():'';
      return (node.getAttribute?.('aria-label')||labelledText||node.getAttribute?.('title')||node.innerText||node.textContent||'').replace(/\s+/g,' ').trim();
    };
    const controls=[...document.querySelectorAll('button,a[href],input,select,textarea')].filter(visible);
    const unnamed=controls.filter(node=>{
      if(node.tagName==='INPUT' && ['hidden','submit','button'].includes(node.type))return false;
      if(node.tagName==='INPUT'||node.tagName==='SELECT'||node.tagName==='TEXTAREA'){
        const labels=node.labels?[...node.labels].map(label=>label.textContent||'').join(' ').trim():'';
        return !(labels||node.getAttribute('aria-label')||node.getAttribute('aria-labelledby')||node.getAttribute('title'));
      }
      return !name(node);
    }).map(node=>({tag:node.tagName,type:node.getAttribute('type')||null,text:name(node).slice(0,80),id:node.id||null,className:typeof node.className==='string'?node.className.slice(0,80):null}));
    const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);
    const duplicateIds=[...new Set(ids.filter((id,index)=>ids.indexOf(id)!==index))];
    const imagesNoAlt=[...document.querySelectorAll('img')].filter(img=>!img.hasAttribute('alt')).map(img=>img.getAttribute('src'));
    const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(node=>({tag:node.tagName,text:(node.textContent||'').replace(/\s+/g,' ').trim().slice(0,100)}));
    const body=(document.querySelector('#staff-main')||document.querySelector('main')||document.body).innerText.replace(/\s+/g,' ').trim();
    const lower=body.toLowerCase();
    return {title:document.title,h1:document.querySelector('h1')?.textContent?.replace(/\s+/g,' ').trim()||null,body:body.slice(0,700),overflow:document.documentElement.scrollWidth>innerWidth+1,unnamed,duplicateIds,imagesNoAlt,headings,englishWords:english?words.filter(word=>lower.includes(word.toLowerCase())):[],lang:document.documentElement.lang,dir:document.documentElement.dir,hash:location.hash};
  },{english,words:englishWords});
  const entry={label,route,...data};
  if(screenshot)await page.screenshot({path:shot(screenshot),fullPage:false});
  return entry;
}
async function staffContext(language='en',viewport={width:1280,height:900}){
  const context=await chrom.newContext({viewport,deviceScaleFactor:1});
  if(language==='ar')await context.addInitScript(()=>{try{localStorage.setItem('understood:interface-language','ar');}catch{}});
  const page=await context.newPage();watch(page,`staff-${language}`);
  await page.goto(`${staffBase}/api/qa-bootstrap?language=${language}`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.staff-shell',{timeout:25000});
  await page.waitForSelector('.brand-loader',{state:'detached',timeout:25000}).catch(()=>{});
  await page.waitForTimeout(500);
  return {context,page};
}
{
  const {context,page}=await staffContext('en',{width:1280,height:900});
  for(const [label,hash] of staffRoutes){
    await page.evaluate(h=>{location.hash=h;},hash);
    await page.waitForTimeout(700);
    results.staff.push(await inspect(page,label,hash,{screenshot:`staff-${label}-desktop.png`}));
  }
  await context.close();
}
{
  const {context,page}=await staffContext('en',{width:390,height:844});
  for(const [label,hash] of staffRoutes){
    await page.evaluate(h=>{location.hash=h;},hash);
    await page.waitForTimeout(700);
    results.staff.push(await inspect(page,`${label}-phone`,hash,{screenshot:`staff-${label}-phone.png`}));
  }
  await context.close();
}
{
  const {context,page}=await staffContext('ar',{width:390,height:844});
  for(const [label,hash] of staffRoutes){
    await page.evaluate(h=>{location.hash=h;},hash);
    await page.waitForTimeout(700);
    results.arabic.push(await inspect(page,label,hash,{screenshot:`arabic-${label}-phone.png`,english:true}));
  }
  await context.close();
}
{
  const context=await chrom.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1});
  const page=await context.newPage();watch(page,'public');
  for(const [label,hash] of publicRoutes){
    await page.goto(`${staffBase}/${hash}`,{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(1000);
    results.public.push(await inspect(page,label,hash,{screenshot:`public-${label}-desktop.png`}));
  }
  await context.close();
}
{
  const context=await chrom.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  const page=await context.newPage();watch(page,'worker');
  await page.goto(`${workerBase}/qa/start`,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(800);
  const session=await page.evaluate(async()=>await (await fetch('/api/session',{credentials:'include'})).json());
  for(const locale of workerLocales){
    await page.evaluate(({session,locale})=>{sessionStorage.setItem('understood:worker-ui-language',JSON.stringify({context:session.clientContext,expiresAt:session.expiresAt,base:session.language,language:locale}));},{session,locale});
    for(const [label,hash] of [['inbox','#inbox'],['detail','#worker/assignment-30'],['device','#device'],['help','#help']]){
      await page.goto(`${workerBase}/?locale=${locale}${hash}`,{waitUntil:'domcontentloaded'});
      await page.waitForTimeout(900);
      results.worker.push(await inspect(page,`${locale}-${label}`,hash,{screenshot:label==='inbox'?`worker-${locale}-inbox.png`:null,english:locale!=='en'}));
    }
  }
  await context.close();
}
{
  const context=await chrom.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1});
  const page=await context.newPage();watch(page,'operator');
  await page.goto(`${operatorBase}/`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.operations-entry',{timeout:20000});
  await page.locator('input[type=email]').fill('operator@example.test');
  await page.locator('input[type=password]').fill('Disposable synthetic operator only');
  await page.getByRole('button',{name:/Sign in to administration/i}).click();
  await page.waitForSelector('.operations-layout',{timeout:20000});
  await page.waitForTimeout(800);
  for(const tab of operatorTabs){
    const button=page.locator('#admin-navigation button',{hasText:tab}).first();
    if(await button.count()){await button.click();await page.waitForTimeout(900);}
    results.operator.push(await inspect(page,tab,tab,{screenshot:`operator-${tab.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-desktop.png`}));
  }
  await context.close();
}
results.errors=results.errors.filter(error=>!/notifications\/live|Failed to load resource/i.test(error));
await writeFile(new URL('ui-audit.json',evidence),JSON.stringify(results,null,2));
const summarize=rows=>rows.map(row=>({label:row.label,title:row.title,h1:row.h1,overflow:row.overflow,unnamed:row.unnamed.length,duplicateIds:row.duplicateIds.length,imagesNoAlt:row.imagesNoAlt.length,englishWords:row.englishWords,hash:row.hash}));
console.log(JSON.stringify({staff:summarize(results.staff),public:summarize(results.public),arabic:summarize(results.arabic),worker:summarize(results.worker),operator:summarize(results.operator),errors:results.errors.slice(0,40)},null,2));
await chrom.close();
