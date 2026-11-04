async page=>{
 const session={available:true,authenticated:true,name:'Platform Admin',clientContext:'e'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString()};
 let items=[{id:crypto.randomUUID(),orgId:'cedar',workspace:'Cedar Works',site:'Beirut',publicationId:crypto.randomUUID(),language:'ar',field:'text',note:'The shelf label needs a more precise translation.',status:'open',createdAt:new Date().toISOString(),resolutionNote:null,resolvedAt:null,reviewerId:null}];let decisions=0,staffQueueRequests=0;
 await page.route('**/api/ops/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body={items:[],total:0};
  if(path.endsWith('/session'))body=session;
  else if(path.endsWith('/overview'))body={asOf:new Date().toISOString(),control:{revision:0,jobsPaused:false,providerPaused:false},backlog:[],tenants:{total:1,suspended:0},readiness:{api:'responding',database:'responding'},workerHealth:{status:'unknown',items:[]},storageHealth:{status:'unknown',privacy:'unknown',observation:null},limits:{reason:'Synthetic preview'}};
  else if(path.endsWith('/translation-feedback')){const status=new URL(route.request().url()).searchParams.get('status');const filtered=items.filter(item=>status==='all'||item.status===status);body={items:filtered,total:filtered.length,page:1,pageSize:20};}
  else if(path.endsWith('/decision')){decisions++;const input=route.request().postDataJSON();items[0]={...items[0],status:input.action,resolutionNote:input.note,resolvedAt:new Date().toISOString()};body={id:items[0].id,status:input.action,duplicate:false};}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:3020/operator.html');await page.reload();
 await page.getByRole('button',{name:'Skip the tour'}).click({timeout:600}).catch(()=>{});await page.getByRole('button',{name:'Exit',exact:true}).click({timeout:600}).catch(()=>{});
 await page.getByRole('button',{name:'Translation feedback',exact:true}).click();
 await page.getByText('The shelf label needs a more precise translation.').waitFor();await page.screenshot({path:'output/playwright/admin-feedback.png'});
 await page.getByRole('textbox',{name:'Review note (optional)'}).fill('Reviewed and corrected.');await page.getByRole('button',{name:'Mark resolved',exact:true}).click();
 await page.getByText('No open translation feedback.',{exact:true}).waitFor();await page.getByRole('button',{name:'Resolved',exact:true}).click();await page.getByText('Reviewed and corrected.',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/playwright/admin-feedback-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Admin feedback mobile overflow');
 const staffExpires=new Date(Date.now()+3600000).toISOString();
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/translation-feedback')staffQueueRequests++;
  const body=path==='/api/session'?{authenticated:true,role:'staff',staffRole:'supervisor',staffScope:JSON.stringify(['preview-company','preview-site','preview-supervisor']),siteState:'active',mode:'synthetic-credential',clientContext:'b'.repeat(64),expiresAt:staffExpires,name:'Preview Supervisor',organization:'Preview Company',site:'Preview Site',timezone:'UTC',firstRunRequired:false}:{items:[],total:0,unread:0};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:3020/#translation-feedback');await page.reload();await page.getByText('Translation feedback is managed by the platform administrator.',{exact:true}).waitFor();
 if(await page.locator('.sidebar-link').filter({hasText:'Translation feedback'}).count())throw Error('Supervisor nav contains feedback');
 if(staffQueueRequests)throw Error('Supervisor attempted queue fetch');return {decisions,adminQueueWorks:true,supervisorQueueRequests:staffQueueRequests,mobileOverflow:overflow};
}
