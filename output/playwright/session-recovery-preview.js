async page=>{
 let failing=false,slow=false,sessionReads=0;
 const session={authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['preview-company','preview-site','preview-owner']),siteState:'active',mode:'synthetic-credential',clientContext:'b'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),name:'Preview Owner',organization:'Cedar Works',site:'Beirut site',timezone:'UTC',firstRunRequired:false};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body={items:[],total:0,unread:0};let status=200;
  if(path==='/api/session'){sessionReads++;if(slow)await new Promise(resolve=>setTimeout(resolve,800));if(failing){status=503;body={error:'Temporarily unavailable'};}else body=session;}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:3020/#translation-feedback');
 await page.getByRole('button',{name:'Skip the tour'}).click({timeout:600}).catch(()=>{});await page.getByRole('button',{name:'Exit',exact:true}).click({timeout:600}).catch(()=>{});
 await page.locator('.staff-search-box input').fill('Keep this text');failing=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('heading',{name:'Checking your connection',exact:true}).waitFor();await page.waitForTimeout(100);
 await page.screenshot({path:'output/playwright/session-connection-desktop.png'});
 slow=true;await page.getByRole('button',{name:'Check again',exact:true}).click();if(!await page.locator('.session-recovery-card button').isDisabled())throw Error('Retry not disabled while checking');
 await page.waitForTimeout(1000);if(!await page.getByRole('button',{name:'Check again',exact:true}).isEnabled())throw Error('Retry did not recover after failure');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/playwright/session-connection-mobile.png'});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
 failing=false;await page.getByRole('button',{name:'Check again',exact:true}).click();await page.locator('.session-recovery-page').waitFor({state:'detached'});
 if(await page.locator('.staff-search-box input').inputValue()!=='Keep this text')throw Error('Page state was lost');
 failing=true;slow=false;await page.reload();await page.getByRole('heading',{name:'Session unavailable',exact:true}).waitFor();await page.screenshot({path:'output/playwright/session-unavailable-mobile.png'});
 failing=false;await page.getByRole('button',{name:'Recheck session',exact:true}).click();await page.locator('.session-recovery-page').waitFor({state:'detached'});
 // Explicit session denial must still lock the workspace instead of resuming it.
 await page.route('**/api/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false,mode:'synthetic-credential'})}));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('heading',{name:'This workspace session is locked',exact:true}).waitFor();await page.screenshot({path:'output/playwright/session-locked-mobile.png'});
 return {retryBusyState:true,failedRetryRemainsAvailable:true,pageStatePreserved:true,unavailableRecoveryWorks:true,lockedSessionStillProtected:true,sessionReads};
}
