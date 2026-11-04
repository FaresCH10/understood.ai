async page=>{
  const session={authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['preview-company','preview-site','preview-owner']),siteState:'active',mode:'synthetic-credential',clientContext:'b'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),name:'Preview Owner',organization:'Preview Company',site:'Preview Site',timezone:'Asia/Beirut',firstRunRequired:false};
  const now=Date.now(),since=new Date(now-90*86400000).toISOString();
  let bulkCalls=0,readCalls=0;
  let items=[
    {id:'export-1',kind:'export.ready',label:'Report export ready',subject:null,destination:'reports',occurredAt:new Date(now-3600000).toISOString(),readAt:null},
    {id:'instruction-1',kind:'briefing.prepared',label:'Briefing preparation completed',subject:'Morning stockroom handover',destination:'briefings',occurredAt:new Date(now-7200000).toISOString(),readAt:null},
    {id:'help-1',kind:'help.requested',label:'Worker requested help',subject:null,destination:'clarifications',occurredAt:new Date(now-86400000).toISOString(),readAt:null},
    {id:'language-1',kind:'worker.language_requested',label:'Worker requested a language change',subject:null,destination:'people',occurredAt:new Date(now-90000000).toISOString(),readAt:new Date(now-80000000).toISOString()},
  ];
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    let body={items:[],total:0,unreadCount:0};
    if(path==='/api/session')body=session;
    else if(path==='/api/notifications/read-all'){
      bulkCalls++;const before=route.request().postDataJSON().before;let marked=0;
      items=items.map(item=>!item.readAt&&item.occurredAt<=before?(marked++,{...item,readAt:new Date().toISOString()}):item);
      body={before,marked,readAt:new Date().toISOString()};
    }else if(/\/notifications\/[^/]+\/read$/.test(path)){
      readCalls++;items=items.map(item=>path.includes(item.id)?{...item,readAt:new Date().toISOString()}:item);body=items.find(item=>path.includes(item.id));
    }else if(/\/notifications\/[^/]+\/receipt$/.test(path)){const item=items.find(item=>path.includes(item.id));body=item?.readAt?{found:true,item}:{found:false};}
    else if(path==='/api/notifications'){
      const filtered=items.filter(item=>url.searchParams.get('status')!=='unread'||!item.readAt);
      body={items:filtered.slice(0,Number(url.searchParams.get('pageSize')||20)),total:filtered.length,unread:items.filter(item=>!item.readAt).length,page:1,pageSize:Number(url.searchParams.get('pageSize')||20),asOf:new Date().toISOString(),since:new Date(Date.now()-90*86400000).toISOString()};
    }else if(path==='/api/push/status')body={adapter:'disabled',configured:false,publicKey:null,subscriptions:[]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.evaluate(()=>{localStorage.removeItem('understood:interface-language');for(const key of Object.keys(sessionStorage))if(key.startsWith('understood:notification-read:')&&key.includes('preview-company'))sessionStorage.removeItem(key);});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:3020/#notifications');await page.reload();
  await page.getByRole('button',{name:'Skip the tour'}).click({timeout:700}).catch(()=>{});
  await page.getByRole('button',{name:'Exit',exact:true}).click({timeout:700}).catch(()=>{});
  await page.getByRole('button',{name:'Mark all as read',exact:true}).waitFor();
  await page.locator('.notifications-item').first().waitFor();
  await page.screenshot({path:'output/playwright/notifications-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Mark read: Report export ready',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.notifications-unread-count')?.textContent==='2');
  await page.getByRole('button',{name:'Unread',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.notifications-item').length===2);
  await page.getByRole('button',{name:'Mark all as read',exact:true}).click();
  await page.getByRole('heading',{name:"You're all caught up",exact:true}).waitFor();
  if(await page.locator('.notification-count').count())throw Error('Header badge did not clear');
  if(!await page.getByRole('button',{name:'Mark all as read',exact:true}).isDisabled())throw Error('Bulk button enabled with no unread');
  await page.getByRole('button',{name:'View all activity',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.notifications-item').length===4);
  await page.locator('.notifications-delivery summary').click();
  await page.getByText('Push is not configured in this environment. In-app notifications remain available.').waitFor();
  await page.screenshot({path:'output/playwright/notifications-read.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('#dashboard-sidebar button').first().click();await page.waitForTimeout(350);
  await page.screenshot({path:'output/playwright/notifications-mobile.png',fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(overflow)throw Error('Mobile horizontal overflow');
  return {bulkCalls,readCalls,unread:items.filter(item=>!item.readAt).length,mobileOverflow:overflow};
}
