async page=>{
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>localStorage.removeItem('understood:interface-language'));
  let staff=false,releaseOverview,releaseInstructions;
  const overviewGate=new Promise(resolve=>releaseOverview=resolve),instructionsGate=new Promise(resolve=>releaseInstructions=resolve);
  const account={authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['preview-company','preview-site','preview-owner']),siteState:'active',mode:'synthetic-credential',clientContext:'d'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),name:'Preview Owner',organization:'Preview Company',site:'Preview Site',timezone:'Asia/Beirut'};
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let body={items:[],total:0,unreadCount:0,counts:{}};
    if(path==='/api/auth/staff/login'){staff=true;body={ok:true};}
    if(path==='/api/session'){await new Promise(resolve=>setTimeout(resolve,250));body=staff?account:{authenticated:false,mode:'synthetic-credential'};}
    if(path==='/api/overview'){await overviewGate;body={metrics:{assigned:0,responses:0,clarifications:0,pending:0,completion:0,matches:0,unassessed:0,acknowledged:0},attention:{total:0,needsAttention:{total:0,items:[]},waiting:{total:0,items:[]},delivery:{total:0,items:[]}},publication:null};}
    if(path==='/api/workspace/instructions')await instructionsGate;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.brand-loader').waitFor();
  await page.locator('.brand-loader').waitFor({state:'detached',timeout:30000});
  await page.getByRole('button',{name:'Skip the tour'}).click({timeout:700}).catch(()=>{});
  await page.getByRole('button',{name:'Exit',exact:true}).click({timeout:700}).catch(()=>{});
  await page.evaluate(()=>{window.logoShows=0;new MutationObserver(ms=>{for(const m of ms)for(const node of m.addedNodes)if(node instanceof Element&&(node.matches('.brand-loader')||node.querySelector('.brand-loader')))window.logoShows++;}).observe(document.querySelector('#root'),{childList:true,subtree:true});});
  await page.locator('.landing-nav-signin').click();await page.getByRole('textbox',{name:'Work email',exact:true}).fill('preview@example.test');
  await page.locator('#staff-password').fill('Preview-password-only');await page.locator('.entry-form button[type=submit]').click();
  await page.locator('.brand-loader').waitFor();const accountLogo=await page.evaluate(()=>window.logoShows);
  releaseOverview();await page.locator('.brand-loader').waitFor({state:'detached',timeout:15000});
  await page.locator('.sidebar-link').filter({hasText:'Instructions'}).click();
  await page.locator('.staff-content p[data-page-loading]').waitFor();
  const placeholder=await page.locator('.staff-content p[data-page-loading]').evaluate(el=>({animation:getComputedStyle(el,'::after').animationName,height:el.getBoundingClientRect().height}));
  const shellVisible=await page.locator('.dashboard-sidebar').isVisible();
  const duringNavigation=await page.evaluate(()=>window.logoShows);releaseInstructions();
  await page.getByText('No instructions match these filters.',{exact:true}).waitFor();
  await page.goto('http://127.0.0.1:3020/#home');await page.locator('.landing-nav-signin').click();await page.waitForURL('**/#overview');await page.waitForTimeout(400);
  const afterReturn=await page.evaluate(()=>window.logoShows);
  if(accountLogo!==1||duringNavigation!==1||afterReturn!==1||placeholder.animation!=='page-placeholder-pulse'||!shellVisible)throw new Error(JSON.stringify({accountLogo,duringNavigation,afterReturn,placeholder,shellVisible}));
  return {accountLogo,duringNavigation,afterReturn,placeholder,shellVisible};
}
