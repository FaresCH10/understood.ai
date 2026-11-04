async page=>{
 const session={authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['preview-company','preview-site','preview-owner']),siteState:'active',mode:'synthetic-credential',clientContext:'b'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),name:'Preview Owner',organization:'Preview Company',site:'Preview Site',timezone:'UTC',firstRunRequired:false};
 await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(new URL(route.request().url()).pathname==='/api/session'?session:{items:[],total:0,unread:0})}));
 await page.setViewportSize({width:1440,height:1000});await page.reload();await page.locator('.sidebar-more summary').waitFor();
 await page.getByRole('button',{name:'Skip the tour'}).click({timeout:600}).catch(()=>{});await page.getByRole('button',{name:'Exit',exact:true}).click({timeout:600}).catch(()=>{});
 const more=page.locator('.sidebar-more'),summary=more.locator('summary');
 if(await more.getAttribute('open')!==null)throw Error('More should start collapsed');
 if(await more.getByRole('button',{name:'Reports',exact:true}).isVisible())throw Error('Closed submenu links visible');
 await summary.click();await page.waitForTimeout(300);
 for(const name of ['Language requests','Competencies','Reports'])if(!await more.getByRole('button',{name,exact:true}).isVisible())throw Error('Missing '+name);
 if(await more.locator('button.sidebar-link').count()!==3)throw Error('Unexpected grouped links');
 await page.screenshot({path:'output/playwright/sidebar-more.png'});
 await summary.focus();await page.keyboard.press('Enter');await page.waitForTimeout(70);if(await more.getAttribute('open')!==null)throw Error('Keyboard collapse failed');
 await page.goto('http://127.0.0.1:3020/#reports');await page.waitForFunction(()=>document.querySelector('.sidebar-more')?.hasAttribute('open'));
 if(await more.getByRole('button',{name:'Reports',exact:true}).getAttribute('aria-current')!=='page')throw Error('Active route not marked');
 await summary.focus();await page.keyboard.press('Escape');if(await more.getAttribute('open')!==null)throw Error('Escape failed');
 await page.setViewportSize({width:390,height:844});await summary.click();await page.waitForTimeout(300);
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
 return {collapsedByDefault:true,threeLinksGrouped:true,keyboardToggle:true,activeRouteExpanded:true,mobileOverflow:false};
}

