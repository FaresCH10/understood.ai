async page=>{
 const account={authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['preview-company','preview-site','preview-owner']),siteState:'active',mode:'synthetic-credential',clientContext:'b'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),name:'Preview Owner',organization:'Cedar Works',site:'Beirut site',timezone:'Asia/Beirut',firstRunRequired:false};
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  let body={items:[],total:0,unread:0};
  if(path==='/api/session')body=account;
  if(path==='/api/overview')body={metrics:{assigned:0,responses:0,clarifications:0,pending:0,completion:0,matches:0,unassessed:0,acknowledged:0},attention:{total:0,needsAttention:{total:0,items:[]},waiting:{total:0,items:[]},delivery:{total:0,items:[]}},publication:null};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.setViewportSize({width:1440,height:1000});await page.reload();
 await page.getByRole('button',{name:'Skip the tour'}).click({timeout:600}).catch(()=>{});await page.getByRole('button',{name:'Exit',exact:true}).click({timeout:600}).catch(()=>{});
 await page.locator('.today-header-date').waitFor();if(await page.locator('.topbar .top-date').count())throw Error('Date still in header');
 await page.keyboard.press('Control+k');if(!await page.locator('.staff-search-box input').evaluate(el=>el===document.activeElement))throw Error('Shortcut failed');
 const size=await page.locator('.staff-search-box').boundingBox();if(size.width<320||size.width>360)throw Error('Unexpected search width '+size.width);
 await page.getByRole('button',{name:'Change site: Cedar Works, Beirut site'}).click();await page.getByRole('dialog',{name:'Choose site'}).waitFor();await page.getByRole('button',{name:'Close site selection'}).click();
 await page.locator('.interface-language-trigger').click();await page.getByRole('button',{name:'English',exact:true}).waitFor();await page.keyboard.press('Escape');
 await page.mouse.click(700,100);await page.screenshot({path:'output/playwright/dashboard-header-desktop.png'});
 for(const width of [1024,390]){await page.setViewportSize({width,height:844});if(width===390&&await page.locator('#dashboard-sidebar').getAttribute('aria-hidden')==='false')await page.locator('#dashboard-sidebar .sidebar-close').click();await page.waitForTimeout(350);if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow at '+width);await page.screenshot({path:`output/playwright/dashboard-header-${width}.png`});}
 await page.keyboard.press('Control+k');await page.waitForURL('**/#search');
 await page.evaluate(()=>localStorage.setItem('understood:interface-language','ar'));await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:3020/#overview');await page.reload();await page.locator('.today-header-date').waitFor();await page.screenshot({path:'output/playwright/dashboard-header-arabic.png'});
 const rtl=await page.locator('.staff-shell').getAttribute('dir');await page.evaluate(()=>localStorage.removeItem('understood:interface-language'));
 return {searchWidth:size.width,dateMoved:true,shortcutWorks:true,siteDialogWorks:true,languageMenuWorks:true,mobileSearchWorks:true,rtl};
}
